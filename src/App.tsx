import {
  Activity,
  ArrowUp,
  Check,
  CheckCheck,
  Copy,
  Download,
  FileUp,
  Gauge,
  Link2,
  LockKeyhole,
  MessageSquareText,
  Mic,
  Paperclip,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Reply,
  ShieldCheck,
  SmilePlus,
  Square,
  Trash2,
  Unplug,
  UserRound,
  Wifi,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { normalizeRoomCode } from '../shared/protocol'
import { usePeerSession, type SessionPhase } from './hooks/usePeerSession'
import { usePwa } from './hooks/usePwa'
import { useVoiceRecorder } from './hooks/useVoiceRecorder'
import type { ConnectionRoute } from './lib/peer-connection'
import type {
  ChatMessage,
  EmojiReaction,
  FileTransfer,
  ReplyReference,
} from './types/messages'
import './styles.css'

const phaseCopy: Record<
  SessionPhase,
  { label: string; detail: string; tone: 'quiet' | 'active' | 'good' | 'bad' }
> = {
  idle: { label: 'Ready', detail: 'Create or join a private room.', tone: 'quiet' },
  signaling: { label: 'Contacting signal', detail: 'Opening the introduction channel.', tone: 'active' },
  waiting: { label: 'Waiting for peer', detail: 'Share the room link with one person.', tone: 'active' },
  connecting: { label: 'Connecting directly', detail: 'The browsers are negotiating a route.', tone: 'active' },
  connected: { label: 'Direct channel open', detail: 'Messages bypass the signaling server.', tone: 'good' },
  reconnecting: { label: 'Recovering route', detail: 'WebRTC is checking the connection.', tone: 'active' },
  disconnected: { label: 'Peer disconnected', detail: 'The room can accept the peer again.', tone: 'bad' },
  failed: { label: 'Connection failed', detail: 'Review the error and try again.', tone: 'bad' },
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

const REACTION_OPTIONS: EmojiReaction[] = ['👍', '❤️', '😂', '😮', '😢', '🙏']

function Mark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <i />
      <span />
    </span>
  )
}

function Brand() {
  return (
    <div className="brand">
      <Mark />
      <span>P4Pair</span>
    </div>
  )
}

function PwaInstallButton({ pwa }: { pwa: ReturnType<typeof usePwa> }) {
  if (!pwa.installAvailable) return null
  return (
    <button
      className="install-nav-button"
      type="button"
      onClick={() => void pwa.requestInstall()}
    >
      <Download size={16} />
      <span>Install app</span>
    </button>
  )
}

