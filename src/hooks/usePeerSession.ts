import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ROOM_CODE_PATTERN,
  normalizeRoomCode,
  type IceCandidatePayload,
  type ServerSignal,
} from '../../shared/protocol'
import {
  createPeerConnection,
  detectConnectionRoute,
  diagnoseIceFailure,
  toCandidatePayload,
  toDescriptionPayload,
  waitForChannelBuffer,
  type ConnectionRoute,
} from '../lib/peer-connection'
import { SignalClient } from '../lib/signaling'
import { MAX_VOICE_DURATION_MS } from './useVoiceRecorder'
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

const resumeTokenKey = (roomCode: string) => `p4pair:resume:${roomCode}`

function readResumeToken(roomCode: string) {
  try {
    return window.sessionStorage.getItem(resumeTokenKey(roomCode)) ?? undefined
  } catch {
    return undefined
  }
}

function rememberRoom(roomCode: string, resumeToken: string) {
  try {
    window.sessionStorage.setItem(resumeTokenKey(roomCode), resumeToken)
    window.localStorage.setItem('p4pair:last-room', roomCode)
  } catch {
    // Rejoining still works normally when storage is unavailable.
  }
}

function forgetRoom(roomCode: string) {
  try {
    window.sessionStorage.removeItem(resumeTokenKey(roomCode))
    if (window.localStorage.getItem('p4pair:last-room') === roomCode) {
      window.localStorage.removeItem('p4pair:last-room')
    }
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

const eventTime = () =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date())

export const isPeerEnvelope = (value: unknown): value is PeerEnvelope => {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false
  const item = value as Record<string, unknown>
  if (item.kind === 'ack') return typeof item.id === 'string'
  if (item.kind === 'seen') {
    return (
      Array.isArray(item.ids) &&
      item.ids.length <= 100 &&
      item.ids.every((id) => typeof id === 'string')
    )
  }
  if (item.kind === 'profile') {
    return (
      typeof item.name === 'string' &&
      item.name.trim().length >= 2 &&
      item.name.trim().length <= 24
    )
  }
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
    (item.category === 'file' || item.category === 'voice') &&
    typeof item.transferId === 'string' &&
    typeof item.name === 'string' &&
    typeof item.size === 'number' &&
    item.size >= 0 &&
    item.size <= MAX_FILE_SIZE &&
    typeof item.mimeType === 'string' &&
    typeof item.sentAt === 'string' &&
    item.sentAt.length <= 64 &&
    Number.isFinite(Date.parse(item.sentAt)) &&
    (item.category === 'file' ||
      (item.mimeType.startsWith('audio/') &&
        typeof item.durationMs === 'number' &&
        item.durationMs > 0 &&
        item.durationMs <= MAX_VOICE_DURATION_MS &&
        Array.isArray(item.waveform) &&
        item.waveform.length <= 64 &&
        item.waveform.every(
          (level) => typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1,
        )))
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
  const [route, setRoute] = useState<ConnectionRoute | null>(null)
  const [peerTyping, setPeerTyping] = useState(false)
  const [displayName, setDisplayNameState] = useState(() => {
    try {
      return window.localStorage.getItem('p4pair:display-name') ?? ''
    } catch {
      return ''
    }
  })
  const [peerName, setPeerName] = useState('')

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
    category: 'file' | 'voice'
    sentAt: string
    durationMs?: number
    waveform?: number[]
    chunks: ArrayBuffer[]
    received: number
  } | null>(null)
  const cancelledTransfersRef = useRef(new Set<string>())
  const pendingSeenRef = useRef(new Set<string>())
  const transferUrlsRef = useRef(new Set<string>())
  const signalHandlerRef = useRef<(message: ServerSignal) => void>(() => undefined)
  const intentionalCloseRef = useRef(false)
  const phaseRef = useRef<SessionPhase>('idle')
  const displayNameRef = useRef(displayName)

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

  const sendSeen = useCallback((ids: string[]) => {
    const channel = chatChannelRef.current
    if (channel?.readyState !== 'open' || ids.length === 0) return
    channel.send(JSON.stringify({ kind: 'seen', ids } satisfies PeerEnvelope))
    for (const id of ids) pendingSeenRef.current.delete(id)
  }, [])

  const handleChatMessage = useCallback(
    (event: MessageEvent<string>) => {
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
          if (document.visibilityState === 'visible' && document.hasFocus()) {
            sendSeen([envelope.id])
          } else {
            pendingSeenRef.current.add(envelope.id)
          }
        } else if (envelope.kind === 'ack') {
          setMessages((current) =>
            current.map((message) =>
              message.id === envelope.id && message.status === 'sent'
                ? { ...message, status: 'delivered' }
                : message,
            ),
          )
        } else if (envelope.kind === 'seen') {
          const seenIds = new Set(envelope.ids)
          setMessages((current) =>
            current.map((message) =>
              message.direction === 'outgoing' && seenIds.has(message.id)
                ? { ...message, status: 'seen' }
                : message,
            ),
          )
        } else if (envelope.kind === 'profile') {
          setPeerName(envelope.name.trim())
        } else {
          setPeerTyping(envelope.active)
        }
      } catch {
        // Ignore malformed peer payloads without disrupting the channel.
      }
    },
    [sendSeen],
  )

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
            category: control.category,
            sentAt: control.sentAt,
            durationMs: control.category === 'voice' ? control.durationMs : undefined,
            waveform: control.category === 'voice' ? control.waveform : undefined,
            chunks: [],
            received: 0,
          }
          setTransfers((current) => [
            ...current,
            {
              id: control.transferId,
              category: control.category,
              sentAt: control.sentAt,
              name: control.name,
              size: control.size,
              durationMs: control.category === 'voice' ? control.durationMs : undefined,
              waveform: control.category === 'voice' ? control.waveform : undefined,
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
        addEvent(
          incoming.category === 'voice' ? 'Voice note received' : 'File received',
          `${incoming.name} arrived over the WebRTC data channel.`,
          'success',
        )
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
          const name = displayNameRef.current.trim()
          if (name) {
            channel.send(JSON.stringify({ kind: 'profile', name } satisfies PeerEnvelope))
          }
          addEvent('Direct channel open', 'Messages now travel browser to browser.', 'success')
        })
        channel.addEventListener('close', () => {
          if (chatChannelRef.current === channel && phaseRef.current !== 'idle') {
            changePhase('disconnected')
          }
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
    const chatChannel = chatChannelRef.current
    const fileChannel = fileChannelRef.current
    const peer = peerRef.current
    chatChannelRef.current = null
    fileChannelRef.current = null
    peerRef.current = null
    chatChannel?.close()
    fileChannel?.close()
    peer?.close()
    turnConfiguredRef.current = false
    setRoute(null)
    queuedCandidatesRef.current = []
    localCandidatesRef.current = []
    remoteCandidatesRef.current = []
    incomingFileRef.current = null
    pendingSeenRef.current.clear()
    setPeerTyping(false)
    setPeerName('')
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
          void detectConnectionRoute(peer).then((detectedRoute) => {
            if (peerRef.current !== peer) return
            setRoute(detectedRoute)
            addEvent('Route selected', detectedRoute.detail, 'success')
          })
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
        rememberRoom(message.roomCode, message.resumeToken)
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
        closePeer()
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
        if (message.code === 'room_full') {
          setFailureHelp(
            'The server still sees two browser sessions. Reopen the same invitation in the original browser to reclaim its place, or wait up to 30 seconds for an abandoned mobile session to expire.',
          )
        }
        if (message.code === 'room_not_found' && roomCode) forgetRoom(roomCode)
        if (message.code === 'room_not_found' || message.code === 'room_full') {
          changePhase('failed')
        }
        addEvent('Signaling error', message.message, 'danger')
      }
    },
    [addEvent, changePhase, closePeer, createOffer, ensurePeer, flushCandidates, roomCode],
  )

  useEffect(() => {
    signalHandlerRef.current = (message) => {
      void handleSignal(message)
    }
  }, [handleSignal])

  useEffect(() => {
    const flushSeen = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      const ids = [...pendingSeenRef.current]
      for (let index = 0; index < ids.length; index += 100) {
        sendSeen(ids.slice(index, index + 100))
      }
    }
    document.addEventListener('visibilitychange', flushSeen)
    window.addEventListener('focus', flushSeen)
    return () => {
      document.removeEventListener('visibilitychange', flushSeen)
      window.removeEventListener('focus', flushSeen)
    }
  }, [sendSeen])

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
        const resumeToken = readResumeToken(code)
        signal.send({
          type: 'join_room',
          roomCode: code,
          ...(resumeToken ? { resumeToken } : {}),
        })
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
    forgetRoom(roomCode)
    setRoomCode('')
    setPeerId('')
    setError('')
    setFailureHelp('')
    changePhase('idle')
    intentionalCloseRef.current = false
  }, [changePhase, closePeer, roomCode])

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
      const resumeToken = readResumeToken(roomCode)
      signal.send({
        type: 'join_room',
        roomCode,
        ...(resumeToken ? { resumeToken } : {}),
      })
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

  const setDisplayName = useCallback((value: string) => {
    const name = value.slice(0, 24)
    displayNameRef.current = name
    setDisplayNameState(name)
    try {
      window.localStorage.setItem('p4pair:display-name', name)
    } catch {
      // The name still works for the current page when storage is unavailable.
    }
    const trimmed = name.trim()
    const channel = chatChannelRef.current
    if (trimmed.length >= 2 && channel?.readyState === 'open') {
      channel.send(JSON.stringify({ kind: 'profile', name: trimmed } satisfies PeerEnvelope))
    }
  }, [])

  const sendTransfer = useCallback(
    async ({
      blob,
      name,
      category,
      durationMs,
      waveform,
    }: {
      blob: Blob
      name: string
      category: 'file' | 'voice'
      durationMs?: number
      waveform?: number[]
    }) => {
      const channel = fileChannelRef.current
      if (channel?.readyState !== 'open') throw new Error('The file channel is not connected.')
      if (blob.size > MAX_FILE_SIZE) throw new Error('Choose a file smaller than 25 MB.')

      const id = crypto.randomUUID()
      const sentAt = new Date().toISOString()
      const localUrl = category === 'voice' ? URL.createObjectURL(blob) : undefined
      if (localUrl) transferUrlsRef.current.add(localUrl)
      setTransfers((current) => [
        ...current,
        {
          id,
          category,
          sentAt,
          name,
          size: blob.size,
          durationMs,
          waveform,
          progress: 0,
          direction: 'outgoing',
          status: 'transferring',
          url: localUrl,
        },
      ])
      const metadata: FileControlEnvelope =
        category === 'voice'
          ? {
              kind: 'file_meta',
              category,
              transferId: id,
              name,
              size: blob.size,
              mimeType: blob.type || 'audio/webm',
              sentAt,
              durationMs: durationMs ?? 0,
              waveform: waveform ?? [],
            }
          : {
          kind: 'file_meta',
              category,
          transferId: id,
              name,
              size: blob.size,
              mimeType: blob.type || 'application/octet-stream',
              sentAt,
            }
      channel.send(JSON.stringify(metadata))

      try {
        let sent = 0
        let lastProgress = -1
        while (sent < blob.size) {
          if (cancelledTransfersRef.current.has(id)) {
            cancelledTransfersRef.current.delete(id)
            channel.send(JSON.stringify({ kind: 'file_cancel', transferId: id }))
            updateTransfer(id, { status: 'cancelled' })
            return
          }
          await waitForChannelBuffer(channel)
          const chunk = await blob.slice(sent, sent + FILE_CHUNK_SIZE).arrayBuffer()
          channel.send(chunk)
          sent += chunk.byteLength
          const progress = Math.round((sent / blob.size) * 100)
          if (progress !== lastProgress) {
            lastProgress = progress
            updateTransfer(id, { progress })
          }
        }
        channel.send(JSON.stringify({ kind: 'file_done', transferId: id }))
        updateTransfer(id, { status: 'complete', progress: 100 })
        addEvent(
          category === 'voice' ? 'Voice note sent' : 'File sent',
          `${name} travelled over the WebRTC data channel.`,
          'success',
        )
      } catch {
        updateTransfer(id, { status: 'failed' })
        throw new Error('The file transfer was interrupted.')
      }
    },
    [addEvent, updateTransfer],
  )

  const sendFile = useCallback(
    (file: File) =>
      sendTransfer({
        blob: file,
        name: file.name,
        category: 'file',
      }),
    [sendTransfer],
  )

  const sendVoice = useCallback(
    (blob: Blob, durationMs: number, waveform: number[]) => {
      if (!blob.type.startsWith('audio/')) throw new Error('The recording format is invalid.')
      if (durationMs <= 0 || durationMs > MAX_VOICE_DURATION_MS) {
        throw new Error('Voice notes can be up to two minutes long.')
      }
      const extension = blob.type.includes('mp4')
        ? 'm4a'
        : blob.type.includes('ogg')
          ? 'ogg'
          : 'webm'
      return sendTransfer({
        blob,
        name: `Voice message.${extension}`,
        category: 'voice',
        durationMs,
        waveform,
      })
    },
    [sendTransfer],
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
    route,
    peerTyping,
    displayName,
    peerName,
    maxFileSize: MAX_FILE_SIZE,
    createRoom,
    joinRoom,
    leave,
    retry,
    sendMessage,
    sendTyping,
    setDisplayName,
    sendFile,
    sendVoice,
    cancelTransfer,
  }
}
