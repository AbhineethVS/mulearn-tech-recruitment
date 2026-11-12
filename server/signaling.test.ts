import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createPeerServer } from './index.js'
import { RoomManager, createRoomCode } from './room-manager.js'
import { decodeClientSignal, parseJson, ROOM_CODE_PATTERN } from '../shared/protocol.js'

const openSocket = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url, { origin: url.replace('ws:', 'http:').replace('/signal', '') })
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })

const nextMessage = <T>(socket: WebSocket) =>
  new Promise<T>((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString()) as T))
  })

describe('protocol validation', () => {
  it('normalizes valid room joins and rejects malformed payloads', () => {
    expect(decodeClientSignal({ type: 'join_room', roomCode: 'abcd-2345' })).toEqual({
      type: 'join_room',
      roomCode: 'ABCD2345',
    })
    expect(
      decodeClientSignal({
        type: 'join_room',
        roomCode: 'ABCD2345',
        resumeToken: 'too-short',
      }),
    ).toBeNull()
    expect(decodeClientSignal({ type: 'create_room', roomType: 'group' })).toEqual({
      type: 'create_room',
      roomType: 'group',
    })
    expect(decodeClientSignal({ type: 'create_room', roomType: 'public' })).toBeNull()
    expect(decodeClientSignal({ type: 'offer', description: { type: 'answer', sdp: 'x' } })).toBeNull()
    expect(parseJson('{nope')).toBeNull()
  })
})

describe('room manager', () => {
  it('creates unambiguous codes, caps private rooms at two, and cleans empty rooms', () => {
    expect(createRoomCode()).toMatch(ROOM_CODE_PATTERN)
    const rooms = new RoomManager<object>()
    const first = {}
    const second = {}
    const third = {}
    const created = rooms.create(first, 'private')

    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(rooms.join(second, created.membership.roomCode).ok).toBe(true)
    expect(rooms.join(third, created.membership.roomCode)).toMatchObject({
      ok: false,
      code: 'room_full',
    })
    rooms.leave(first)
    rooms.leave(second)
    expect(rooms.roomCount()).toBe(0)
  })

  it('lets the same browser token reclaim a stale room slot', () => {
    const rooms = new RoomManager<object>()
    const first = {}
    const staleSecond = {}
    const replacement = {}
    const created = rooms.create(first, 'private')
    if (!created.ok) throw new Error('Room creation failed')
    const joined = rooms.join(staleSecond, created.membership.roomCode)
    if (!joined.ok) throw new Error('Room join failed')

    const resumed = rooms.join(
      replacement,
      created.membership.roomCode,
      joined.membership.resumeToken,
    )

    expect(resumed).toMatchObject({
      ok: true,
      membership: joined.membership,
      replacedPeer: staleSecond,
    })
    expect(rooms.getMembership(staleSecond)).toBeUndefined()
    expect(rooms.getPeers(replacement)).toEqual([first])
  })

  it('allows four peers in a group room and rejects a fifth', () => {
    const rooms = new RoomManager<object>()
    const peers = [{}, {}, {}, {}, {}]
    const created = rooms.create(peers[0], 'group')
    if (!created.ok) throw new Error('Room creation failed')

    expect(rooms.join(peers[1], created.membership.roomCode).ok).toBe(true)
    expect(rooms.join(peers[2], created.membership.roomCode).ok).toBe(true)
    expect(rooms.join(peers[3], created.membership.roomCode).ok).toBe(true)
    expect(rooms.join(peers[4], created.membership.roomCode)).toMatchObject({
      ok: false,
      code: 'room_full',
    })
  })
})

describe('signaling server', () => {
  let server: Server | undefined
  const clients: WebSocket[] = []

  afterEach(async () => {
    for (const client of clients) client.terminate()
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
  })

  it('pairs two peers and relays signaling without accepting a third', async () => {
    server = createPeerServer()
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const url = `ws://127.0.0.1:${port}/signal`
    const first = await openSocket(url)
    const second = await openSocket(url)
    const third = await openSocket(url)
    clients.push(first, second, third)

    const createdMessage = nextMessage<{ roomCode: string; peerId: string }>(first)
    first.send(JSON.stringify({ type: 'create_room', roomType: 'private' }))
    const created = await createdMessage
    const joinedMessage = nextMessage<{ peerId: string }>(second)
    const peerJoinedMessage = nextMessage(first)
    second.send(JSON.stringify({ type: 'join_room', roomCode: created.roomCode }))
    const [joined] = await Promise.all([joinedMessage, peerJoinedMessage])

    const roomFullMessage = nextMessage<{ code: string }>(third)
    third.send(JSON.stringify({ type: 'join_room', roomCode: created.roomCode }))
    await expect(roomFullMessage).resolves.toMatchObject({ code: 'room_full' })

    const offer = {
      type: 'offer',
      targetPeerId: joined.peerId,
      description: { type: 'offer', sdp: 'sample-sdp' },
    }
    const relayedOffer = nextMessage(second)
    first.send(JSON.stringify(offer))
    await expect(relayedOffer).resolves.toEqual({
      type: 'offer',
      fromPeerId: created.peerId,
      description: offer.description,
    })
  })

  it('admits four group members and rejects a fifth', async () => {
    server = createPeerServer()
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const url = `ws://127.0.0.1:${port}/signal`
    const group = await Promise.all(Array.from({ length: 5 }, () => openSocket(url)))
    clients.push(...group)

    const createdMessage = nextMessage<{ roomCode: string; roomType: string }>(group[0])
    group[0].send(JSON.stringify({ type: 'create_room', roomType: 'group' }))
    const created = await createdMessage
    expect(created.roomType).toBe('group')

    for (const peer of group.slice(1, 4)) {
      const joined = nextMessage<{ type: string }>(peer)
      peer.send(JSON.stringify({ type: 'join_room', roomCode: created.roomCode }))
      await expect(joined).resolves.toMatchObject({ type: 'room_joined' })
    }

    const rejected = nextMessage<{ code: string }>(group[4])
    group[4].send(JSON.stringify({ type: 'join_room', roomCode: created.roomCode }))
    await expect(rejected).resolves.toMatchObject({ code: 'room_full' })
  })

  it('rejects signaling targets outside the sender room', async () => {
    server = createPeerServer()
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const url = `ws://127.0.0.1:${port}/signal`
    const sender = await openSocket(url)
    const peer = await openSocket(url)
    const outsider = await openSocket(url)
    clients.push(sender, peer, outsider)

    const senderCreated = nextMessage<{ roomCode: string }>(sender)
    sender.send(JSON.stringify({ type: 'create_room', roomType: 'private' }))
    const senderRoom = await senderCreated
    const joined = nextMessage(peer)
    const joinedNotice = nextMessage(sender)
    peer.send(JSON.stringify({ type: 'join_room', roomCode: senderRoom.roomCode }))
    await Promise.all([joined, joinedNotice])

    const outsiderCreated = nextMessage<{ peerId: string }>(outsider)
    outsider.send(JSON.stringify({ type: 'create_room', roomType: 'private' }))
    const outsiderRoom = await outsiderCreated

    const rejected = nextMessage<{ code: string }>(sender)
    sender.send(
      JSON.stringify({
        type: 'offer',
        targetPeerId: outsiderRoom.peerId,
        description: { type: 'offer', sdp: 'cross-room' },
      }),
    )
    await expect(rejected).resolves.toMatchObject({ code: 'peer_unavailable' })
  })
})
