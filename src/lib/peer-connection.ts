import type {
  IceCandidatePayload,
  SessionDescriptionPayload,
} from '../../shared/protocol'

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

export type IceFailureDiagnosis = {
  title: string
  detail: string
}

export type ConnectionRoute = {
  kind: 'host' | 'stun' | 'unknown'
  label: string
  detail: string
}

export type ConnectionQuality = {
  rating: 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'
  label: string
  detail: string
  rttMs: number | null
}

type ParsedCandidate = {
  address: string
  type: string
}

function parseCandidate(candidate: string): ParsedCandidate | null {
  const parts = candidate.trim().split(/\s+/)
  const typeIndex = parts.indexOf('typ')
  if (parts.length < 8 || typeIndex === -1 || !parts[typeIndex + 1]) return null
  return { address: parts[4], type: parts[typeIndex + 1] }
}

function privateIpv4(address: string) {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return null
  const [first, second] = octets
  const privateAddress =
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  return privateAddress ? octets : null
}

export function diagnoseIceFailure({
  localCandidates,
  remoteCandidates,
}: {
  localCandidates: string[]
  remoteCandidates: string[]
}): IceFailureDiagnosis {
  const localHosts = localCandidates
    .map(parseCandidate)
    .filter((candidate): candidate is ParsedCandidate => candidate?.type === 'host')
  const remoteHosts = remoteCandidates
    .map(parseCandidate)
    .filter((candidate): candidate is ParsedCandidate => candidate?.type === 'host')

  const samePrivateSubnet = localHosts.some((local) => {
    const localAddress = privateIpv4(local.address)
    if (!localAddress) return false
    return remoteHosts.some((remote) => {
      const remoteAddress = privateIpv4(remote.address)
      return (
        remoteAddress !== null &&
        localAddress.slice(0, 3).every((octet, index) => octet === remoteAddress[index])
      )
    })
  })

  if (samePrivateSubnet) {
    return {
      title: 'Likely local-network isolation',
      detail:
        'Both peers advertised the same local network, but ICE could not exchange packets. Avoid guest Wi-Fi, disable AP/client isolation, check endpoint firewalls, or connect the phone to the laptop’s mobile hotspot.',
    }
  }

  if (remoteCandidates.length === 0) {
    return {
      title: 'Peer network details did not arrive',
      detail:
        'The other browser did not provide usable ICE candidates. Refresh both pages, create a new room, and check that signaling remains connected.',
    }
  }

  return {
    title: 'The direct route is blocked',
    detail:
      'The peers exchanged network details, but no direct candidate pair worked. Try a different non-guest network, check endpoint firewalls, or use the laptop’s mobile hotspot.',
  }
}

export function classifyConnectionRoute(
  localType?: string,
  remoteType?: string,
): ConnectionRoute {
  const types = new Set([localType, remoteType].filter(Boolean))
  if (types.has('relay')) {
    return {
      kind: 'unknown',
      label: 'Unknown WebRTC route',
      detail: 'The browser selected a route that is not part of P4Pair’s direct-only setup.',
    }
  }
  if (types.has('srflx') || types.has('prflx')) {
    return {
      kind: 'stun',
      label: 'Direct · STUN',
      detail: 'The peers connected directly through NAT using a discovered public route.',
    }
  }
  if (types.has('host')) {
    return {
      kind: 'host',
      label: 'Direct · Host route',
      detail: 'The peers connected directly using local-network or native IPv6 addresses.',
    }
  }
  return {
    kind: 'unknown',
    label: 'WebRTC connected',
    detail: 'The data channel is open, but this browser did not expose the selected route type.',
  }
}

type CandidatePairStats = RTCStats & {
  localCandidateId?: string
  remoteCandidateId?: string
  currentRoundTripTime?: number
}

