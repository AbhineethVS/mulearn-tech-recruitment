import {
  decodeServerSignal,
  parseJson,
  type ClientSignal,
  type ServerSignal,
} from '../../shared/protocol'

type SignalHandlers = {
  onMessage: (message: ServerSignal) => void
  onClose: () => void
  onError: (message: string) => void
}

function signalUrl() {
  const configured = import.meta.env.VITE_SIGNAL_URL as string | undefined
  if (configured?.trim()) return configured.trim()
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/signal`
}

export class SignalClient {
  private socket: WebSocket | null = null
  private readonly handlers: SignalHandlers
  private closedByClient = false

  constructor(handlers: SignalHandlers) {
    this.handlers = handlers
  }

  connect() {
    return new Promise<void>((resolve, reject) => {
      this.closedByClient = false
      const socket = new WebSocket(signalUrl())
      this.socket = socket

      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener(
        'error',
        () => {
          const message = 'Could not reach the signaling server.'
          this.handlers.onError(message)
          reject(new Error(message))
        },
        { once: true },
      )
      socket.addEventListener('close', () => {
        if (!this.closedByClient) this.handlers.onClose()
      })
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return
        const message = decodeServerSignal(parseJson(event.data))
        if (message) this.handlers.onMessage(message)
        else this.handlers.onError('The signaling server sent an invalid response.')
      })
    })
  }

  send(message: ClientSignal) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  close(sendLeave = true) {
    if (!this.socket) return
    this.closedByClient = true
    if (sendLeave && this.socket.readyState === WebSocket.OPEN) {
      this.send({ type: 'leave' })
    }
    this.socket.close()
    this.socket = null
  }

  isOpen() {
    return this.socket?.readyState === WebSocket.OPEN
  }
}
