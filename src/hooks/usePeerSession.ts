import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ROOM_CODE_PATTERN,
  normalizeRoomCode,
  type IceCandidatePayload,
  type ServerSignal,
} from '../../shared/protocol'
import {
  createPeerConnection,
  diagnoseIceFailure,
  toCandidatePayload,
  toDescriptionPayload,
  waitForChannelBuffer,
} from '../lib/peer-connection'
import { SignalClient } from '../lib/signaling'
import type {
  ChatMessage,
  ConnectionEvent,
  FileControlEnvelope,
  FileTransfer,
  PeerEnvelope,
} from '../types/messages'

export type SessionPhase =
  | 'idle'
  | 'signaling'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed'

const MAX_MESSAGE_LENGTH = 4_000
const MAX_FILE_SIZE = 25 * 1024 * 1024
const FILE_CHUNK_SIZE = 16 * 1024

const eventTime = () =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date())

const isPeerEnvelope = (value: unknown): value is PeerEnvelope => {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false
  const item = value as Record<string, unknown>
  if (item.kind === 'ack') return typeof item.id === 'string'
  if (item.kind === 'typing') return typeof item.active === 'boolean'
  return (
    item.kind === 'chat' &&
    typeof item.id === 'string' &&
    typeof item.text === 'string' &&
    item.text.length <= MAX_MESSAGE_LENGTH &&
    typeof item.sentAt === 'string'
  )
}

const isFileControl = (value: unknown): value is FileControlEnvelope => {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false
  const item = value as Record<string, unknown>
  if (item.kind === 'file_done' || item.kind === 'file_cancel') {
    return typeof item.transferId === 'string'
  }
  return (
    item.kind === 'file_meta' &&
    typeof item.transferId === 'string' &&
    typeof item.name === 'string' &&
    typeof item.size === 'number' &&
    item.size >= 0 &&
    item.size <= MAX_FILE_SIZE &&
    typeof item.mimeType === 'string'
  )
}

