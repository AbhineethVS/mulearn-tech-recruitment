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
        const result = rooms.create(socket)
        if (!result.ok) {
          sendError(socket, result.code, result.message)
          return
        }
        send(socket, { type: 'room_created', ...result.membership })
        return
      }

      if (message.type === 'join_room') {
        const result = rooms.join(socket, message.roomCode)
        if (!result.ok) {
          sendError(socket, result.code, result.message)
          return
        }
        send(socket, { type: 'room_joined', ...result.membership })
        const otherPeer = rooms.getOtherPeer(socket)
        if (otherPeer) send(otherPeer, { type: 'peer_joined' })
        return
      }

      if (message.type === 'leave') {
        const otherPeer = rooms.leave(socket)
        if (otherPeer) send(otherPeer, { type: 'peer_left' })
        return
      }

      if (!rooms.getMembership(socket)) {
        sendError(socket, 'not_in_room', 'Create or join a room before signaling.')
        return
      }

      const otherPeer = rooms.getOtherPeer(socket)
      if (!otherPeer) {
        sendError(socket, 'peer_unavailable', 'The other person has not joined yet.')
        return
      }

      if (message.type === 'offer' || message.type === 'answer') {
        send(otherPeer, message)
      } else {
        send(otherPeer, message)
      }
    })

    socket.on('close', () => {
      const otherPeer = rooms.leave(socket)
      if (otherPeer) send(otherPeer, { type: 'peer_left' })
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
  }, 30_000)

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
    console.log(`Peer Chat is listening on http://localhost:${port}`)
  })
}
