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
