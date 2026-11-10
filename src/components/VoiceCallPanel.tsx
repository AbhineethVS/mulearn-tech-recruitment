import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneCall, PhoneOff, Play, VolumeX, X } from 'lucide-react'
import type { ConnectionQuality, ConnectionRoute } from '../lib/peer-connection'
import type { LiveCallState } from '../types/messages'

const formatCallDuration = (startedAt: number | null, now: number) => {
  const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

type VoiceCallPanelProps = {
  call: LiveCallState
  remoteStream: MediaStream | null
  route: ConnectionRoute | null
  quality: ConnectionQuality | null
  connected: boolean
  recordingVoiceNote: boolean
  onStart: () => void
  onAccept: () => void
  onDecline: () => void
  onCancel: () => void
  onEnd: () => void
  onToggleMute: () => void
  onDismissError: () => void
}

export function VoiceCallPanel({
  call,
  remoteStream,
  route,
  quality,
  connected,
  recordingVoiceNote,
  onStart,
  onAccept,
  onDecline,
  onCancel,
  onEnd,
  onToggleMute,
  onDismissError,
}: VoiceCallPanelProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [now, setNow] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.srcObject = remoteStream
    if (!remoteStream || (call.phase !== 'connecting' && call.phase !== 'active')) {
      return
    }
    void audio
      .play()
      .then(() => setAutoplayBlocked(false))
      .catch(() => setAutoplayBlocked(true))
  }, [call.phase, remoteStream])

  useEffect(() => {
    if (call.phase !== 'active') return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [call.phase])

  useEffect(() => {
    if (call.phase !== 'incoming_ringing') return
    const declineOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDecline()
    }
    window.addEventListener('keydown', declineOnEscape)
    return () => window.removeEventListener('keydown', declineOnEscape)
  }, [call.phase, onDecline])

  const recoverAudio = () => {
    void audioRef.current
      ?.play()
      .then(() => setAutoplayBlocked(false))
      .catch(() => setAutoplayBlocked(true))
  }

  const peer = call.peerName || 'Peer'
  const callInProgress =
    call.phase === 'outgoing_ringing' || call.phase === 'connecting' || call.phase === 'active'

  return (
    <>
      <audio ref={audioRef} autoPlay playsInline aria-label="Live call audio" />

      {call.phase === 'incoming_ringing' && (
        <div className="call-dialog-backdrop">
          <section
            className="incoming-call-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="incoming-call-title"
          >
            <span className="incoming-call-icon"><PhoneCall size={24} /></span>
            <small>Private voice call</small>
            <h2 id="incoming-call-title">{peer} is calling</h2>
            <p>Your microphone starts only if you accept.</p>
            <div className="incoming-call-actions">
              <button className="call-decline" type="button" onClick={onDecline}>
                <PhoneOff size={18} /> Decline
              </button>
              <button className="call-accept" type="button" onClick={onAccept} autoFocus>
                <Phone size={18} /> Accept
              </button>
            </div>
          </section>
        </div>
      )}

      {call.phase === 'idle' && (
        <div className="call-launch-row">
          <button
            className="call-launch"
            type="button"
            onClick={onStart}
            disabled={!connected || recordingVoiceNote}
            aria-label={`Start a voice call${peer !== 'Peer' ? ` with ${peer}` : ''}`}
            title={
              recordingVoiceNote
                ? 'Finish the voice message before starting a call'
                : 'Start a private voice call'
            }
          >
            <Phone size={18} />
            <span>Voice call</span>
          </button>
        </div>
      )}

      {callInProgress && (
        <section className="live-call-bar" aria-label="Private voice call" aria-live="polite">
          <span className="live-call-symbol"><PhoneCall size={19} /></span>
          <div className="live-call-copy">
            <b>{peer}</b>
            <span>
              {call.phase === 'outgoing_ringing'
                ? 'Calling…'
                : call.phase === 'connecting'
                  ? 'Connecting audio…'
                  : formatCallDuration(call.startedAt, now)}
              {call.phase === 'active' && ` · ${quality?.label ?? route?.label ?? 'WebRTC'}`}
            </span>
          </div>
          {call.remoteMuted && (
            <span className="remote-muted"><VolumeX size={14} /> Peer muted</span>
          )}
          {autoplayBlocked && (call.phase === 'connecting' || call.phase === 'active') && (
            <button className="call-play-audio" type="button" onClick={recoverAudio}>
              <Play size={15} /> Play audio
            </button>
          )}
          {call.phase !== 'outgoing_ringing' && (
            <button
              className={`call-control ${call.muted ? 'control-muted' : ''}`}
              type="button"
              onClick={onToggleMute}
              aria-pressed={call.muted}
              aria-label={call.muted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {call.muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          )}
          <button
            className="call-control control-end"
            type="button"
            onClick={call.phase === 'outgoing_ringing' ? onCancel : onEnd}
            aria-label={call.phase === 'outgoing_ringing' ? 'Cancel call' : 'End call'}
          >
            <PhoneOff size={18} />
          </button>
        </section>
      )}

      {call.phase === 'failed' && (
        <div className="call-error" role="alert">
          <PhoneOff size={17} />
          <span><b>Voice call ended</b>{call.error}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss call notice">
            <X size={16} />
          </button>
        </div>
      )}
    </>
  )
}
