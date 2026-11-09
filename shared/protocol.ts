export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/
export const MAX_SIGNAL_BYTES = 64 * 1024
export type RoomType = 'private' | 'group'

export type RoomPeer = {
  peerId: string
}

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
  | { type: 'create_room'; roomType: RoomType }
  | { type: 'join_room'; roomCode: string; resumeToken?: string }
  | { type: 'offer'; targetPeerId: string; description: SessionDescriptionPayload }
  | { type: 'answer'; targetPeerId: string; description: SessionDescriptionPayload }
  | { type: 'ice_candidate'; targetPeerId: string; candidate: IceCandidatePayload }
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
  | {
      type: 'room_created' | 'room_joined'
      roomCode: string
      roomType: RoomType
      peerId: string
      resumeToken: string
      peers: RoomPeer[]
    }
  | { type: 'peer_joined'; peer: RoomPeer }
  | { type: 'peer_rejoined'; peerId: string }
  | { type: 'offer'; fromPeerId: string; description: SessionDescriptionPayload }
  | { type: 'answer'; fromPeerId: string; description: SessionDescriptionPayload }
  | { type: 'ice_candidate'; fromPeerId: string; candidate: IceCandidatePayload }
  | { type: 'peer_left'; peerId: string }
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

const isPeerId = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 8 && value.length <= 128

const isRoomType = (value: unknown): value is RoomType =>
  value === 'private' || value === 'group'

const isRoomPeer = (value: unknown): value is RoomPeer =>
  isRecord(value) && isPeerId(value.peerId)

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
    case 'leave':
      return { type: value.type }
    case 'create_room':
      return isRoomType(value.roomType)
        ? { type: 'create_room', roomType: value.roomType }
        : null
    case 'join_room': {
      if (typeof value.roomCode !== 'string') return null
      const roomCode = normalizeRoomCode(value.roomCode)
      if (
        'resumeToken' in value &&
        (typeof value.resumeToken !== 'string' ||
          value.resumeToken.length < 32 ||
          value.resumeToken.length > 128)
      ) {
        return null
      }
      const resumeToken =
        typeof value.resumeToken === 'string' ? value.resumeToken : undefined
      return ROOM_CODE_PATTERN.test(roomCode)
        ? { type: 'join_room', roomCode, ...(resumeToken ? { resumeToken } : {}) }
        : null
    }
    case 'offer':
    case 'answer':
      return isPeerId(value.targetPeerId) && isDescription(value.description, value.type)
        ? {
            type: value.type,
            targetPeerId: value.targetPeerId,
            description: value.description,
          }
        : null
    case 'ice_candidate':
      return isPeerId(value.targetPeerId) && isCandidate(value.candidate)
        ? {
            type: 'ice_candidate',
            targetPeerId: value.targetPeerId,
            candidate: value.candidate,
          }
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
        isRoomType(value.roomType) &&
        isPeerId(value.peerId) &&
        typeof value.resumeToken === 'string' &&
        value.resumeToken.length >= 32 &&
        value.resumeToken.length <= 128 &&
        Array.isArray(value.peers) &&
        value.peers.length <= 3 &&
        value.peers.every(isRoomPeer)
        ? {
            type: value.type,
            roomCode: value.roomCode,
            roomType: value.roomType,
            peerId: value.peerId,
            resumeToken: value.resumeToken,
            peers: value.peers,
          }
        : null
    case 'peer_joined':
      return isRoomPeer(value.peer) ? { type: 'peer_joined', peer: value.peer } : null
    case 'peer_rejoined':
    case 'peer_left':
      return isPeerId(value.peerId) ? { type: value.type, peerId: value.peerId } : null
    case 'offer':
    case 'answer':
      return isPeerId(value.fromPeerId) && isDescription(value.description, value.type)
        ? {
            type: value.type,
            fromPeerId: value.fromPeerId,
            description: value.description,
          }
        : null
    case 'ice_candidate':
      return isPeerId(value.fromPeerId) && isCandidate(value.candidate)
        ? {
            type: 'ice_candidate',
            fromPeerId: value.fromPeerId,
            candidate: value.candidate,
          }
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
