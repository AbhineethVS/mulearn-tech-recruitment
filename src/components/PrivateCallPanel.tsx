import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  Play,
  RefreshCw,
  UserRound,
  Video,
  VolumeX,
  X,
} from 'lucide-react'
import type { ConnectionQuality, ConnectionRoute } from '../lib/peer-connection'
import type { CallMode, LiveCallState } from '../types/messages'

const formatCallDuration = (startedAt: number | null, now: number) => {
  const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

type PrivateCallPanelProps = {
  call: LiveCallState
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  canSwitchCamera: boolean
  route: ConnectionRoute | null
  quality: ConnectionQuality | null
  connected: boolean
  recordingVoiceNote: boolean
  onStart: (mode: CallMode) => void
  onAccept: () => void
  onDecline: () => void
  onCancel: () => void
  onEnd: () => void
  onToggleMute: () => void
  onToggleCamera: () => void
  onSwitchCamera: () => void
  onDismissError: () => void
}

export function PrivateCallPanel({
  call,
  localStream,
  remoteStream,
  canSwitchCamera,
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
  onToggleCamera,
  onSwitchCamera,
  onDismissError,
}: PrivateCallPanelProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [now, setNow] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    const video = remoteVideoRef.current
    if (call.mode === 'video') {
      if (audio) audio.srcObject = null
      if (video) video.srcObject = remoteStream
    } else {
      if (video) video.srcObject = null
      if (audio) audio.srcObject = remoteStream
    }
    if (
      !remoteStream ||
      (call.phase !== 'connecting' && call.phase !== 'active')
    ) {
      return
    }
    const player = call.mode === 'video' ? video : audio
    void player
      ?.play()
      .then(() => setAutoplayBlocked(false))
      .catch(() => setAutoplayBlocked(true))
  }, [call.mode, call.phase, remoteStream])

  useEffect(() => {
    const video = localVideoRef.current
    if (!video) return
    video.srcObject = localStream
    if (localStream) void video.play().catch(() => undefined)
  }, [call.cameraEnabled, localStream])

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
    const player = call.mode === 'video' ? remoteVideoRef.current : audioRef.current
    void player
      ?.play()
      .then(() => setAutoplayBlocked(false))
      .catch(() => setAutoplayBlocked(true))
  }

  const peer = call.peerName || 'Peer'
  const callInProgress =
    call.phase === 'outgoing_ringing' || call.phase === 'connecting' || call.phase === 'active'
  const status =
    call.phase === 'outgoing_ringing'
      ? 'Calling…'
      : call.phase === 'connecting'
        ? `Connecting ${call.mode === 'video' ? 'video' : 'audio'}…`
        : formatCallDuration(call.startedAt, now)

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
            <span className="incoming-call-icon">
              {call.mode === 'video' ? <Video size={24} /> : <PhoneCall size={24} />}
            </span>
            <small>Private {call.mode} call</small>
            <h2 id="incoming-call-title">{peer} is calling</h2>
            <p>
              Your {call.mode === 'video' ? 'camera and microphone start' : 'microphone starts'} only
              if you accept.
            </p>
            <div className="incoming-call-actions">
              <button className="call-decline" type="button" onClick={onDecline}>
                <PhoneOff size={18} /> Decline
              </button>
              <button className="call-accept" type="button" onClick={onAccept} autoFocus>
                {call.mode === 'video' ? <Video size={18} /> : <Phone size={18} />} Accept
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
            onClick={() => onStart('voice')}
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
          <button
            className="call-launch call-launch-video"
            type="button"
            onClick={() => onStart('video')}
            disabled={!connected || recordingVoiceNote}
            aria-label={`Start a video call${peer !== 'Peer' ? ` with ${peer}` : ''}`}
            title={
              recordingVoiceNote
                ? 'Finish the voice message before starting a call'
                : 'Start a private video call'
            }
          >
            <Video size={18} />
            <span>Video call</span>
          </button>
        </div>
      )}

      {callInProgress && call.mode === 'video' && (
        <section className="video-call-stage" aria-label="Private video call" aria-live="polite">
          <div className="remote-video-frame">
            <video
              ref={remoteVideoRef}
              className={call.remoteCameraEnabled ? '' : 'video-camera-off'}
              autoPlay
              playsInline
              aria-label={`${peer}'s camera`}
            />
            {!call.remoteCameraEnabled && (
              <div className="video-placeholder">
                <UserRound size={36} />
                <span>
                  {call.phase === 'outgoing_ringing'
                    ? `Calling ${peer}…`
                    : `${peer}'s camera is off`}
                </span>
              </div>
            )}
            <div className="video-call-status">
              <b>{peer}</b>
              <span>
                {status}
                {call.phase === 'active' && ` · ${quality?.label ?? route?.label ?? 'WebRTC'}`}
              </span>
            </div>
            {call.remoteMuted && (
              <span className="video-remote-muted"><VolumeX size={14} /> Muted</span>
            )}
            {call.cameraEnabled && (
              <div className="local-video-frame">
                <video
                  ref={localVideoRef}
                  className={call.facingMode === 'user' ? 'local-video-mirrored' : ''}
                  autoPlay
                  playsInline
                  muted
                  aria-label="Your camera preview"
                />
                <span>You</span>
              </div>
            )}
            {!call.cameraEnabled && call.phase !== 'outgoing_ringing' && (
              <div className="local-video-frame local-camera-off">
                <CameraOff size={20} />
                <span>You</span>
              </div>
            )}
            <div className="video-call-controls">
              {autoplayBlocked && (
                <button className="call-play-audio" type="button" onClick={recoverAudio}>
                  <Play size={15} /> Play audio
                </button>
              )}
              {call.phase !== 'outgoing_ringing' && (
                <>
                  <button
                    className={`call-control ${call.muted ? 'control-muted' : ''}`}
                    type="button"
                    onClick={onToggleMute}
                    aria-pressed={call.muted}
                    aria-label={call.muted ? 'Unmute microphone' : 'Mute microphone'}
                  >
                    {call.muted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                  <button
                    className={`call-control ${!call.cameraEnabled ? 'control-muted' : ''}`}
                    type="button"
                    onClick={onToggleCamera}
                    aria-pressed={!call.cameraEnabled}
                    aria-label={call.cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                  >
                    {call.cameraEnabled ? <Camera size={18} /> : <CameraOff size={18} />}
                  </button>
                  {canSwitchCamera && call.cameraEnabled && (
                    <button
                      className="call-control"
                      type="button"
                      onClick={onSwitchCamera}
                      aria-label="Switch camera"
                    >
                      <RefreshCw size={18} />
                    </button>
                  )}
                </>
              )}
              <button
                className="call-control control-end"
                type="button"
                onClick={call.phase === 'outgoing_ringing' ? onCancel : onEnd}
                aria-label={call.phase === 'outgoing_ringing' ? 'Cancel call' : 'End call'}
              >
                <PhoneOff size={18} />
              </button>
            </div>
            {call.error && call.phase !== 'failed' && (
              <p className="video-call-error" role="alert">{call.error}</p>
            )}
          </div>
        </section>
      )}

      {callInProgress && call.mode === 'voice' && (
        <section className="live-call-bar" aria-label="Private voice call" aria-live="polite">
          <span className="live-call-symbol"><PhoneCall size={19} /></span>
          <div className="live-call-copy">
            <b>{peer}</b>
            <span>
              {status}
              {call.phase === 'active' && ` · ${quality?.label ?? route?.label ?? 'WebRTC'}`}
            </span>
          </div>
          {call.remoteMuted && (
            <span className="remote-muted"><VolumeX size={14} /> Peer muted</span>
          )}
          {autoplayBlocked && (
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
          <span><b>{call.mode === 'video' ? 'Video' : 'Voice'} call ended</b>{call.error}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss call notice">
            <X size={16} />
          </button>
        </div>
      )}
    </>
  )
}