function Landing({
  roomInput,
  onRoomInput,
  onCreate,
  onJoin,
  busy,
  error,
  online,
  pwa,
  displayName,
  onDisplayName,
}: {
  roomInput: string
  onRoomInput: (value: string) => void
  onCreate: () => void
  onJoin: () => void
  busy: boolean
  error: string
  online: boolean
  pwa: ReturnType<typeof usePwa>
  displayName: string
  onDisplayName: (value: string) => void
}) {
  const nameReady = displayName.trim().length >= 2
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onJoin()
  }

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <Brand />
        <div className="landing-header-actions">
          <PwaInstallButton pwa={pwa} />
          <span className="protocol-chip"><Radio size={15} /> WebRTC data channel</span>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-copy">
          <p className="context-line">Two browsers. One direct route.</p>
          <h1>A chat server that never sees your chat.</h1>
          <p className="landing-intro">
            P4Pair uses a server for the introduction, then gets out of the way.
            Your messages travel directly between you and one other person.
          </p>

          <div className="route-demo" aria-label="A direct route between two browsers">
            <span className="demo-peer"><UserRound size={21} /> You</span>
            <span className="demo-route">
              <i />
              <small>direct</small>
            </span>
            <span className="demo-peer"><UserRound size={21} /> Peer</span>
          </div>

          <div className="trust-line">
            <span><LockKeyhole size={16} /> Encrypted in transit</span>
            <span><ShieldCheck size={16} /> No message database</span>
          </div>
        </section>

        <section className="room-panel" aria-labelledby="room-panel-title">
          <div className="panel-index">Start a private line</div>
          <h2 id="room-panel-title">Meet in a room</h2>
          <p>Rooms hold two people and disappear when both leave.</p>

          <label className="name-field">
            <span>Your name</span>
            <input
              value={displayName}
              onChange={(event) => onDisplayName(event.target.value)}
              placeholder="How your peer sees you"
              autoComplete="nickname"
              maxLength={24}
            />
            <small>Shared with your peer over WebRTC, not stored on the server.</small>
          </label>

          <button className="primary-action" type="button" onClick={onCreate} disabled={busy || !online || !nameReady}>
            <Link2 size={19} />
            {busy ? 'Opening signal…' : 'Create a room'}
          </button>

          <div className="or-rule"><span>or join with a code</span></div>

          <form className="join-form" onSubmit={submit}>
            <label htmlFor="room-code">Room code</label>
            <div className="code-row">
              <input
                id="room-code"
                value={roomInput}
                onChange={(event) => onRoomInput(normalizeRoomCode(event.target.value))}
                placeholder="ABCD2345"
                autoComplete="off"
                spellCheck={false}
                maxLength={8}
              />
              <button type="submit" disabled={busy || !online || !nameReady || roomInput.length !== 8}>
                Join
                <ArrowUp size={17} />
              </button>
            </div>
          </form>
          {(error || !online) && (
            <p className="inline-error" role="alert">
              {online ? error : 'You are offline. Reconnect to create or join a room.'}
            </p>
          )}

          <ol className="mini-steps">
            <li><b>1</b><span>The server introduces both browsers.</span></li>
            <li><b>2</b><span>WebRTC negotiates a direct route.</span></li>
            <li><b>3</b><span>The chat moves peer to peer.</span></li>
          </ol>
        </section>
      </main>
      <footer className="landing-footer">
        Built for MuLearn CET Tech Team Recruitment · Task 01
      </footer>
    </div>
  )
}

function ConnectionRail({
  phase,
  route,
  localName,
  peerName,
  detailsOpen,
  onToggleDetails,
}: {
  phase: SessionPhase
  route: ConnectionRoute | null
  localName: string
  peerName: string
  detailsOpen: boolean
  onToggleDetails: () => void
}) {
  const status = phaseCopy[phase]
  const label = phase === 'connected' && route ? route.label : status.label
  return (
    <section className={`connection-rail tone-${status.tone}`} aria-label="Connection route">
      <div className="rail-peer">
        <span className="peer-node"><UserRound size={17} /></span>
        <span><b>{localName || 'This browser'}</b><small>You · local peer</small></span>
      </div>
      <div className="rail-path">
        <span />
        <button
          className="rail-status"
          type="button"
          onClick={onToggleDetails}
          aria-expanded={detailsOpen}
          aria-controls="connection-details"
        >
          {phase === 'connected' ? <Wifi size={15} /> : <Activity size={15} />}
          <b>{label}</b>
        </button>
        <span />
      </div>
      <div className="rail-peer rail-peer-right">
        <span><b>{peerName || 'Other browser'}</b><small>Remote peer</small></span>
        <span className="peer-node"><UserRound size={17} /></span>
      </div>
    </section>
  )
}

