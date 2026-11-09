import type {
  IceCandidatePayload,
  SessionDescriptionPayload,
} from '../../shared/protocol'

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

type IceConfiguration = {
  iceServers: RTCIceServer[]
  turnConfigured: boolean
}

export type IceFailureDiagnosis = {
  title: string
  detail: string
}

export type ConnectionRoute = {
  kind: 'host' | 'stun' | 'turn' | 'unknown'
  label: string
  detail: string
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
  turnConfigured,
}: {
  localCandidates: string[]
  remoteCandidates: string[]
  turnConfigured: boolean
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

  if (!turnConfigured) {
    return {
      title: 'The direct route is blocked',
      detail:
        'The peers exchanged network details, but no direct candidate pair worked. Try a different non-guest network or the laptop’s mobile hotspot. TURN is an optional relayed fallback.',
    }
  }

  return {
    title: 'No direct or relayed route worked',
    detail:
      'ICE tested the available direct and TURN routes without selecting a pair. Retry once, then verify the TURN credentials and network firewall rules.',
  }
}

export function classifyConnectionRoute(
  localType?: string,
  remoteType?: string,
): ConnectionRoute {
  const types = new Set([localType, remoteType].filter(Boolean))
  if (types.has('relay')) {
    return {
      kind: 'turn',
      label: 'Relayed · TURN',
      detail: 'WebRTC is encrypted, but TURN is relaying packets because no direct route worked.',
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

export async function detectConnectionRoute(
  peer: RTCPeerConnection,
): Promise<ConnectionRoute> {
  const stats = await peer.getStats()
  let selectedPairId: string | undefined
  let fallbackPair:
    | (RTCStats & { localCandidateId?: string; remoteCandidateId?: string })
    | undefined

  stats.forEach((report) => {
    const value = report as RTCStats & {
      selectedCandidatePairId?: string
      state?: string
      nominated?: boolean
      localCandidateId?: string
      remoteCandidateId?: string
    }
    if (value.type === 'transport' && value.selectedCandidatePairId) {
      selectedPairId = value.selectedCandidatePairId
    }
    if (value.type === 'candidate-pair' && value.state === 'succeeded' && value.nominated) {
      fallbackPair = value
    }
  })

  const pair = (selectedPairId ? stats.get(selectedPairId) : fallbackPair) as
    | (RTCStats & { localCandidateId?: string; remoteCandidateId?: string })
    | undefined
  const local = pair?.localCandidateId
    ? (stats.get(pair.localCandidateId) as RTCStats & { candidateType?: string })
    : undefined
  const remote = pair?.remoteCandidateId
    ? (stats.get(pair.remoteCandidateId) as RTCStats & { candidateType?: string })
    : undefined

  return classifyConnectionRoute(local?.candidateType, remote?.candidateType)
}

let iceConfigurationPromise: Promise<IceConfiguration> | null = null

async function loadIceConfiguration(): Promise<IceConfiguration> {
  try {
    const response = await fetch('/api/ice-servers')
    if (!response.ok) throw new Error('ICE configuration is unavailable.')
    const value = (await response.json()) as Partial<IceConfiguration>
    if (!Array.isArray(value.iceServers) || value.iceServers.length === 0) {
      throw new Error('ICE configuration is invalid.')
    }
    return {
      iceServers: value.iceServers,
      turnConfigured: value.turnConfigured === true,
    }
  } catch {
    return { iceServers: DEFAULT_ICE_SERVERS, turnConfigured: false }
  }
}

export async function createPeerConnection() {
  iceConfigurationPromise ??= loadIceConfiguration()
  const configuration = await iceConfigurationPromise
  return {
    connection: new RTCPeerConnection({ iceServers: configuration.iceServers }),
    turnConfigured: configuration.turnConfigured,
  }
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
