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
    expect(decodeClientSignal({ type: 'offer', description: { type: 'answer', sdp: 'x' } })).toBeNull()
    expect(parseJson('{nope')).toBeNull()
  })
})

describe('room manager', () => {
  it('creates unambiguous codes, caps rooms at two, and cleans empty rooms', () => {
    expect(createRoomCode()).toMatch(ROOM_CODE_PATTERN)
    const rooms = new RoomManager<object>()
    const first = {}
    const second = {}
    const third = {}
    const created = rooms.create(first)

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
})

describe('signaling server', () => {
  let server: Server | undefined
  const clients: WebSocket[] = []

  afterEach(async () => {
    for (const client of clients) client.terminate()
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
  })

  it('returns a safe STUN fallback when managed TURN is not configured', async () => {
    server = createPeerServer()
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${port}/api/ice-servers`)

    await expect(response.json()).resolves.toMatchObject({
      turnConfigured: false,
      iceServers: expect.any(Array),
    })
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

    const createdMessage = nextMessage<{ roomCode: string }>(first)
    first.send(JSON.stringify({ type: 'create_room' }))
    const created = await createdMessage
    const joinedMessage = nextMessage(second)
    const peerJoinedMessage = nextMessage(first)
    second.send(JSON.stringify({ type: 'join_room', roomCode: created.roomCode }))
    await Promise.all([joinedMessage, peerJoinedMessage])

    const roomFullMessage = nextMessage<{ code: string }>(third)
    third.send(JSON.stringify({ type: 'join_room', roomCode: created.roomCode }))
    await expect(roomFullMessage).resolves.toMatchObject({ code: 'room_full' })

    const offer = { type: 'offer', description: { type: 'offer', sdp: 'sample-sdp' } }
    const relayedOffer = nextMessage(second)
    first.send(JSON.stringify(offer))
    await expect(relayedOffer).resolves.toEqual(offer)
  })
})
