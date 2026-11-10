import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ROOM_CODE_PATTERN,
  normalizeRoomCode,
  type IceCandidatePayload,
  type RoomType,
  type ServerSignal,
} from '../../shared/protocol'
import {
  createPeerConnection,
  detectConnectionRoute,
  diagnoseIceFailure,
  measureConnectionQuality,
  toCandidatePayload,
  toDescriptionPayload,
  waitForChannelBuffer,
  type ConnectionQuality,
  type ConnectionRoute,
} from '../lib/peer-connection'
import {
  callControlMatches,
  IDLE_CALL,
  isCallEnvelope,
  localInviteWins,
  mediaRequestIsCurrent,
  microphoneErrorMessage,
} from '../lib/live-call'
import { SignalClient } from '../lib/signaling'
import { MAX_VOICE_DURATION_MS } from './useVoiceRecorder'
import type {
  ChatMessage,
  CallEnvelope,
  ConnectionEvent,
  EmojiReaction,
  FileControlEnvelope,
  FileTransfer,
  PeerEnvelope,
  ReplyReference,
  LiveCallState,
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

export type SessionPeer = {
  peerId: string
  name: string
  phase: 'connecting' | 'connected' | 'disconnected' | 'failed'
  route: ConnectionRoute | null
  quality: ConnectionQuality | null
  typing: boolean
}

type PeerLink = SessionPeer & {
  connection: RTCPeerConnection
  chatChannel: RTCDataChannel | null
  fileChannel: RTCDataChannel | null
  queuedCandidates: IceCandidatePayload[]
  localCandidates: string[]
  remoteCandidates: string[]
  turnConfigured: boolean
  qualityTimer: number | null
  audioSender: RTCRtpSender | null
}

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

function readPersistentResumeToken(roomCode: string) {
  try {
    return window.localStorage.getItem(resumeTokenKey(roomCode)) ?? undefined
  } catch {
    return undefined
  }
}

function rememberRoom(roomCode: string, resumeToken: string) {
  try {
    window.sessionStorage.setItem(resumeTokenKey(roomCode), resumeToken)
    window.localStorage.setItem(resumeTokenKey(roomCode), resumeToken)
    window.localStorage.setItem('p4pair:last-room', roomCode)
  } catch {
    // Rejoining still works normally when storage is unavailable.
  }
}

function forgetRoom(roomCode: string) {
  try {
    window.sessionStorage.removeItem(resumeTokenKey(roomCode))
    window.localStorage.removeItem(resumeTokenKey(roomCode))
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

const REACTIONS = new Set<EmojiReaction>(['👍', '❤️', '😂', '😮', '😢', '🙏'])

const isReplyReference = (value: unknown): value is ReplyReference => {
  if (!value || typeof value !== 'object') return false
  const reply = value as Record<string, unknown>
  return (
    typeof reply.id === 'string' &&
    typeof reply.text === 'string' &&
    reply.text.length <= 180 &&
    typeof reply.author === 'string' &&
    reply.author.length <= 24 &&
    (reply.authorId === undefined ||
      (typeof reply.authorId === 'string' && reply.authorId.length <= 128))
  )
}

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
  if (item.kind === 'reaction') {
    return (
      typeof item.messageId === 'string' &&
      typeof item.emoji === 'string' &&
      REACTIONS.has(item.emoji as EmojiReaction)
    )
  }
  if (item.kind === 'message_edit') {
    return (
      typeof item.messageId === 'string' &&
      typeof item.text === 'string' &&
      item.text.trim().length > 0 &&
      item.text.length <= MAX_MESSAGE_LENGTH &&
      typeof item.editedAt === 'string' &&
      Number.isFinite(Date.parse(item.editedAt))
    )
  }
  if (item.kind === 'message_delete') {
    return (
      typeof item.messageId === 'string' &&
      typeof item.deletedAt === 'string' &&
      Number.isFinite(Date.parse(item.deletedAt))
    )
  }
  if (typeof item.kind === 'string' && item.kind.startsWith('call_')) {
    return isCallEnvelope(item)
  }
  if (item.kind === 'typing') return typeof item.active === 'boolean'
  return (
    item.kind === 'chat' &&
    typeof item.id === 'string' &&
    typeof item.text === 'string' &&
    item.text.length <= MAX_MESSAGE_LENGTH &&
    typeof item.sentAt === 'string' &&
    (item.replyTo === undefined || isReplyReference(item.replyTo))
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
  const [roomType, setRoomType] = useState<RoomType>('private')
  const [peerId, setPeerId] = useState('')
  const [peers, setPeers] = useState<SessionPeer[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [transfers, setTransfers] = useState<FileTransfer[]>([])
  const [events, setEvents] = useState<ConnectionEvent[]>([])
  const [error, setError] = useState('')
  const [failureHelp, setFailureHelp] = useState('')
  const [route, setRoute] = useState<ConnectionRoute | null>(null)
  const [quality, setQuality] = useState<ConnectionQuality | null>(null)
  const [peerTyping, setPeerTyping] = useState(false)
  const [displayName, setDisplayNameState] = useState(() => {
    try {
      return window.localStorage.getItem('p4pair:display-name') ?? ''
    } catch {
      return ''
    }
  })
  const [peerName, setPeerName] = useState('')
  const [call, setCall] = useState<LiveCallState>(IDLE_CALL)
  const [remoteCallStream, setRemoteCallStream] = useState<MediaStream | null>(null)

  const signalRef = useRef<SignalClient | null>(null)
  const linksRef = useRef(new Map<string, PeerLink>())
  const localPeerIdRef = useRef('')
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
  const pendingSeenRef = useRef(new Map<string, Set<string>>())
  const transferUrlsRef = useRef(new Set<string>())
  const signalHandlerRef = useRef<(message: ServerSignal) => void>(() => undefined)
  const intentionalCloseRef = useRef(false)
  const phaseRef = useRef<SessionPhase>('idle')
  const displayNameRef = useRef(displayName)
  const pendingRoomCodeRef = useRef('')
  const resumeAttemptedRef = useRef(false)
  const callRef = useRef<LiveCallState>(IDLE_CALL)
  const localCallStreamRef = useRef<MediaStream | null>(null)
  const mediaGenerationRef = useRef(0)

  const changePhase = useCallback((next: SessionPhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const changeCall = useCallback((next: LiveCallState) => {
    callRef.current = next
    setCall(next)
  }, [])

  const sendCallControl = useCallback((remotePeerId: string, envelope: CallEnvelope) => {
    const channel = linksRef.current.get(remotePeerId)?.chatChannel
    if (channel?.readyState !== 'open') return false
    channel.send(JSON.stringify(envelope))
    return true
  }, [])

  const detachLocalAudio = useCallback(() => {
    mediaGenerationRef.current += 1
    const stream = localCallStreamRef.current
    localCallStreamRef.current = null
    stream?.getTracks().forEach((track) => track.stop())
    for (const link of linksRef.current.values()) {
      if (link.audioSender) void link.audioSender.replaceTrack(null).catch(() => undefined)
    }
  }, [])

  const clearCall = useCallback((failure = '') => {
    detachLocalAudio()
    changeCall(
      failure
        ? {
            ...IDLE_CALL,
            phase: 'failed',
            error: failure,
          }
        : IDLE_CALL,
    )
  }, [changeCall, detachLocalAudio])

  const acquireLocalAudio = useCallback(async (callId: string, remotePeerId: string) => {
    const generation = mediaGenerationRef.current + 1
    mediaGenerationRef.current = generation
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (
        !mediaRequestIsCurrent(
          generation,
          mediaGenerationRef.current,
          callRef.current,
          callId,
          remotePeerId,
        )
      ) {
        stream.getTracks().forEach((track) => track.stop())
        return false
      }
      const link = linksRef.current.get(remotePeerId)
      const sender =
        link?.audioSender ??
        link?.connection
          .getTransceivers()
          .find((transceiver) => transceiver.receiver.track.kind === 'audio')?.sender ??
        null
      const track = stream.getAudioTracks()[0]
      if (!link || !sender || !track) {
        stream.getTracks().forEach((candidate) => candidate.stop())
        throw new Error('The private audio route is not available.')
      }
      link.audioSender = sender
      await sender.replaceTrack(track)
      if (
        !mediaRequestIsCurrent(
          generation,
          mediaGenerationRef.current,
          callRef.current,
          callId,
          remotePeerId,
        )
      ) {
        await sender.replaceTrack(null).catch(() => undefined)
        stream.getTracks().forEach((candidate) => candidate.stop())
        return false
      }
      localCallStreamRef.current = stream
      track.addEventListener(
        'ended',
        () => {
          const current = callRef.current
          if (current.callId !== callId) return
          sendCallControl(remotePeerId, {
            kind: 'call_end',
            callId,
            reason: 'microphone_ended',
          })
          clearCall('The microphone stopped. Start a new call to reconnect it.')
        },
        { once: true },
      )
      return true
    } catch (mediaError) {
      stream?.getTracks().forEach((track) => track.stop())
      if (generation !== mediaGenerationRef.current) return false
      clearCall(microphoneErrorMessage(mediaError))
      return false
    }
  }, [clearCall, sendCallControl])

  const syncPeers = useCallback(() => {
    const nextPeers = [...linksRef.current.values()].map(
      ({ peerId: remotePeerId, name, phase: linkPhase, route: linkRoute, quality: linkQuality, typing }) => ({
        peerId: remotePeerId,
        name,
        phase: linkPhase,
        route: linkRoute,
        quality: linkQuality,
        typing,
      }),
    )
    setPeers(nextPeers)
    const first = nextPeers[0]
    setPeerName(first?.name ?? '')
    setPeerTyping(nextPeers.some((peer) => peer.typing))
    setRoute(first?.route ?? null)
    setQuality(first?.quality ?? null)
  }, [])

  const broadcastChat = useCallback((envelope: PeerEnvelope) => {
    const recipients: string[] = []
    const payload = JSON.stringify(envelope)
    for (const link of linksRef.current.values()) {
      if (link.chatChannel?.readyState !== 'open') continue
      link.chatChannel.send(payload)
      recipients.push(link.peerId)
    }
    return recipients
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

  const sendSeen = useCallback((remotePeerId: string, ids: string[]) => {
    const channel = linksRef.current.get(remotePeerId)?.chatChannel
    if (channel?.readyState !== 'open' || ids.length === 0) return
    channel.send(JSON.stringify({ kind: 'seen', ids } satisfies PeerEnvelope))
    const pending = pendingSeenRef.current.get(remotePeerId)
    for (const id of ids) pending?.delete(id)
  }, [])

  const handleCallControl = useCallback(
    (remotePeerId: string, envelope: CallEnvelope) => {
      if (roomType !== 'private') return
      const current = callRef.current

      if (envelope.kind === 'call_invite') {
        if (current.callId === envelope.callId) return
        if (current.phase === 'idle' || current.phase === 'failed') {
          changeCall({
            ...IDLE_CALL,
            phase: 'incoming_ringing',
            callId: envelope.callId,
            peerId: remotePeerId,
            peerName: linksRef.current.get(remotePeerId)?.name || 'Peer',
          })
          return
        }
        if (
          current.phase === 'outgoing_ringing' &&
          current.peerId === remotePeerId &&
          !localInviteWins(localPeerIdRef.current, remotePeerId)
        ) {
          sendCallControl(remotePeerId, { kind: 'call_cancel', callId: current.callId })
          changeCall({
            ...IDLE_CALL,
            phase: 'incoming_ringing',
            callId: envelope.callId,
            peerId: remotePeerId,
            peerName: linksRef.current.get(remotePeerId)?.name || 'Peer',
          })
          return
        }
        sendCallControl(remotePeerId, {
          kind: 'call_decline',
          callId: envelope.callId,
          reason: 'busy',
        })
        return
      }

      if (!callControlMatches(current, remotePeerId, envelope)) return
      if (envelope.kind === 'call_accept' && current.phase === 'outgoing_ringing') {
        changeCall({ ...current, phase: 'connecting', error: '' })
        void acquireLocalAudio(envelope.callId, remotePeerId).then((ready) => {
          const activeCall = callRef.current
          if (!ready) {
            if (activeCall.phase === 'failed') {
              sendCallControl(remotePeerId, {
                kind: 'call_end',
                callId: envelope.callId,
                reason: 'microphone_unavailable',
              })
            }
            return
          }
          if (activeCall.callId !== envelope.callId) return
          sendCallControl(remotePeerId, { kind: 'call_ready', callId: envelope.callId })
          changeCall({ ...activeCall, phase: 'active', startedAt: Date.now() })
        })
      } else if (envelope.kind === 'call_ready' && current.phase === 'connecting') {
        changeCall({ ...current, phase: 'active', startedAt: Date.now() })
      } else if (
        envelope.kind === 'call_decline' &&
        (current.phase === 'outgoing_ringing' || current.phase === 'connecting')
      ) {
        clearCall(
          envelope.reason === 'busy'
            ? `${current.peerName || 'Your peer'} is already handling another call.`
            : `${current.peerName || 'Your peer'} declined the call.`,
        )
      } else if (
        envelope.kind === 'call_cancel' &&
        (current.phase === 'incoming_ringing' || current.phase === 'connecting')
      ) {
        clearCall('The incoming call was cancelled.')
      } else if (envelope.kind === 'call_end') {
        clearCall()
      } else if (
        envelope.kind === 'call_mute' &&
        (current.phase === 'connecting' || current.phase === 'active')
      ) {
        changeCall({ ...current, remoteMuted: envelope.muted })
      }
    },
    [acquireLocalAudio, changeCall, clearCall, roomType, sendCallControl],
  )

  const handleChatMessage = useCallback(
    (remotePeerId: string, event: MessageEvent<string>) => {
      if (typeof event.data !== 'string') return
      try {
        const envelope = JSON.parse(event.data) as unknown
        if (!isPeerEnvelope(envelope)) return
        if (isCallEnvelope(envelope)) {
          handleCallControl(remotePeerId, envelope)
        } else if (envelope.kind === 'chat') {
          setMessages((current) =>
            current.some((message) => message.id === envelope.id)
              ? current
              : [
                  ...current,
                  {
                    id: envelope.id,
                    text: envelope.text,
                    sentAt: envelope.sentAt,
                    authorId: remotePeerId,
                    authorName: linksRef.current.get(remotePeerId)?.name || 'Peer',
                    direction: 'incoming',
                    status: 'delivered',
                    receipts: {},
                    replyTo: envelope.replyTo,
                    reactions: {},
                  },
                ],
          )
          linksRef.current
            .get(remotePeerId)
            ?.chatChannel?.send(JSON.stringify({ kind: 'ack', id: envelope.id }))
          if (document.visibilityState === 'visible' && document.hasFocus()) {
            sendSeen(remotePeerId, [envelope.id])
          } else {
            const pending = pendingSeenRef.current.get(remotePeerId) ?? new Set<string>()
            pending.add(envelope.id)
            pendingSeenRef.current.set(remotePeerId, pending)
          }
        } else if (envelope.kind === 'ack') {
          setMessages((current) =>
            current.map((message) => {
              if (
                message.id !== envelope.id ||
                message.direction !== 'outgoing' ||
                !(remotePeerId in message.receipts)
              ) {
                return message
              }
              const receipts = { ...message.receipts, [remotePeerId]: 'delivered' as const }
              const status = Object.values(receipts).every((value) => value !== 'sent')
                ? 'delivered'
                : 'sent'
              return { ...message, receipts, status }
            }),
          )
        } else if (envelope.kind === 'seen') {
          const seenIds = new Set(envelope.ids)
          setMessages((current) =>
            current.map((message) => {
              if (
                message.direction !== 'outgoing' ||
                !seenIds.has(message.id) ||
                !(remotePeerId in message.receipts)
              ) {
                return message
              }
              const receipts = { ...message.receipts, [remotePeerId]: 'seen' as const }
              const values = Object.values(receipts)
              const status = values.every((value) => value === 'seen')
                ? 'seen'
                : values.every((value) => value !== 'sent')
                  ? 'delivered'
                  : 'sent'
              return { ...message, receipts, status }
            }),
          )
        } else if (envelope.kind === 'profile') {
          const link = linksRef.current.get(remotePeerId)
          if (link) {
            link.name = envelope.name.trim()
            syncPeers()
          }
        } else if (envelope.kind === 'reaction') {
          setMessages((current) =>
            current.map((message) =>
              message.id === envelope.messageId
                ? {
                    ...message,
                    reactions: { ...message.reactions, [remotePeerId]: envelope.emoji },
                  }
                : message,
            ),
          )
        } else if (envelope.kind === 'message_edit') {
          setMessages((current) => {
            const original = current.find((message) => message.id === envelope.messageId)
            if (!original || original.authorId !== remotePeerId || original.deletedAt) return current
            return current.map((message) => {
              if (
                message.id === envelope.messageId &&
                (!message.editedAt ||
                  Date.parse(envelope.editedAt) >= Date.parse(message.editedAt))
              ) {
                return { ...message, text: envelope.text, editedAt: envelope.editedAt }
              }
              if (message.replyTo?.id === envelope.messageId) {
                return {
                  ...message,
                  replyTo: { ...message.replyTo, text: envelope.text.slice(0, 180) },
                }
              }
              return message
            })
          })
        } else if (envelope.kind === 'message_delete') {
          setMessages((current) => {
            const original = current.find((message) => message.id === envelope.messageId)
            if (!original || original.authorId !== remotePeerId) return current
            return current.map((message) => {
              if (message.id === envelope.messageId) {
                return {
                  ...message,
                  text: '',
                  deletedAt: envelope.deletedAt,
                  reactions: {},
                }
              }
              if (message.replyTo?.id === envelope.messageId) {
                return {
                  ...message,
                  replyTo: { ...message.replyTo, text: 'Original message deleted' },
                }
              }
              return message
            })
          })
        } else {
          const link = linksRef.current.get(remotePeerId)
          if (link) {
            link.typing = envelope.active
            syncPeers()
          }
        }
      } catch {
        // Ignore malformed peer payloads without disrupting the channel.
      }
    },
    [handleCallControl, sendSeen, syncPeers],
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
    (remotePeerId: string, channel: RTCDataChannel) => {
      const link = linksRef.current.get(remotePeerId)
      if (!link) {
        channel.close()
        return
      }
      if (channel.label === 'chat') {
        link.chatChannel = channel
        channel.addEventListener('message', (event) => handleChatMessage(remotePeerId, event))
        channel.addEventListener('open', () => {
          link.phase = 'connected'
          changePhase('connected')
          setError('')
          const name = displayNameRef.current.trim()
          if (name) {
            channel.send(JSON.stringify({ kind: 'profile', name } satisfies PeerEnvelope))
          }
          syncPeers()
          addEvent('Direct channel open', 'Messages now travel browser to browser.', 'success')
        })
        channel.addEventListener('close', () => {
          if (link.chatChannel === channel && phaseRef.current !== 'idle') {
            link.phase = 'disconnected'
            syncPeers()
          }
          const hasOpenChannel = [...linksRef.current.values()].some(
            (candidate) => candidate.chatChannel?.readyState === 'open',
          )
          if (!hasOpenChannel && phaseRef.current !== 'idle') {
            changePhase('disconnected')
          }
        })
      } else if (channel.label === 'files') {
        link.fileChannel = channel
        channel.binaryType = 'arraybuffer'
        channel.addEventListener('message', handleFileMessage)
      }
    },
    [addEvent, changePhase, handleChatMessage, handleFileMessage, syncPeers],
  )

  const closeLink = useCallback(
    (remotePeerId: string) => {
      const link = linksRef.current.get(remotePeerId)
      if (!link) return
      if (callRef.current.peerId === remotePeerId) {
        clearCall('The call ended because the peer disconnected.')
      }
      if (link.qualityTimer !== null) window.clearInterval(link.qualityTimer)
      link.chatChannel?.close()
      link.fileChannel?.close()
      link.connection.close()
      linksRef.current.delete(remotePeerId)
      pendingSeenRef.current.delete(remotePeerId)
      setRemoteCallStream(null)
      syncPeers()
    },
    [clearCall, syncPeers],
  )

  const closePeer = useCallback(() => {
    if (callRef.current.phase !== 'idle') clearCall()
    for (const link of linksRef.current.values()) {
      if (link.qualityTimer !== null) window.clearInterval(link.qualityTimer)
      link.chatChannel?.close()
      link.fileChannel?.close()
      link.connection.close()
    }
    linksRef.current.clear()
    incomingFileRef.current = null
    pendingSeenRef.current.clear()
    setRemoteCallStream(null)
    syncPeers()
  }, [clearCall, syncPeers])

  const ensurePeer = useCallback(
    async (remotePeerId: string, initiator: boolean) => {
      const existing = linksRef.current.get(remotePeerId)
      if (existing) return existing.connection
      const { connection: peer, turnConfigured } = await createPeerConnection()
      const racedLink = linksRef.current.get(remotePeerId)
      if (racedLink) {
        peer.close()
        return racedLink.connection
      }
      const link: PeerLink = {
        peerId: remotePeerId,
        name: '',
        phase: 'connecting',
        route: null,
        quality: null,
        typing: false,
        connection: peer,
        chatChannel: null,
        fileChannel: null,
        queuedCandidates: [],
        localCandidates: [],
        remoteCandidates: [],
        turnConfigured,
        qualityTimer: null,
        audioSender: null,
      }
      linksRef.current.set(remotePeerId, link)
      syncPeers()
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
        link.localCandidates.push(event.candidate.candidate)
        signalRef.current?.send({
          type: 'ice_candidate',
          targetPeerId: remotePeerId,
          candidate: toCandidatePayload(event.candidate),
        })
      })
      peer.addEventListener('connectionstatechange', () => {
        if (peer.connectionState === 'connected') {
          link.phase = 'connected'
          changePhase('connected')
          void detectConnectionRoute(peer).then((detectedRoute) => {
            if (linksRef.current.get(remotePeerId)?.connection !== peer) return
            link.route = detectedRoute
            syncPeers()
            addEvent('Route selected', detectedRoute.detail, 'success')
          })
          const updateQuality = () => {
            void measureConnectionQuality(peer).then((measuredQuality) => {
              if (linksRef.current.get(remotePeerId)?.connection !== peer) return
              link.quality = measuredQuality
              syncPeers()
            })
          }
          if (link.qualityTimer !== null) {
            window.clearInterval(link.qualityTimer)
          }
          updateQuality()
          link.qualityTimer = window.setInterval(updateQuality, 3_000)
        } else if (peer.connectionState === 'disconnected') {
          link.phase = 'disconnected'
          syncPeers()
          const anotherConnected = [...linksRef.current.values()].some(
            (candidate) => candidate !== link && candidate.phase === 'connected',
          )
          changePhase(anotherConnected ? 'connected' : 'reconnecting')
          addEvent('Route interrupted', 'The browser is attempting to recover the connection.', 'danger')
        } else if (peer.connectionState === 'failed') {
          const diagnosis = diagnoseIceFailure({
            localCandidates: link.localCandidates,
            remoteCandidates: link.remoteCandidates,
            turnConfigured: link.turnConfigured,
          })
          link.phase = 'failed'
          syncPeers()
          const anyConnected = [...linksRef.current.values()].some(
            (candidate) => candidate.phase === 'connected',
          )
          changePhase(anyConnected ? 'connected' : 'disconnected')
          if (!anyConnected) {
            setError(diagnosis.title)
            setFailureHelp(diagnosis.detail)
          }
          addEvent(diagnosis.title, diagnosis.detail, 'danger')
          if (callRef.current.peerId === remotePeerId) {
            clearCall('The call ended because the direct connection failed.')
          }
        }
      })
      peer.addEventListener('track', (event) => {
        if (event.track.kind !== 'audio' || roomType !== 'private') return
        const stream = event.streams[0] ?? new MediaStream([event.track])
        setRemoteCallStream(stream)
      })
      peer.addEventListener('datachannel', (event) => attachChannel(remotePeerId, event.channel))

      if (initiator) {
        if (roomType === 'private') {
          link.audioSender = peer.addTransceiver('audio', { direction: 'sendrecv' }).sender
        }
        attachChannel(remotePeerId, peer.createDataChannel('chat', { ordered: true }))
        if (roomType === 'private') {
          attachChannel(remotePeerId, peer.createDataChannel('files', { ordered: true }))
        }
      }
      return peer
    },
    [addEvent, attachChannel, changePhase, clearCall, roomType, syncPeers],
  )

  const flushCandidates = useCallback(async (remotePeerId: string, peer: RTCPeerConnection) => {
    const link = linksRef.current.get(remotePeerId)
    if (!link) return
    const candidates = link.queuedCandidates
    link.queuedCandidates = []
    for (const candidate of candidates) await peer.addIceCandidate(candidate)
  }, [])

  const createOffer = useCallback(async (remotePeerId: string) => {
    try {
      const alreadyConnected = [...linksRef.current.values()].some(
        (link) => link.phase === 'connected',
      )
      if (!alreadyConnected) changePhase('connecting')
      addEvent('Peer found', 'Creating an offer for the direct connection.', 'active')
      const peer = await ensurePeer(remotePeerId, true)
      await peer.setLocalDescription(await peer.createOffer())
      signalRef.current?.send({
        type: 'offer',
        targetPeerId: remotePeerId,
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
        setRoomType(message.roomType)
        setPeerId(message.peerId)
        localPeerIdRef.current = message.peerId
        rememberRoom(message.roomCode, message.resumeToken)
        pendingRoomCodeRef.current = message.roomCode
        resumeAttemptedRef.current = false
        setError('')
        changePhase(message.peers.length === 0 ? 'waiting' : 'connecting')
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
        await createOffer(message.peer.peerId)
        return
      }
      if (message.type === 'peer_rejoined') {
        closeLink(message.peerId)
        await createOffer(message.peerId)
        return
      }
      if (message.type === 'offer') {
        try {
          const alreadyConnected = [...linksRef.current.values()].some(
            (link) => link.phase === 'connected',
          )
          if (!alreadyConnected) changePhase('connecting')
          addEvent('Offer received', 'Preparing the response in this browser.', 'active')
          const peer = await ensurePeer(message.fromPeerId, false)
          await peer.setRemoteDescription(message.description)
          const link = linksRef.current.get(message.fromPeerId)
          if (roomType === 'private' && link) {
            link.audioSender =
              peer
                .getTransceivers()
                .find((transceiver) => transceiver.receiver.track.kind === 'audio')?.sender ?? null
          }
          await flushCandidates(message.fromPeerId, peer)
          await peer.setLocalDescription(await peer.createAnswer())
          signalRef.current?.send({
            type: 'answer',
            targetPeerId: message.fromPeerId,
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
          const peer = linksRef.current.get(message.fromPeerId)?.connection
          if (!peer) return
          await peer.setRemoteDescription(message.description)
          await flushCandidates(message.fromPeerId, peer)
          addEvent('Answer received', 'Negotiation is complete; opening the data channel.', 'active')
        } catch {
          changePhase('failed')
          setError('Could not complete WebRTC negotiation.')
        }
        return
      }
      if (message.type === 'ice_candidate') {
        const peer = await ensurePeer(message.fromPeerId, false)
        const link = linksRef.current.get(message.fromPeerId)
        if (!link) return
        link.remoteCandidates.push(message.candidate.candidate)
        if (!peer.remoteDescription) link.queuedCandidates.push(message.candidate)
        else await peer.addIceCandidate(message.candidate)
        return
      }
      if (message.type === 'peer_left') {
        closeLink(message.peerId)
        const hasConnectedPeer = [...linksRef.current.values()].some(
          (link) => link.phase === 'connected',
        )
        changePhase(hasConnectedPeer ? 'connected' : 'waiting')
        setError(
          hasConnectedPeer
            ? ''
            : 'The other person left. This room is still available for them to rejoin.',
        )
        addEvent('Peer left', 'The direct connection was closed.', 'danger')
        return
      }
      if (message.type === 'error') {
        const targetRoom = roomCode || pendingRoomCodeRef.current
        if (message.code === 'room_full' && targetRoom && !resumeAttemptedRef.current) {
          const resumeToken = readPersistentResumeToken(targetRoom)
          if (resumeToken) {
            resumeAttemptedRef.current = true
            setError('')
            setFailureHelp('')
            changePhase('reconnecting')
            addEvent(
              'Reclaiming previous slot',
              'This browser is replacing its abandoned room session.',
              'active',
            )
            signalRef.current?.send({
              type: 'join_room',
              roomCode: targetRoom,
              resumeToken,
            })
            return
          }
        }
        setError(message.message)
        if (message.code === 'room_full') {
          setFailureHelp(
            'The room is at capacity. Reopen the invitation in the original browser to reclaim its place, or wait for an abandoned mobile session to expire.',
          )
        }
        if (message.code === 'room_not_found' && roomCode) forgetRoom(roomCode)
        if (message.code === 'room_not_found' || message.code === 'room_full') {
          changePhase('failed')
        }
        addEvent('Signaling error', message.message, 'danger')
      }
    },
    [
      addEvent,
      changePhase,
      closeLink,
      createOffer,
      ensurePeer,
      flushCandidates,
      roomCode,
      roomType,
    ],
  )

  useEffect(() => {
    signalHandlerRef.current = (message) => {
      void handleSignal(message)
    }
  }, [handleSignal])

  useEffect(() => {
    const flushSeen = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      for (const [remotePeerId, pending] of pendingSeenRef.current) {
        const ids = [...pending]
        for (let index = 0; index < ids.length; index += 100) {
          sendSeen(remotePeerId, ids.slice(index, index + 100))
        }
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
        const hasOpenChannel = [...linksRef.current.values()].some(
          (link) => link.chatChannel?.readyState === 'open',
        )
        if (hasOpenChannel) {
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

  const createRoom = useCallback(async (type: RoomType = 'private') => {
    resetContent()
    closePeer()
    pendingRoomCodeRef.current = ''
    resumeAttemptedRef.current = false
    setRoomType(type)
    changePhase('signaling')
    try {
      const signal = await openSignal()
      signal.send({ type: 'create_room', roomType: type })
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
      pendingRoomCodeRef.current = code
      changePhase('signaling')
      try {
        const signal = await openSignal()
        const resumeToken = readResumeToken(code)
        resumeAttemptedRef.current = Boolean(resumeToken)
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
    pendingRoomCodeRef.current = ''
    resumeAttemptedRef.current = false
    setRoomCode('')
    setRoomType('private')
    setPeerId('')
    localPeerIdRef.current = ''
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
      pendingRoomCodeRef.current = roomCode
      resumeAttemptedRef.current = Boolean(resumeToken)
      signal.send({
        type: 'join_room',
        roomCode,
        ...(resumeToken ? { resumeToken } : {}),
      })
    } catch {
      changePhase('failed')
    }
  }, [addEvent, changePhase, closePeer, openSignal, roomCode])

  const sendMessage = useCallback((rawText: string, replyTo?: ReplyReference) => {
    const text = rawText.trim()
    if (!text || text.length > MAX_MESSAGE_LENGTH) return false
    const envelope: Extract<PeerEnvelope, { kind: 'chat' }> = {
      kind: 'chat',
      id: crypto.randomUUID(),
      text,
      sentAt: new Date().toISOString(),
      ...(replyTo ? { replyTo } : {}),
    }
    const recipients = broadcastChat(envelope)
    if (recipients.length === 0) return false
    setMessages((current) => [
      ...current,
      {
        id: envelope.id,
        text: envelope.text,
        sentAt: envelope.sentAt,
        authorId: localPeerIdRef.current,
        authorName: displayNameRef.current.trim() || 'You',
        direction: 'outgoing',
        status: 'sent',
        receipts: Object.fromEntries(recipients.map((id) => [id, 'sent' as const])),
        replyTo: envelope.replyTo,
        reactions: {},
      },
    ])
    return true
  }, [broadcastChat])

  const reactToMessage = useCallback((messageId: string, emoji: EmojiReaction) => {
    if (
      broadcastChat({ kind: 'reaction', messageId, emoji } satisfies PeerEnvelope).length === 0
    ) {
      return
    }
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              reactions: { ...message.reactions, [localPeerIdRef.current]: emoji },
            }
          : message,
      ),
    )
  }, [broadcastChat])

  const editMessage = useCallback((messageId: string, rawText: string) => {
    const text = rawText.trim()
    if (!text || text.length > MAX_MESSAGE_LENGTH) return false
    const editedAt = new Date().toISOString()
    if (
      broadcastChat({
        kind: 'message_edit',
        messageId,
        text,
        editedAt,
      } satisfies PeerEnvelope).length === 0
    ) {
      return false
    }
    setMessages((current) =>
      current.map((message) => {
        if (
          message.id === messageId &&
          message.direction === 'outgoing' &&
          !message.deletedAt
        ) {
          return { ...message, text, editedAt }
        }
        if (message.replyTo?.id === messageId) {
          return { ...message, replyTo: { ...message.replyTo, text: text.slice(0, 180) } }
        }
        return message
      }),
    )
    return true
  }, [broadcastChat])

  const deleteMessage = useCallback((messageId: string) => {
    const deletedAt = new Date().toISOString()
    if (
      broadcastChat({
        kind: 'message_delete',
        messageId,
        deletedAt,
      } satisfies PeerEnvelope).length === 0
    ) {
      return false
    }
    setMessages((current) =>
      current.map((message) => {
        if (message.id === messageId && message.direction === 'outgoing') {
          return { ...message, text: '', deletedAt, reactions: {} }
        }
        if (message.replyTo?.id === messageId) {
          return {
            ...message,
            replyTo: { ...message.replyTo, text: 'Original message deleted' },
          }
        }
        return message
      }),
    )
    return true
  }, [broadcastChat])

  const sendTyping = useCallback((active: boolean) => {
    broadcastChat({ kind: 'typing', active } satisfies PeerEnvelope)
  }, [broadcastChat])

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
    if (trimmed.length >= 2) {
      broadcastChat({ kind: 'profile', name: trimmed } satisfies PeerEnvelope)
    }
  }, [broadcastChat])

  const startCall = useCallback(() => {
    if (roomType !== 'private' || callRef.current.phase === 'incoming_ringing') return false
    if (callRef.current.phase !== 'idle' && callRef.current.phase !== 'failed') return false
    const link = [...linksRef.current.values()].find(
      (candidate) => candidate.chatChannel?.readyState === 'open',
    )
    if (!link) return false
    const callId = crypto.randomUUID()
    if (
      !sendCallControl(link.peerId, {
        kind: 'call_invite',
        callId,
        sentAt: new Date().toISOString(),
      })
    ) {
      return false
    }
    changeCall({
      ...IDLE_CALL,
      phase: 'outgoing_ringing',
      callId,
      peerId: link.peerId,
      peerName: link.name || 'Peer',
    })
    return true
  }, [changeCall, roomType, sendCallControl])

  const acceptCall = useCallback(async () => {
    const current = callRef.current
    if (roomType !== 'private' || current.phase !== 'incoming_ringing') return
    changeCall({ ...current, phase: 'connecting', error: '' })
    const ready = await acquireLocalAudio(current.callId, current.peerId)
    if (!ready) {
      if (callRef.current.phase === 'failed') {
        sendCallControl(current.peerId, {
          kind: 'call_decline',
          callId: current.callId,
          reason: 'microphone_unavailable',
        })
      }
      return
    }
    if (callRef.current.callId !== current.callId) return
    sendCallControl(current.peerId, { kind: 'call_accept', callId: current.callId })
  }, [acquireLocalAudio, changeCall, roomType, sendCallControl])

  const declineCall = useCallback(() => {
    const current = callRef.current
    if (current.phase !== 'incoming_ringing') return
    sendCallControl(current.peerId, {
      kind: 'call_decline',
      callId: current.callId,
      reason: 'declined',
    })
    clearCall()
  }, [clearCall, sendCallControl])

  const cancelCall = useCallback(() => {
    const current = callRef.current
    if (current.phase !== 'outgoing_ringing') return
    sendCallControl(current.peerId, { kind: 'call_cancel', callId: current.callId })
    clearCall()
  }, [clearCall, sendCallControl])

  const endCall = useCallback(() => {
    const current = callRef.current
    if (current.phase !== 'connecting' && current.phase !== 'active') return
    sendCallControl(current.peerId, {
      kind: 'call_end',
      callId: current.callId,
      reason: 'hangup',
    })
    clearCall()
  }, [clearCall, sendCallControl])

  const toggleCallMute = useCallback(() => {
    const current = callRef.current
    if (current.phase !== 'connecting' && current.phase !== 'active') return
    const muted = !current.muted
    localCallStreamRef.current
      ?.getAudioTracks()
      .forEach((track) => {
        track.enabled = !muted
      })
    sendCallControl(current.peerId, {
      kind: 'call_mute',
      callId: current.callId,
      muted,
    })
    changeCall({ ...current, muted })
  }, [changeCall, sendCallControl])

  const dismissCallError = useCallback(() => {
    if (callRef.current.phase === 'failed') clearCall()
  }, [clearCall])

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
      if (roomType !== 'private') {
        throw new Error('Group rooms currently support text messages only.')
      }
      const channel = [...linksRef.current.values()][0]?.fileChannel
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
    [addEvent, roomType, updateTransfer],
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
      if (callRef.current.phase !== 'idle' && callRef.current.phase !== 'failed') {
        throw new Error('End the live call before sending a voice message.')
      }
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
    roomType,
    peerId,
    peers,
    messages,
    transfers,
    events,
    error,
    failureHelp,
    route,
    quality,
    peerTyping,
    displayName,
    peerName,
    call,
    remoteCallStream,
    maxFileSize: MAX_FILE_SIZE,
    createRoom,
    joinRoom,
    leave,
    retry,
    sendMessage,
    reactToMessage,
    editMessage,
    deleteMessage,
    sendTyping,
    setDisplayName,
    sendFile,
    sendVoice,
    cancelTransfer,
    startCall,
    acceptCall,
    declineCall,
    cancelCall,
    endCall,
    toggleCallMute,
    dismissCallError,
  }
}
