import {
  Activity,
  ArrowUp,
  Check,
  CheckCheck,
  Copy,
  Download,
  FileUp,
  Link2,
  LockKeyhole,
  MessageSquareText,
  Paperclip,
  Radio,
  RefreshCw,
  ShieldCheck,
  Unplug,
  UserRound,
  Wifi,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { normalizeRoomCode } from '../shared/protocol'
import { usePeerSession, type SessionPhase } from './hooks/usePeerSession'
import type { FileTransfer } from './types/messages'
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
      <span>Pairly</span>
    </div>
  )
}

function Landing({
  roomInput,
  onRoomInput,
  onCreate,
  onJoin,
  busy,
  error,
}: {
  roomInput: string
  onRoomInput: (value: string) => void
  onCreate: () => void
  onJoin: () => void
  busy: boolean
  error: string
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onJoin()
  }

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <Brand />
        <span className="protocol-chip"><Radio size={15} /> WebRTC data channel</span>
      </header>

      <main className="landing-main">
        <section className="landing-copy">
          <p className="context-line">Two browsers. One direct route.</p>
          <h1>A chat server that never sees your chat.</h1>
          <p className="landing-intro">
            Pairly uses a server for the introduction, then gets out of the way.
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

          <button className="primary-action" type="button" onClick={onCreate} disabled={busy}>
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
              <button type="submit" disabled={busy || roomInput.length !== 8}>
                Join
                <ArrowUp size={17} />
              </button>
            </div>
          </form>
          {error && <p className="inline-error" role="alert">{error}</p>}

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

function ConnectionRail({ phase }: { phase: SessionPhase }) {
  const status = phaseCopy[phase]
  return (
    <section className={`connection-rail tone-${status.tone}`} aria-label="Connection route">
      <div className="rail-peer">
        <span className="peer-node"><UserRound size={17} /></span>
        <span><b>This browser</b><small>Local peer</small></span>
      </div>
      <div className="rail-path">
        <span />
        <div className="rail-status" role="status" aria-live="polite">
          {phase === 'connected' ? <Wifi size={15} /> : <Activity size={15} />}
          <b>{status.label}</b>
        </div>
        <span />
      </div>
      <div className="rail-peer rail-peer-right">
        <span><b>Other browser</b><small>Remote peer</small></span>
        <span className="peer-node"><UserRound size={17} /></span>
      </div>
    </section>
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

function ChatWorkspace({ session }: { session: ReturnType<typeof usePeerSession> }) {
  const [draft, setDraft] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [fileError, setFileError] = useState('')
  const messageEndRef = useRef<HTMLDivElement>(null)
  const typingTimerRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const status = phaseCopy[session.phase]

  const inviteUrl = useMemo(() => {
    if (!session.roomCode) return ''
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('room', session.roomCode)
    return url.toString()
  }, [session.roomCode])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [session.messages, session.transfers, session.peerTyping])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (session.phase === 'connected') event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [session.phase])

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteUrl)
    setCopyState('copied')
    window.setTimeout(() => setCopyState('idle'), 1800)
  }

  const submitMessage = () => {
    if (session.sendMessage(draft)) {
      setDraft('')
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
        <button className="leave-button" type="button" onClick={leaveRoom}>
          <Unplug size={17} />
          Leave
        </button>
      </header>

      <ConnectionRail phase={session.phase} />

      <main className="chat-layout">
        <section className="conversation" aria-label="Peer conversation">
          <header className="conversation-header">
            <div>
              <span className={`status-light tone-${status.tone}`} />
              <span><b>{status.label}</b><small>{status.detail}</small></span>
            </div>
            <span className="privacy-note"><LockKeyhole size={14} /> Direct and encrypted in transit</span>
          </header>

          <div className="message-list" aria-live="polite">
            {session.messages.length === 0 && session.transfers.length === 0 && (
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

            {session.messages.map((message) => (
              <article className={`message message-${message.direction}`} key={message.id}>
                <p>{message.text}</p>
                <footer>
                  <time dateTime={message.sentAt}>
                    {new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </time>
                  {message.direction === 'outgoing' && (
                    message.status === 'delivered'
                      ? <CheckCheck size={14} aria-label="Delivered" />
                      : <Check size={14} aria-label="Sent" />
                  )}
                </footer>
              </article>
            ))}

            {session.transfers.map((transfer) => (
              <TransferItem key={transfer.id} transfer={transfer} onCancel={session.cancelTransfer} />
            ))}

            {session.peerTyping && <p className="typing-indicator">Peer is typing<span>…</span></p>}
            <div ref={messageEndRef} />
          </div>

          {(session.error || fileError) && (
            <div className="conversation-error" role="alert">
              <span>{fileError || session.error}</span>
              {(session.phase === 'disconnected' || session.phase === 'failed') && (
                <button type="button" onClick={session.retry}><RefreshCw size={15} /> Try again</button>
              )}
            </div>
          )}

          <form
            className="composer"
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
            <button className="send-button" type="submit" disabled={session.phase !== 'connected' || !draft.trim()} aria-label="Send message">
              <ArrowUp size={19} />
            </button>
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
          <dl className="connection-facts">
            <div><dt>Transport</dt><dd>WebRTC / SCTP</dd></div>
            <div><dt>Signaling</dt><dd>WebSocket</dd></div>
            <div><dt>Peer ID</dt><dd title={session.peerId}>{session.peerId.slice(0, 8) || 'Pending'}</dd></div>
          </dl>
        </aside>
      </main>
    </div>
  )
}

export default function App() {
  const [roomInput, setRoomInput] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('room') ?? ''
    return normalizeRoomCode(code)
  })
  const session = usePeerSession()

  if (session.phase !== 'idle' && !session.roomCode && session.phase !== 'failed') {
    return (
      <div className="connecting-screen">
        <Brand />
        <span className="large-spinner"><Activity size={28} /></span>
        <h1>Opening the signal</h1>
        <p>Preparing a private room for the two browsers.</p>
      </div>
    )
  }

  if (session.roomCode) {
    return <ChatWorkspace session={session} />
  }

  return (
    <Landing
      roomInput={roomInput}
      onRoomInput={setRoomInput}
      onCreate={() => void session.createRoom()}
      onJoin={() => void session.joinRoom(roomInput)}
      busy={session.phase === 'signaling'}
      error={session.error}
    />
  )
}