function ConnectionDetails({
  session,
  onClose,
}: {
  session: ReturnType<typeof usePeerSession>
  onClose: () => void
}) {
  const route = session.route
  const quality = session.quality
  return (
    <div className="connection-details-backdrop" onClick={onClose}>
      <section
        id="connection-details"
        className="connection-details"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-details-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="details-icon"><Wifi size={18} /></span>
            <span>
              <small>Selected WebRTC route</small>
              <h2 id="connection-details-title">{route?.label ?? 'Connecting'}</h2>
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close connection details" autoFocus>
            <X size={18} />
          </button>
        </header>

        <p className="route-detail">
          {route?.detail ?? 'The browser is still selecting a network route.'}
        </p>

        <div className={`quality-card quality-${quality?.rating ?? 'unknown'}`}>
          <Gauge size={20} />
          <div>
            <small>Connection quality</small>
            <b>{quality?.label ?? 'Measuring'}</b>
            <span>{quality?.detail ?? 'Waiting for a round-trip measurement.'}</span>
          </div>
          <strong>{quality?.rttMs === null || quality?.rttMs === undefined ? '—' : `${quality.rttMs} ms`}</strong>
        </div>

        <div className="details-encryption">
          <LockKeyhole size={15} />
          {route?.kind === 'turn'
            ? 'Relayed through TURN and encrypted in transit'
            : 'Direct and encrypted in transit'}
        </div>

        <dl className="details-facts">
          <div><dt>Transport</dt><dd>WebRTC / SCTP</dd></div>
          <div><dt>Signaling</dt><dd>WebSocket</dd></div>
          <div><dt>Route</dt><dd>{route?.label ?? 'Pending'}</dd></div>
          <div><dt>Peer ID</dt><dd>{session.peerId.slice(0, 8) || 'Pending'}</dd></div>
        </dl>
      </section>
    </div>
  )
}

function Waveform({
  levels,
  progress = 0,
}: {
  levels: number[]
  progress?: number
}) {
  return (
    <span className="voice-waveform" aria-hidden="true">
      {levels.map((level, index) => (
        <i
          className={progress > 0 && index / levels.length <= progress ? 'wave-played' : ''}
          key={`${index}-${level}`}
          style={{ height: `${Math.max(10, level * 100)}%` }}
        />
      ))}
    </span>
  )
}

function VoiceNoteItem({ transfer }: { transfer: FileTransfer }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const durationMs = transfer.durationMs ?? 0
  const playbackProgress = durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 0
  const playable = Boolean(transfer.url) && transfer.status === 'complete'

  const togglePlayback = async () => {
    const audio = audioRef.current
    if (!audio || !playable) return
    if (audio.paused) await audio.play()
    else audio.pause()
  }

  return (
    <article className={`voice-note voice-note-${transfer.direction}`}>
      <button
        className="voice-play"
        type="button"
        onClick={() => void togglePlayback()}
        disabled={!playable}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="voice-note-body">
        <Waveform levels={transfer.waveform ?? []} progress={playbackProgress} />
        <div className="voice-note-meta">
          <span>
            {playing ? formatDuration(elapsedMs) : formatDuration(durationMs)}
          </span>
          <span>
            {transfer.status === 'transferring'
              ? `${transfer.progress}%`
              : transfer.status === 'complete'
                ? transfer.direction === 'incoming'
                  ? 'Voice received'
                  : 'Voice sent'
                : transfer.status}
          </span>
        </div>
      </div>
      {transfer.url && (
        <audio
          ref={audioRef}
          src={transfer.url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setElapsedMs(0)
          }}
          onTimeUpdate={(event) => setElapsedMs(event.currentTarget.currentTime * 1000)}
        />
      )}
    </article>
  )
}

function TransferItem({
  transfer,
  onCancel,
}: {
  transfer: FileTransfer
  onCancel: (id: string) => void
}) {
  return (
    <article className={`transfer transfer-${transfer.direction} transfer-${transfer.status}`}>
      <span className="transfer-icon"><FileUp size={18} /></span>
      <div className="transfer-copy">
        <div><b>{transfer.name}</b><small>{formatBytes(transfer.size)}</small></div>
        <div className="progress-track" aria-label={`${transfer.progress}% transferred`}>
          <span style={{ width: `${transfer.progress}%` }} />
        </div>
        <small>
          {transfer.status === 'complete'
            ? `${transfer.direction === 'incoming' ? 'Received' : 'Sent'} directly`
            : transfer.status === 'transferring'
              ? `${transfer.progress}% · ${transfer.direction === 'incoming' ? 'Receiving' : 'Sending'}`
              : transfer.status}
        </small>
      </div>
      {transfer.status === 'transferring' && transfer.direction === 'outgoing' && (
        <button className="icon-button" type="button" onClick={() => onCancel(transfer.id)} aria-label={`Cancel ${transfer.name}`}>
          <X size={17} />
        </button>
      )}
      {transfer.status === 'complete' && transfer.url && (
        <a className="icon-button" href={transfer.url} download={transfer.name} aria-label={`Download ${transfer.name}`}>
          <Download size={17} />
        </a>
      )}
    </article>
  )
}

