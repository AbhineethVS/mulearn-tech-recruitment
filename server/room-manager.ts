import { randomBytes, randomUUID } from 'node:crypto'
import type { SignalErrorCode } from '../shared/protocol.js'

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export type Membership = {
  peerId: string
  roomCode: string
}

type Room<TPeer extends object> = {
  code: string
  peers: TPeer[]
}

type RoomResult =
  | { ok: true; membership: Membership }
  | { ok: false; code: SignalErrorCode; message: string }

export function createRoomCode() {
  const bytes = randomBytes(8)
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('')
}

export class RoomManager<TPeer extends object> {
  private readonly rooms = new Map<string, Room<TPeer>>()
  private readonly memberships = new Map<TPeer, Membership>()

  create(peer: TPeer): RoomResult {
    if (this.memberships.has(peer)) {
      return { ok: false, code: 'already_in_room', message: 'Leave the current room first.' }
    }

    let roomCode = createRoomCode()
    while (this.rooms.has(roomCode)) roomCode = createRoomCode()

    const membership = { peerId: randomUUID(), roomCode }
    this.rooms.set(roomCode, { code: roomCode, peers: [peer] })
    this.memberships.set(peer, membership)
    return { ok: true, membership }
  }

  join(peer: TPeer, roomCode: string): RoomResult {
    if (this.memberships.has(peer)) {
      return { ok: false, code: 'already_in_room', message: 'Leave the current room first.' }
    }

    const room = this.rooms.get(roomCode)
    if (!room) {
      return { ok: false, code: 'room_not_found', message: 'That room no longer exists.' }
    }
    if (room.peers.length >= 2) {
      return { ok: false, code: 'room_full', message: 'That room already has two people.' }
    }

    const membership = { peerId: randomUUID(), roomCode }
    room.peers.push(peer)
    this.memberships.set(peer, membership)
    return { ok: true, membership }
  }

  getMembership(peer: TPeer) {
    return this.memberships.get(peer)
  }

  getOtherPeer(peer: TPeer) {
    const membership = this.memberships.get(peer)
    if (!membership) return null
    const room = this.rooms.get(membership.roomCode)
    return room?.peers.find((candidate) => candidate !== peer) ?? null
  }

  leave(peer: TPeer) {
    const membership = this.memberships.get(peer)
    if (!membership) return null

    const room = this.rooms.get(membership.roomCode)
    this.memberships.delete(peer)
    if (!room) return null

    room.peers = room.peers.filter((candidate) => candidate !== peer)
    if (room.peers.length === 0) this.rooms.delete(room.code)
    return room.peers[0] ?? null
  }

  roomCount() {
    return this.rooms.size
  }
}
