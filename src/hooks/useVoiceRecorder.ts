import { useCallback, useEffect, useRef, useState } from 'react'

export const MAX_VOICE_DURATION_MS = 2 * 60 * 1000
const WAVEFORM_BARS = 32

export type RecordedVoice = {
  blob: Blob
  durationMs: number
  waveform: number[]
}

export function compactWaveform(samples: number[], barCount = WAVEFORM_BARS) {
  if (samples.length === 0) return Array.from({ length: barCount }, () => 0.08)
  return Array.from({ length: barCount }, (_, index) => {
    const start = Math.floor((index * samples.length) / barCount)
    const end = Math.max(start + 1, Math.ceil(((index + 1) * samples.length) / barCount))
    const peak = Math.max(...samples.slice(start, end))
    return Math.min(1, Math.max(0.08, Number(peak.toFixed(3))))
  })
}

function preferredAudioType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ]
  return types.find((type) => MediaRecorder.isTypeSupported(type))
}

export function useVoiceRecorder(onRecorded: (recording: RecordedVoice) => void) {
  const [recording, setRecording] = useState(false)
  const [durationMs, setDurationMs] = useState(0)
  const [levels, setLevels] = useState(() => compactWaveform([]))
  const [error, setError] = useState('')
  const onRecordedRef = useRef(onRecorded)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<number | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const samplesRef = useRef<number[]>([])
  const startedAtRef = useRef(0)
  const cancelledRef = useRef(false)

  useEffect(() => {
    onRecordedRef.current = onRecorded
  }, [onRecorded])

  const cleanUpCapture = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    recorderRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (recorderRef.current?.state === 'recording') return
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || !('MediaRecorder' in window)) {
      setError('Voice recording is not supported in this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream
      const mimeType = preferredAudioType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      audioContext.createMediaStreamSource(stream).connect(analyser)
      const timeData = new Uint8Array(analyser.fftSize)

      recorderRef.current = recorder
      audioContextRef.current = audioContext
      chunksRef.current = []
      samplesRef.current = []
      cancelledRef.current = false
      startedAtRef.current = Date.now()
      setDurationMs(0)
      setLevels(compactWaveform([]))

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      })
      recorder.addEventListener(
        'stop',
        () => {
          const elapsed = Math.min(Date.now() - startedAtRef.current, MAX_VOICE_DURATION_MS)
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          const waveform = compactWaveform(samplesRef.current)
          const cancelled = cancelledRef.current
          cleanUpCapture()
          setRecording(false)
          if (!cancelled && blob.size > 0) {
            onRecordedRef.current({ blob, durationMs: elapsed, waveform })
          }
        },
        { once: true },
      )

      recorder.start(250)
      setRecording(true)
      timerRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(timeData)
        const rms = Math.sqrt(
          timeData.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) /
            timeData.length,
        )
        samplesRef.current.push(Math.min(1, rms * 4.5))
        setLevels(compactWaveform(samplesRef.current))
        const elapsed = Date.now() - startedAtRef.current
        setDurationMs(Math.min(elapsed, MAX_VOICE_DURATION_MS))
        if (elapsed >= MAX_VOICE_DURATION_MS && recorder.state === 'recording') recorder.stop()
      }, 100)
    } catch (caught) {
      cleanUpCapture()
      const name = caught instanceof DOMException ? caught.name : ''
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in the browser and try again.'
          : name === 'NotFoundError'
            ? 'No microphone was found on this device.'
            : 'The microphone could not start.',
      )
    }
  }, [cleanUpCapture])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  useEffect(
    () => () => {
      cancelledRef.current = true
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      else cleanUpCapture()
    },
    [cleanUpCapture],
  )

  return { recording, durationMs, levels, error, start, stop, cancel }
}