function MessageReceipt({ status }: { status: 'sent' | 'delivered' | 'seen' }) {
  const label =
    status === 'sent' ? 'Sent' : status === 'delivered' ? 'Delivered' : 'Seen'
  return (
    <span
      className={`message-receipt receipt-${status}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {status === 'sent'
        ? <Check size={14} aria-hidden="true" />
        : <CheckCheck size={14} aria-hidden="true" />}
    </span>
  )
}

function MessageItem({
  message,
  peerName,
  reactionOpen,
  onReply,
  onToggleReactions,
  onReact,
}: {
  message: ChatMessage
  peerName: string
  reactionOpen: boolean
  onReply: () => void
  onToggleReactions: () => void
  onReact: (emoji: EmojiReaction) => void
}) {
  return (
    <article className={`message message-${message.direction}`}>
      {message.replyTo && (
        <blockquote className="message-reply">
          <b>{message.replyTo.author}</b>
          <span>{message.replyTo.text}</span>
        </blockquote>
      )}
      <p>{message.text}</p>
      <footer>
        <time dateTime={message.sentAt}>
          {new Date(message.sentAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
        {message.direction === 'outgoing' && <MessageReceipt status={message.status} />}
      </footer>
      {(message.reactions.local || message.reactions.peer) && (
        <div className="message-reactions" aria-label="Message reactions">
          {message.reactions.local && (
            <span title="Your reaction">{message.reactions.local}</span>
          )}
          {message.reactions.peer && (
            <span title={`${peerName || 'Peer'} reacted`}>{message.reactions.peer}</span>
          )}
        </div>
      )}
      <div className="message-tools">
        <button type="button" onClick={onReply}>
          <Reply size={13} />
          Reply
        </button>
        <button
          type="button"
          onClick={onToggleReactions}
          aria-expanded={reactionOpen}
          aria-label="Add emoji reaction"
        >
          <SmilePlus size={14} />
        </button>
      </div>
      {reactionOpen && (
        <div className="reaction-picker" role="group" aria-label="Choose a reaction">
          {REACTION_OPTIONS.map((emoji) => (
            <button
              type="button"
              onClick={() => onReact(emoji)}
              aria-label={`React with ${emoji}`}
              key={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

function ChatWorkspace({
  session,
  pwa,
}: {
  session: ReturnType<typeof usePeerSession>
  pwa: ReturnType<typeof usePwa>
}) {
  const [draft, setDraft] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [fileError, setFileError] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null)
  const [reactionTarget, setReactionTarget] = useState<string | null>(null)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const typingTimerRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const handleVoiceRecorded = useCallback(
    (recording: { blob: Blob; durationMs: number; waveform: number[] }) => {
      setFileError('')
      void session
        .sendVoice(recording.blob, recording.durationMs, recording.waveform)
        .catch((caught) => {
          setFileError(
            caught instanceof Error ? caught.message : 'The voice message could not be sent.',
          )
        })
    },
    [session],
  )
  const voice = useVoiceRecorder(handleVoiceRecorded)
  const { cancel: cancelVoice, recording: voiceRecording } = voice
  const timeline = useMemo(
    () =>
      [
        ...session.messages.map((message) => ({
          kind: 'message' as const,
          id: message.id,
          sentAt: message.sentAt,
          message,
        })),
        ...session.transfers.map((transfer) => ({
          kind: 'transfer' as const,
          id: transfer.id,
          sentAt: transfer.sentAt,
          transfer,
        })),
      ].sort((first, second) => Date.parse(first.sentAt) - Date.parse(second.sentAt)),
    [session.messages, session.transfers],
  )

  const inviteUrl = useMemo(() => {
    if (!session.roomCode) return ''
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('room', session.roomCode)
    return url.toString()
  }, [session.roomCode])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [reactionTarget, session.messages, session.transfers, session.peerTyping])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (session.phase === 'connected') event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [session.phase])

  useEffect(() => {
    if (session.phase !== 'connected' && voiceRecording) cancelVoice()
  }, [cancelVoice, session.phase, voiceRecording])

  useEffect(() => {
    if (!detailsOpen) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [detailsOpen])

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteUrl)
    setCopyState('copied')
    window.setTimeout(() => setCopyState('idle'), 1800)
  }

  const submitMessage = () => {
    const replyReference: ReplyReference | undefined = replyingTo
      ? {
          id: replyingTo.id,
          text: replyingTo.text.slice(0, 180),
          author:
            replyingTo.direction === 'outgoing'
              ? session.displayName.trim() || 'You'
              : session.peerName || 'Peer',
        }
      : undefined
    if (session.sendMessage(draft, replyReference)) {
      setDraft('')
      setReplyingTo(null)
      session.sendTyping(false)
    }
  }

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitMessage()
    }
  }

  const updateDraft = (value: string) => {
    setDraft(value)
    session.sendTyping(Boolean(value))
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current)
    typingTimerRef.current = window.setTimeout(() => session.sendTyping(false), 1200)
  }

  const chooseFile = async (file: File | undefined) => {
    if (!file) return
    setFileError('')
    try {
      await session.sendFile(file)
    } catch (caught) {
      setFileError(caught instanceof Error ? caught.message : 'The file could not be sent.')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const leaveRoom = () => {
    if (session.phase === 'connected' && !window.confirm('Leave this direct conversation?')) return
    session.leave()
    window.history.replaceState({}, '', window.location.pathname)
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <Brand />
        <div className="room-identity">
          <span>Room</span>
          <code>{session.roomCode}</code>
          <button className="copy-button" type="button" onClick={copyInvite}>
            {copyState === 'copied' ? <Check size={16} /> : <Copy size={16} />}
            {copyState === 'copied' ? 'Copied' : 'Copy invite'}
          </button>
        </div>
        <div className="workspace-actions">
          <PwaInstallButton pwa={pwa} />
          <button className="leave-button" type="button" onClick={leaveRoom}>
            <Unplug size={17} />
            <span>Leave</span>
          </button>
        </div>
      </header>

      <ConnectionRail
        phase={session.phase}
        route={session.route}
        localName={session.displayName.trim()}
        peerName={session.peerName}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((current) => !current)}
      />
      {detailsOpen && (
        <ConnectionDetails session={session} onClose={() => setDetailsOpen(false)} />
      )}

      <main className="chat-layout">
        <section className="conversation" aria-label="Peer conversation">
          <div className="message-list" aria-live="polite">
            {timeline.length === 0 && (
              <div className="conversation-empty">
                {session.phase === 'waiting' ? (
                  <>
                    <span className="empty-symbol"><Link2 size={27} /></span>
                    <h2>Your side is ready.</h2>
                    <p>Send the invitation link to one person. This screen will update when their browser arrives.</p>
                    <button type="button" onClick={copyInvite}><Copy size={17} /> Copy invitation link</button>
                  </>
                ) : session.phase === 'connected' ? (
                  <>
                    <span className="empty-symbol"><MessageSquareText size={27} /></span>
                    <h2>The direct line is open.</h2>
                    <p>Send the first message. It will not pass through the signaling server.</p>
                  </>
                ) : (
                  <>
                    <span className="empty-symbol signal-pulse"><Activity size={27} /></span>
                    <h2>Building the route.</h2>
                    <p>Both browsers are exchanging the minimum details needed to connect.</p>
                  </>
                )}
              </div>
            )}

            {timeline.map((entry) =>
              entry.kind === 'message' ? (
                <MessageItem
                  key={entry.id}
                  message={entry.message}
                  peerName={session.peerName}
                  reactionOpen={reactionTarget === entry.id}
                  onReply={() => {
                    setReplyingTo(entry.message)
                    setReactionTarget(null)
                  }}
                  onToggleReactions={() =>
                    setReactionTarget((current) => (current === entry.id ? null : entry.id))
                  }
                  onReact={(emoji) => {
                    session.reactToMessage(entry.id, emoji)
                    setReactionTarget(null)
                  }}
                />
              ) : entry.transfer.category === 'voice' ? (
                <VoiceNoteItem key={entry.id} transfer={entry.transfer} />
              ) : (
                <TransferItem
                  key={entry.id}
                  transfer={entry.transfer}
                  onCancel={session.cancelTransfer}
                />
              ),
            )}

            {session.peerTyping && (
              <p className="typing-indicator">
                {session.peerName || 'Peer'} is typing<span>…</span>
              </p>
            )}
            <div ref={messageEndRef} />
          </div>

          {(session.error || fileError || voice.error) && (
            <div className="conversation-error" role="alert">
              <div className="error-copy">
                <strong>{fileError || voice.error || session.error}</strong>
                {!fileError && !voice.error && session.failureHelp && <p>{session.failureHelp}</p>}
              </div>
              {(session.phase === 'disconnected' || session.phase === 'failed') && (
                <button type="button" onClick={session.retry}><RefreshCw size={15} /> Try again</button>
              )}
            </div>
          )}

          <form
            className={`composer ${voice.recording ? 'composer-recording' : ''}`}
            onSubmit={(event) => {
              event.preventDefault()
              submitMessage()
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
            {replyingTo && !voice.recording && (
              <div className="composer-reply">
                <Reply size={15} />
                <span>
                  <b>Replying to {replyingTo.direction === 'outgoing' ? 'yourself' : session.peerName || 'peer'}</b>
                  <small>{replyingTo.text}</small>
                </span>
                <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply">
                  <X size={16} />
                </button>
              </div>
            )}
            {voice.recording ? (
              <>
                <button
                  className="recording-cancel"
                  type="button"
                  onClick={voice.cancel}
                  aria-label="Discard voice recording"
                  title="Discard recording"
                >
                  <Trash2 size={18} />
                </button>
                <div className="recording-state" role="status" aria-live="polite">
                  <span className="recording-dot" />
                  <time>{formatDuration(voice.durationMs)}</time>
                  <Waveform levels={voice.levels} />
                  <small>2:00 max</small>
                </div>
                <button
                  className="voice-send"
                  type="button"
                  onClick={voice.stop}
                  aria-label="Stop and send voice message"
                  title="Stop and send"
                >
                  <Square size={17} />
                </button>
              </>
            ) : (
              <>
                <div className="composer-field">
                  <button
                    className="attach-button"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={session.phase !== 'connected'}
                    aria-label="Send a file"
                    title="Send a file up to 25 MB"
                  >
                    <Paperclip size={19} />
                  </button>
                  <textarea
                    value={draft}
                    onChange={(event) => updateDraft(event.target.value)}
                    onKeyDown={keyDown}
                    onBlur={() => session.sendTyping(false)}
                    placeholder={session.phase === 'connected' ? 'Write a direct message' : 'Connect to begin messaging'}
                    disabled={session.phase !== 'connected'}
                    maxLength={4000}
                    rows={1}
                    aria-label="Message"
                  />
                  <button
                    className="voice-button"
                    type="button"
                  onClick={() => {
                    setReplyingTo(null)
                    void voice.start()
                  }}
                    disabled={session.phase !== 'connected'}
                    aria-label="Record a voice message"
                    title="Record voice message"
                  >
                    <Mic size={19} />
                  </button>
                </div>
                <button className="send-button" type="submit" disabled={session.phase !== 'connected' || !draft.trim()} aria-label="Send message">
                  <ArrowUp size={19} />
                </button>
              </>
            )}
          </form>
        </section>

        <aside className="diagnostics" aria-label="Connection timeline">
          <header>
            <span><Activity size={17} /> Connection timeline</span>
            <small>Local view</small>
          </header>
          <div className="privacy-explainer">
            <ShieldCheck size={18} />
            <p><b>The server handles introductions.</b><span>Messages and files use the WebRTC data channel.</span></p>
          </div>
          <ol className="event-list">
            {session.events.map((event) => (
              <li className={`event-${event.tone}`} key={event.id}>
                <span className="event-dot" />
                <div><b>{event.label}</b><p>{event.detail}</p><time>{event.at}</time></div>
              </li>
            ))}
          </ol>
        </aside>
      </main>
    </div>
  )
}

function PwaNotice({ pwa }: { pwa: ReturnType<typeof usePwa> }) {
  if (!pwa.online) {
    return (
      <aside className="pwa-notice pwa-offline" role="status">
        <Unplug size={19} />
        <div><b>P4Pair is offline</b><span>The app shell is available, but signaling needs a network.</span></div>
      </aside>
    )
  }

  if (pwa.updateAvailable) {
    return (
      <aside className="pwa-notice" role="status">
        <RefreshCw size={19} />
        <div><b>Update ready</b><span>Reload into the latest P4Pair version.</span></div>
        <button type="button" onClick={pwa.applyUpdate}>Update</button>
      </aside>
    )
  }

  if (pwa.showInstallNotice && !pwa.showIosHint) {
    return (
      <aside className="pwa-notice" role="status">
        <Download size={19} />
        <div><b>Install P4Pair</b><span>Open it like an app on this device.</span></div>
        <div className="pwa-notice-actions">
          <button type="button" onClick={() => void pwa.requestInstall()}>Install</button>
          <button className="pwa-dismiss" type="button" onClick={pwa.dismissInstallNotice} aria-label="Dismiss install prompt">
            <X size={17} />
          </button>
        </div>
      </aside>
    )
  }

  if (pwa.showInstallNotice && pwa.showIosHint) {
    return (
      <aside className="pwa-notice" role="status">
        <Download size={19} />
        <div><b>Install on this device</b><span>In Safari, tap Share, then “Add to Home Screen.”</span></div>
        <button className="pwa-dismiss" type="button" onClick={pwa.dismissInstallNotice} aria-label="Dismiss install guidance">
          <X size={17} />
        </button>
      </aside>
    )
  }

  return null
}

export default function App() {
  const [roomInput, setRoomInput] = useState(() => {
    const queryCode = new URLSearchParams(window.location.search).get('room')
    let code = queryCode ?? ''
    if (!code) {
      try {
        code = window.localStorage.getItem('p4pair:last-room') ?? ''
      } catch {
        // A saved room is optional.
      }
    }
    return normalizeRoomCode(code)
  })
  const session = usePeerSession()
  const pwa = usePwa()

  useEffect(() => {
    if (!session.roomCode) return
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('room', session.roomCode)
    window.history.replaceState({}, '', url)
  }, [session.roomCode])

  let content: ReactNode
  if (session.phase !== 'idle' && !session.roomCode && session.phase !== 'failed') {
    content = (
      <div className="connecting-screen">
        <Brand />
        <span className="large-spinner"><Activity size={28} /></span>
        <h1>Opening the signal</h1>
        <p>Preparing a private room for the two browsers.</p>
      </div>
    )
  } else if (session.roomCode) {
    content = <ChatWorkspace session={session} pwa={pwa} />
  } else {
    content = (
      <Landing
        roomInput={roomInput}
        onRoomInput={setRoomInput}
        onCreate={() => void session.createRoom()}
        onJoin={() => void session.joinRoom(roomInput)}
        busy={session.phase === 'signaling'}
        error={session.error}
        online={pwa.online}
        pwa={pwa}
        displayName={session.displayName}
        onDisplayName={session.setDisplayName}
      />
    )
  }

  return (
    <>
      {content}
      <PwaNotice pwa={pwa} />
    </>
  )
}