export function usePeerSession() {
  const [phase, setPhase] = useState<SessionPhase>('idle')
  const [roomCode, setRoomCode] = useState('')
  const [peerId, setPeerId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [transfers, setTransfers] = useState<FileTransfer[]>([])
  const [events, setEvents] = useState<ConnectionEvent[]>([])
  const [error, setError] = useState('')
  const [failureHelp, setFailureHelp] = useState('')
  const [peerTyping, setPeerTyping] = useState(false)

  const signalRef = useRef<SignalClient | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const chatChannelRef = useRef<RTCDataChannel | null>(null)
  const fileChannelRef = useRef<RTCDataChannel | null>(null)
  const turnConfiguredRef = useRef(false)
  const queuedCandidatesRef = useRef<IceCandidatePayload[]>([])
  const localCandidatesRef = useRef<string[]>([])
  const remoteCandidatesRef = useRef<string[]>([])
  const incomingFileRef = useRef<{
    id: string
    name: string
    size: number
    mimeType: string
    chunks: ArrayBuffer[]
    received: number
  } | null>(null)
  const cancelledTransfersRef = useRef(new Set<string>())
  const transferUrlsRef = useRef(new Set<string>())
  const signalHandlerRef = useRef<(message: ServerSignal) => void>(() => undefined)
  const intentionalCloseRef = useRef(false)
  const phaseRef = useRef<SessionPhase>('idle')

  const changePhase = useCallback((next: SessionPhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const addEvent = useCallback(
    (label: string, detail: string, tone: ConnectionEvent['tone'] = 'neutral') => {
      setEvents((current) =>
        [
          ...current,
          { id: crypto.randomUUID(), at: eventTime(), label, detail, tone },
        ].slice(-30),
      )
    },
    [],
  )

  const updateTransfer = useCallback((id: string, patch: Partial<FileTransfer>) => {
    setTransfers((current) =>
      current.map((transfer) => (transfer.id === id ? { ...transfer, ...patch } : transfer)),
    )
  }, [])

  const handleChatMessage = useCallback((event: MessageEvent<string>) => {
    if (typeof event.data !== 'string') return
    try {
      const envelope = JSON.parse(event.data) as unknown
      if (!isPeerEnvelope(envelope)) return
      if (envelope.kind === 'chat') {
        setMessages((current) => [
          ...current,
          {
            id: envelope.id,
            text: envelope.text,
            sentAt: envelope.sentAt,
            direction: 'incoming',
            status: 'delivered',
          },
        ])
        chatChannelRef.current?.send(JSON.stringify({ kind: 'ack', id: envelope.id }))
      } else if (envelope.kind === 'ack') {
        setMessages((current) =>
          current.map((message) =>
            message.id === envelope.id ? { ...message, status: 'delivered' } : message,
          ),
        )
      } else {
        setPeerTyping(envelope.active)
      }
    } catch {
      // Ignore malformed peer payloads without disrupting the channel.
    }
  }, [])

  const handleFileMessage = useCallback(
    (event: MessageEvent<string | ArrayBuffer>) => {
      if (event.data instanceof ArrayBuffer) {
        const incoming = incomingFileRef.current
        if (!incoming) return
        incoming.chunks.push(event.data)
        incoming.received += event.data.byteLength
        updateTransfer(incoming.id, {
          progress: Math.min(100, Math.round((incoming.received / incoming.size) * 100)),
        })
        return
      }

      try {
        const control = JSON.parse(event.data) as unknown
        if (!isFileControl(control)) return
        if (control.kind === 'file_meta') {
          incomingFileRef.current = {
            id: control.transferId,
            name: control.name,
            size: control.size,
            mimeType: control.mimeType,
            chunks: [],
            received: 0,
          }
          setTransfers((current) => [
            ...current,
            {
              id: control.transferId,
              name: control.name,
              size: control.size,
              progress: 0,
              direction: 'incoming',
              status: 'transferring',
            },
          ])
          return
        }

        const incoming = incomingFileRef.current
        if (!incoming || incoming.id !== control.transferId) return
        if (control.kind === 'file_cancel') {
          updateTransfer(incoming.id, { status: 'cancelled' })
          incomingFileRef.current = null
          return
        }

        const blob = new Blob(incoming.chunks, { type: incoming.mimeType })
        const url = URL.createObjectURL(blob)
        transferUrlsRef.current.add(url)
        updateTransfer(incoming.id, { status: 'complete', progress: 100, url })
        incomingFileRef.current = null
        addEvent('File received', `${incoming.name} arrived directly from your peer.`, 'success')
      } catch {
        // Ignore malformed peer payloads without disrupting the channel.
      }
    },
    [addEvent, updateTransfer],
  )

  const attachChannel = useCallback(
    (channel: RTCDataChannel) => {
      if (channel.label === 'chat') {
        chatChannelRef.current = channel
        channel.addEventListener('message', handleChatMessage)
        channel.addEventListener('open', () => {
          changePhase('connected')
          setError('')
          addEvent('Direct channel open', 'Messages now travel browser to browser.', 'success')
        })
        channel.addEventListener('close', () => {
          if (phaseRef.current !== 'idle') changePhase('disconnected')
        })
      } else if (channel.label === 'files') {
        fileChannelRef.current = channel
        channel.binaryType = 'arraybuffer'
        channel.addEventListener('message', handleFileMessage)
      }
    },
    [addEvent, changePhase, handleChatMessage, handleFileMessage],
  )

  const closePeer = useCallback(() => {
    chatChannelRef.current?.close()
    fileChannelRef.current?.close()
    peerRef.current?.close()
    chatChannelRef.current = null
    fileChannelRef.current = null
    peerRef.current = null
    turnConfiguredRef.current = false
    queuedCandidatesRef.current = []
    localCandidatesRef.current = []
    remoteCandidatesRef.current = []
    incomingFileRef.current = null
    setPeerTyping(false)
  }, [])

  const ensurePeer = useCallback(
    async (initiator: boolean) => {
      if (peerRef.current) return peerRef.current
      const { connection: peer, turnConfigured } = await createPeerConnection()
      if (peerRef.current) {
        peer.close()
        return peerRef.current
      }
      peerRef.current = peer
      turnConfiguredRef.current = turnConfigured
      addEvent(
        'Peer connection created',
        turnConfigured
          ? 'Direct routes and a managed TURN fallback are available.'
          : 'The browsers are preparing a direct route.',
        'active',
      )

      peer.addEventListener('icecandidate', (event) => {
        if (!event.candidate) {
          addEvent('ICE gathering complete', 'All available network routes were checked.')
          return
        }
        localCandidatesRef.current.push(event.candidate.candidate)
        signalRef.current?.send({
          type: 'ice_candidate',
          candidate: toCandidatePayload(event.candidate),
        })
      })
      peer.addEventListener('connectionstatechange', () => {
        if (peer.connectionState === 'connected') {
          changePhase('connected')
        } else if (peer.connectionState === 'disconnected') {
          changePhase('reconnecting')
          addEvent('Route interrupted', 'The browser is attempting to recover the connection.', 'danger')
        } else if (peer.connectionState === 'failed') {
          const diagnosis = diagnoseIceFailure({
            localCandidates: localCandidatesRef.current,
            remoteCandidates: remoteCandidatesRef.current,
            turnConfigured: turnConfiguredRef.current,
          })
          changePhase('disconnected')
          setError(diagnosis.title)
          setFailureHelp(diagnosis.detail)
          addEvent(diagnosis.title, diagnosis.detail, 'danger')
        }
      })
      peer.addEventListener('datachannel', (event) => attachChannel(event.channel))

      if (initiator) {
        attachChannel(peer.createDataChannel('chat', { ordered: true }))
        attachChannel(peer.createDataChannel('files', { ordered: true }))
      }
      return peer
    },
    [addEvent, attachChannel, changePhase],
  )

  const flushCandidates = useCallback(async (peer: RTCPeerConnection) => {
    const candidates = queuedCandidatesRef.current
    queuedCandidatesRef.current = []
    for (const candidate of candidates) await peer.addIceCandidate(candidate)
  }, [])

  const createOffer = useCallback(async () => {
    try {
      changePhase('connecting')
      addEvent('Peer found', 'Creating an offer for the direct connection.', 'active')
      const peer = await ensurePeer(true)
      await peer.setLocalDescription(await peer.createOffer())
      signalRef.current?.send({
        type: 'offer',
        description: toDescriptionPayload(peer.localDescription),
      })
      addEvent('Offer sent', 'Connection details went through signaling only.')
    } catch {
      changePhase('failed')
      setError('Could not create a WebRTC offer in this browser.')
    }
  }, [addEvent, changePhase, ensurePeer])

  const handleSignal = useCallback(
    async (message: ServerSignal) => {
      if (message.type === 'room_created' || message.type === 'room_joined') {
        setRoomCode(message.roomCode)
        setPeerId(message.peerId)
        setError('')
        changePhase(message.type === 'room_created' ? 'waiting' : 'connecting')
        addEvent(
          message.type === 'room_created' ? 'Room ready' : 'Room joined',
          message.type === 'room_created'
            ? 'Waiting for the second browser.'
            : 'Waiting for the peer connection offer.',
          'active',
        )
        return
      }
      if (message.type === 'peer_joined') {
        await createOffer()
        return
      }
      if (message.type === 'offer') {
        try {
          changePhase('connecting')
          addEvent('Offer received', 'Preparing the response in this browser.', 'active')
          const peer = await ensurePeer(false)
          await peer.setRemoteDescription(message.description)
          await flushCandidates(peer)
          await peer.setLocalDescription(await peer.createAnswer())
          signalRef.current?.send({
            type: 'answer',
            description: toDescriptionPayload(peer.localDescription),
          })
          addEvent('Answer sent', 'The peer can now complete negotiation.')
        } catch {
          changePhase('failed')
          setError('Could not accept the peer connection offer.')
        }
        return
      }
      if (message.type === 'answer') {
        try {
          const peer = peerRef.current
          if (!peer) return
          await peer.setRemoteDescription(message.description)
          await flushCandidates(peer)
          addEvent('Answer received', 'Negotiation is complete; opening the data channel.', 'active')
        } catch {
          changePhase('failed')
          setError('Could not complete WebRTC negotiation.')
        }
        return
      }
      if (message.type === 'ice_candidate') {
        remoteCandidatesRef.current.push(message.candidate.candidate)
        const peer = peerRef.current
        if (!peer?.remoteDescription) queuedCandidatesRef.current.push(message.candidate)
        else await peer.addIceCandidate(message.candidate)
        return
      }
      if (message.type === 'peer_left') {
        closePeer()
        changePhase('disconnected')
        setError('The other person left. This room is still available for them to rejoin.')
        addEvent('Peer left', 'The direct connection was closed.', 'danger')
        return
      }
      if (message.type === 'error') {
        setError(message.message)
        if (message.code === 'room_not_found' || message.code === 'room_full') {
          changePhase('failed')
        }
        addEvent('Signaling error', message.message, 'danger')
      }
    },
    [addEvent, changePhase, closePeer, createOffer, ensurePeer, flushCandidates],
  )

  useEffect(() => {
    signalHandlerRef.current = (message) => {
      void handleSignal(message)
    }
  }, [handleSignal])

  const openSignal = useCallback(async () => {
    intentionalCloseRef.current = true
    signalRef.current?.close(false)
    intentionalCloseRef.current = false
    const signal = new SignalClient({
      onMessage: (message) => signalHandlerRef.current(message),
      onClose: () => {
        if (intentionalCloseRef.current) return
        if (chatChannelRef.current?.readyState === 'open') {
          addEvent('Signaling offline', 'The direct data channel is still active.', 'danger')
          return
        }
        changePhase('disconnected')
        setError('The signaling server disconnected. Try joining the room again.')
      },
      onError: (message) => setError(message),
    })
    signalRef.current = signal
    await signal.connect()
    addEvent('Signaling connected', 'Ready to exchange connection details.')
    return signal
  }, [addEvent, changePhase])

  const resetContent = useCallback(() => {
    setMessages([])
    for (const url of transferUrlsRef.current) URL.revokeObjectURL(url)
    transferUrlsRef.current.clear()
    setTransfers([])
    setEvents([])
    setError('')
    setFailureHelp('')
  }, [])

  const createRoom = useCallback(async () => {
    resetContent()
    closePeer()
    changePhase('signaling')
    try {
      const signal = await openSignal()
      signal.send({ type: 'create_room' })
    } catch {
      changePhase('failed')
    }
  }, [changePhase, closePeer, openSignal, resetContent])

  const joinRoom = useCallback(
    async (rawCode: string) => {
      const code = normalizeRoomCode(rawCode)
      if (!ROOM_CODE_PATTERN.test(code)) {
        setError('Enter the complete 8-character room code.')
        return
      }
      resetContent()
      closePeer()
      changePhase('signaling')
      try {
        const signal = await openSignal()
        signal.send({ type: 'join_room', roomCode: code })
      } catch {
        changePhase('failed')
      }
    },
    [changePhase, closePeer, openSignal, resetContent],
  )

  const leave = useCallback(() => {
    intentionalCloseRef.current = true
    signalRef.current?.close()
    signalRef.current = null
    closePeer()
    setRoomCode('')
    setPeerId('')
    setError('')
    setFailureHelp('')
    changePhase('idle')
    intentionalCloseRef.current = false
  }, [changePhase, closePeer])

  const retry = useCallback(async () => {
    if (!roomCode) return
    closePeer()
    setError('')
    setFailureHelp('')
    changePhase('reconnecting')
    if (signalRef.current?.isOpen()) {
      changePhase('waiting')
      addEvent('Waiting again', 'The room is ready for the other browser to rejoin.', 'active')
      return
    }
    try {
      const signal = await openSignal()
      signal.send({ type: 'join_room', roomCode })
    } catch {
      changePhase('failed')
    }
  }, [addEvent, changePhase, closePeer, openSignal, roomCode])

  const sendMessage = useCallback((rawText: string) => {
    const text = rawText.trim()
    const channel = chatChannelRef.current
    if (!text || text.length > MAX_MESSAGE_LENGTH || channel?.readyState !== 'open') return false
    const envelope: PeerEnvelope = {
      kind: 'chat',
      id: crypto.randomUUID(),
      text,
      sentAt: new Date().toISOString(),
    }
    channel.send(JSON.stringify(envelope))
    setMessages((current) => [
      ...current,
      {
        id: envelope.id,
        text: envelope.text,
        sentAt: envelope.sentAt,
        direction: 'outgoing',
        status: 'sent',
      },
    ])
    return true
  }, [])

  const sendTyping = useCallback((active: boolean) => {
    const channel = chatChannelRef.current
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify({ kind: 'typing', active } satisfies PeerEnvelope))
    }
  }, [])

  const sendFile = useCallback(
    async (file: File) => {
      const channel = fileChannelRef.current
      if (channel?.readyState !== 'open') throw new Error('The file channel is not connected.')
      if (file.size > MAX_FILE_SIZE) throw new Error('Choose a file smaller than 25 MB.')

      const id = crypto.randomUUID()
      setTransfers((current) => [
        ...current,
        {
          id,
          name: file.name,
          size: file.size,
          progress: 0,
          direction: 'outgoing',
          status: 'transferring',
        },
      ])
      channel.send(
        JSON.stringify({
          kind: 'file_meta',
          transferId: id,
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
        } satisfies FileControlEnvelope),
      )

      try {
        let sent = 0
        let lastProgress = -1
        while (sent < file.size) {
          if (cancelledTransfersRef.current.has(id)) {
            cancelledTransfersRef.current.delete(id)
            channel.send(JSON.stringify({ kind: 'file_cancel', transferId: id }))
            updateTransfer(id, { status: 'cancelled' })
            return
          }
          await waitForChannelBuffer(channel)
          const chunk = await file.slice(sent, sent + FILE_CHUNK_SIZE).arrayBuffer()
          channel.send(chunk)
          sent += chunk.byteLength
          const progress = Math.round((sent / file.size) * 100)
          if (progress !== lastProgress) {
            lastProgress = progress
            updateTransfer(id, { progress })
          }
        }
        channel.send(JSON.stringify({ kind: 'file_done', transferId: id }))
        updateTransfer(id, { status: 'complete', progress: 100 })
        addEvent('File sent', `${file.name} travelled over the direct data channel.`, 'success')
      } catch {
        updateTransfer(id, { status: 'failed' })
        throw new Error('The file transfer was interrupted.')
      }
    },
    [addEvent, updateTransfer],
  )

  const cancelTransfer = useCallback((id: string) => {
    cancelledTransfersRef.current.add(id)
  }, [])

  useEffect(
    () => () => {
      intentionalCloseRef.current = true
      signalRef.current?.close()
      closePeer()
      for (const url of transferUrlsRef.current) URL.revokeObjectURL(url)
    },
    [closePeer],
  )

  return {
    phase,
    roomCode,
    peerId,
    messages,
    transfers,
    events,
    error,
    failureHelp,
    peerTyping,
    maxFileSize: MAX_FILE_SIZE,
    createRoom,
    joinRoom,
    leave,
    retry,
    sendMessage,
    sendTyping,
    sendFile,
    cancelTransfer,
  }
}
