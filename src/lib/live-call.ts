import type { CallEnvelope, LiveCallState, PeerEnvelope } from '../types/messages'

export const CALL_ID_PATTERN = /^[0-9a-f-]{16,64}$/i
const CALL_REASON_MAX_LENGTH = 120

export const IDLE_CALL: LiveCallState = {
  phase: 'idle',
  callId: '',
  peerId: '',
  peerName: '',
  mode: 'voice',
  startedAt: null,
  muted: false,
  remoteMuted: false,
  cameraEnabled: false,
  remoteCameraEnabled: false,
  facingMode: 'user',
  error: '',
}

export const isCallEnvelope = (value: PeerEnvelope | Record<string, unknown>): value is CallEnvelope => {
  const item = value as Record<string, unknown>
  if (typeof item.kind !== 'string' || !item.kind.startsWith('call_')) return false
  if (typeof item.callId !== 'string' || !CALL_ID_PATTERN.test(item.callId)) return false

  if (item.kind === 'call_invite') {
    return (
      (item.mode === 'voice' || item.mode === 'video') &&
      typeof item.sentAt === 'string' &&
      Number.isFinite(Date.parse(item.sentAt))
    )
  }
  if (item.kind === 'call_mute') return typeof item.muted === 'boolean'
  if (item.kind === 'call_video') return typeof item.enabled === 'boolean'
  if (item.kind === 'call_decline' || item.kind === 'call_end') {
    return (
      item.reason === undefined ||
      (typeof item.reason === 'string' && item.reason.length <= CALL_REASON_MAX_LENGTH)
    )
  }
  return item.kind === 'call_accept' || item.kind === 'call_ready' || item.kind === 'call_cancel'
}

export const localInviteWins = (localPeerId: string, remotePeerId: string) =>
  localPeerId.localeCompare(remotePeerId) < 0

export const mediaRequestIsCurrent = (
  requestGeneration: number,
  currentGeneration: number,
  state: LiveCallState,
  callId: string,
  peerId: string,
) =>
  requestGeneration === currentGeneration &&
  state.callId === callId &&
  state.peerId === peerId

export const callControlMatches = (
  state: LiveCallState,
  remotePeerId: string,
  envelope: CallEnvelope,
) => state.callId === envelope.callId && state.peerId === remotePeerId

export const microphoneErrorMessage = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Microphone permission was denied. Allow microphone access and try again.'
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'No microphone was found on this device.'
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'The microphone is being used by another app. Close it and try again.'
    }
  }
  return 'The microphone could not be started. Check device permissions and try again.'
}

export const cameraErrorMessage = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Camera or microphone permission was denied. Allow access and try again.'
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'A camera and microphone are required for a video call.'
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'The camera or microphone is being used by another app. Close it and try again.'
    }
    if (error.name === 'OverconstrainedError') {
      return 'The selected camera is not available. Try another camera.'
    }
  }
  return 'The camera could not be started. Check device permissions and try again.'
}
