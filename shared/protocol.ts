export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/
export const MAX_SIGNAL_BYTES = 64 * 1024

export type SessionDescriptionPayload = {
  type: 'offer' | 'answer'
  sdp: string
}

export type IceCandidatePayload = {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  usernameFragment: string | null
}

export type ClientSignal =
  | { type: 'create_room' }
  | { type: 'join_room'; roomCode: string }
  | { type: 'offer'; description: SessionDescriptionPayload }
  | { type: 'answer'; description: SessionDescriptionPayload }
  | { type: 'ice_candidate'; candidate: IceCandidatePayload }
  | { type: 'leave' }

export type SignalErrorCode =
  | 'invalid_message'
  | 'invalid_room'
  | 'room_not_found'
  | 'room_full'
  | 'already_in_room'
  | 'not_in_room'
  | 'peer_unavailable'

export type ServerSignal =
  | { type: 'room_created'; roomCode: string; peerId: string }
  | { type: 'room_joined'; roomCode: string; peerId: string }
  | { type: 'peer_joined' }
  | { type: 'offer'; description: SessionDescriptionPayload }
  | { type: 'answer'; description: SessionDescriptionPayload }
  | { type: 'ice_candidate'; candidate: IceCandidatePayload }
  | { type: 'peer_left' }
  | { type: 'error'; code: SignalErrorCode; message: string; recoverable: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isDescription = (
  value: unknown,
  expectedType: SessionDescriptionPayload['type'],
): value is SessionDescriptionPayload =>
  isRecord(value) &&
  value.type === expectedType &&
  typeof value.sdp === 'string' &&
  value.sdp.length > 0 &&
  value.sdp.length <= 48 * 1024

const isCandidate = (value: unknown): value is IceCandidatePayload =>
  isRecord(value) &&
  typeof value.candidate === 'string' &&
  value.candidate.length <= 8 * 1024 &&
  (typeof value.sdpMid === 'string' || value.sdpMid === null) &&
  (typeof value.sdpMLineIndex === 'number' || value.sdpMLineIndex === null) &&
  (typeof value.usernameFragment === 'string' || value.usernameFragment === null)

export function normalizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export function decodeClientSignal(value: unknown): ClientSignal | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null

  switch (value.type) {
    case 'create_room':
    case 'leave':
      return { type: value.type }
    case 'join_room': {
      if (typeof value.roomCode !== 'string') return null
      const roomCode = normalizeRoomCode(value.roomCode)
      return ROOM_CODE_PATTERN.test(roomCode) ? { type: 'join_room', roomCode } : null
    }
    case 'offer':
    case 'answer':
      return isDescription(value.description, value.type)
        ? { type: value.type, description: value.description }
        : null
    case 'ice_candidate':
      return isCandidate(value.candidate)
        ? { type: 'ice_candidate', candidate: value.candidate }
        : null
    default:
      return null
  }
}

export function decodeServerSignal(value: unknown): ServerSignal | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null

  switch (value.type) {
    case 'room_created':
    case 'room_joined':
      return typeof value.roomCode === 'string' &&
        ROOM_CODE_PATTERN.test(value.roomCode) &&
        typeof value.peerId === 'string'
        ? { type: value.type, roomCode: value.roomCode, peerId: value.peerId }
        : null
    case 'peer_joined':
    case 'peer_left':
      return { type: value.type }
    case 'offer':
    case 'answer':
      return isDescription(value.description, value.type)
        ? { type: value.type, description: value.description }
        : null
    case 'ice_candidate':
      return isCandidate(value.candidate)
        ? { type: 'ice_candidate', candidate: value.candidate }
        : null
    case 'error':
      return typeof value.code === 'string' &&
        typeof value.message === 'string' &&
        typeof value.recoverable === 'boolean'
        ? {
            type: 'error',
            code: value.code as SignalErrorCode,
            message: value.message,
            recoverable: value.recoverable,
          }
        : null
    default:
      return null
  }
}
