import { createServer, type IncomingMessage } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'
import {
  MAX_SIGNAL_BYTES,
  decodeClientSignal,
  parseJson,
  type ServerSignal,
  type SignalErrorCode,
} from '../shared/protocol.js'
import { RoomManager } from './room-manager.js'

type LiveSocket = WebSocket & { isAlive: boolean }

const send = (socket: WebSocket, message: ServerSignal) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

const sendError = (
  socket: WebSocket,
  code: SignalErrorCode,
  message: string,
  recoverable = true,
) => send(socket, { type: 'error', code, message, recoverable })

function originAllowed(request: IncomingMessage) {
  const origin = request.headers.origin
  if (!origin) return true

  const configured = process.env.ALLOWED_ORIGIN
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (configured?.length) return configured.includes(origin)

  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

export function createPeerServer() {
  const app = express()
  const server = createServer(app)
  const sockets = new WebSocketServer({
    server,
    path: '/signal',
    maxPayload: MAX_SIGNAL_BYTES,
    verifyClient: ({ req }, done) => done(originAllowed(req), 403, 'Origin not allowed'),
  })
  const rooms = new RoomManager<LiveSocket>()
  const distPath = resolve(process.cwd(), 'dist')

  app.disable('x-powered-by')
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', rooms: rooms.roomCount() })
  })
  app.use(express.static(distPath))
  app.use((_request, response) => response.sendFile(resolve(distPath, 'index.html')))

  const leaveRoom = (socket: LiveSocket) => {
    const result = rooms.leave(socket)
    if (!result) return
    for (const peer of result.remainingPeers) {
      send(peer, { type: 'peer_left', peerId: result.membership.peerId })
    }
  }

  sockets.on('connection', (rawSocket) => {
    const socket = rawSocket as LiveSocket
    socket.isAlive = true
    socket.on('pong', () => {
      socket.isAlive = true
    })

    socket.on('message', (data, isBinary) => {
      const text = Array.isArray(data) ? Buffer.concat(data).toString() : data.toString()
      if (isBinary || Buffer.byteLength(text) > MAX_SIGNAL_BYTES) {
        sendError(socket, 'invalid_message', 'The signaling message is not valid.')
        return
      }

      const message = decodeClientSignal(parseJson(text))
      if (!message) {
        sendError(socket, 'invalid_message', 'The signaling message is not valid.')
        return
      }

      if (message.type === 'create_room') {
        const result = rooms.create(socket, message.roomType)
        if (!result.ok) {
          sendError(socket, result.code, result.message)
          return
        }
        send(socket, {
          type: 'room_created',
          ...result.membership,
          roomType: result.roomType,
          peers: result.peers,
        })
        return
      }

      if (message.type === 'join_room') {
        const result = rooms.join(socket, message.roomCode, message.resumeToken)
        if (!result.ok) {
          sendError(socket, result.code, result.message)
          return
        }
        result.replacedPeer?.terminate()
        send(socket, {
          type: 'room_joined',
          ...result.membership,
          roomType: result.roomType,
          peers: result.peers,
        })
        for (const peer of rooms.getPeers(socket)) {
          send(
            peer,
            result.replacedPeer
              ? { type: 'peer_rejoined', peerId: result.membership.peerId }
              : { type: 'peer_joined', peer: { peerId: result.membership.peerId } },
          )
        }
        return
      }

      if (message.type === 'leave') {
        leaveRoom(socket)
        return
      }

      const membership = rooms.getMembership(socket)
      if (!membership) {
        sendError(socket, 'not_in_room', 'Create or join a room before signaling.')
        return
      }

      const targetPeer = rooms.getPeerById(socket, message.targetPeerId)
      if (!targetPeer) {
        sendError(socket, 'peer_unavailable', 'That peer is no longer available.')
        return
      }

      if (message.type === 'offer' || message.type === 'answer') {
        send(targetPeer, {
          type: message.type,
          fromPeerId: membership.peerId,
          description: message.description,
        })
      } else {
        send(targetPeer, {
          type: 'ice_candidate',
          fromPeerId: membership.peerId,
          candidate: message.candidate,
        })
      }
    })

    socket.on('close', () => {
      leaveRoom(socket)
    })
  })

  const heartbeat = setInterval(() => {
    for (const rawSocket of sockets.clients) {
      const socket = rawSocket as LiveSocket
      if (!socket.isAlive) {
        socket.terminate()
        continue
      }
      socket.isAlive = false
      socket.ping()
    }
  }, 15_000)

  server.on('close', () => {
    clearInterval(heartbeat)
    sockets.close()
  })

  return server
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isEntryPoint) {
  const port = Number(process.env.PORT) || 3001
  createPeerServer().listen(port, () => {
    console.log(`P4Pair is listening on http://localhost:${port}`)
  })
}