function selectedCandidatePair(stats: RTCStatsReport) {
  let selectedPairId: string | undefined
  let fallbackPair: CandidatePairStats | undefined

  stats.forEach((report) => {
    const value = report as CandidatePairStats & {
      selectedCandidatePairId?: string
      state?: string
      nominated?: boolean
    }
    if (value.type === 'transport' && value.selectedCandidatePairId) {
      selectedPairId = value.selectedCandidatePairId
    }
    if (value.type === 'candidate-pair' && value.state === 'succeeded' && value.nominated) {
      fallbackPair = value
    }
  })

  return (selectedPairId ? stats.get(selectedPairId) : fallbackPair) as
    | CandidatePairStats
    | undefined
}

export function classifyConnectionQuality(rttMs: number | null): ConnectionQuality {
  if (rttMs === null || !Number.isFinite(rttMs)) {
    return {
      rating: 'unknown',
      label: 'Measuring',
      detail: 'The browser has not exposed a round-trip measurement yet.',
      rttMs: null,
    }
  }
  if (rttMs < 100) {
    return {
      rating: 'excellent',
      label: 'Excellent',
      detail: 'Messages should feel immediate on this route.',
      rttMs,
    }
  }
  if (rttMs < 200) {
    return {
      rating: 'good',
      label: 'Good',
      detail: 'The route has a small but comfortable network delay.',
      rttMs,
    }
  }
  if (rttMs < 400) {
    return {
      rating: 'fair',
      label: 'Fair',
      detail: 'The route is usable, but delivery may feel slightly delayed.',
      rttMs,
    }
  }
  return {
    rating: 'poor',
    label: 'Unstable',
    detail: 'The route has high latency and may disconnect on network changes.',
    rttMs,
  }
}

export async function detectConnectionRoute(
  peer: RTCPeerConnection,
): Promise<ConnectionRoute> {
  const stats = await peer.getStats()
  const pair = selectedCandidatePair(stats)
  const local = pair?.localCandidateId
    ? (stats.get(pair.localCandidateId) as RTCStats & { candidateType?: string })
    : undefined
  const remote = pair?.remoteCandidateId
    ? (stats.get(pair.remoteCandidateId) as RTCStats & { candidateType?: string })
    : undefined

  return classifyConnectionRoute(local?.candidateType, remote?.candidateType)
}

export async function measureConnectionQuality(peer: RTCPeerConnection) {
  const pair = selectedCandidatePair(await peer.getStats())
  const rttMs =
    typeof pair?.currentRoundTripTime === 'number'
      ? Math.round(pair.currentRoundTripTime * 1000)
      : null
  return classifyConnectionQuality(rttMs)
}

export function createPeerConnection() {
  return new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS })
}

export const toDescriptionPayload = (
  description: RTCSessionDescription | null,
): SessionDescriptionPayload => {
  if (!description?.sdp || (description.type !== 'offer' && description.type !== 'answer')) {
    throw new Error('The browser did not produce a valid session description.')
  }
  return { type: description.type, sdp: description.sdp }
}

export const toCandidatePayload = (candidate: RTCIceCandidate): IceCandidatePayload => {
  const json = candidate.toJSON()
  return {
    candidate: json.candidate ?? '',
    sdpMid: json.sdpMid ?? null,
    sdpMLineIndex: json.sdpMLineIndex ?? null,
    usernameFragment: json.usernameFragment ?? null,
  }
}

export function waitForChannelBuffer(channel: RTCDataChannel, limit = 512 * 1024) {
  if (channel.bufferedAmount <= limit) return Promise.resolve()
  channel.bufferedAmountLowThreshold = limit
  return new Promise<void>((resolve, reject) => {
    const handleLow = () => {
      cleanup()
      resolve()
    }
    const handleClose = () => {
      cleanup()
      reject(new Error('The data channel closed during transfer.'))
    }
    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', handleLow)
      channel.removeEventListener('close', handleClose)
    }
    channel.addEventListener('bufferedamountlow', handleLow, { once: true })
    channel.addEventListener('close', handleClose, { once: true })
  })
}
