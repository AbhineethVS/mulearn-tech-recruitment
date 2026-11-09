import type {
  IceCandidatePayload,
  SessionDescriptionPayload,
} from '../../shared/protocol'

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

function configuredIceServers() {
  const value = import.meta.env.VITE_ICE_SERVERS_JSON as string | undefined
  if (!value) return DEFAULT_ICE_SERVERS
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as RTCIceServer[]) : DEFAULT_ICE_SERVERS
  } catch {
    return DEFAULT_ICE_SERVERS
  }
}

export const createPeerConnection = () =>
  new RTCPeerConnection({ iceServers: configuredIceServers() })

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
