import { describe, expect, it } from 'vitest'
import type { CallEnvelope, LiveCallState } from '../types/messages'
import {
  cameraErrorMessage,
  callControlMatches,
  isCallEnvelope,
  localInviteWins,
  mediaRequestIsCurrent,
  microphoneErrorMessage,
} from './live-call'

const callId = '123e4567-e89b-12d3-a456-426614174000'

const activeCall: LiveCallState = {
  phase: 'active',
  callId,
  peerId: 'peer-b',
  peerName: 'Bina',
  mode: 'video',
  startedAt: 100,
  muted: false,
  remoteMuted: false,
  cameraEnabled: true,
  remoteCameraEnabled: true,
  facingMode: 'user',
  error: '',
}

describe('live call protocol validation', () => {
  const validEnvelopes: CallEnvelope[] = [
    { kind: 'call_invite', callId, mode: 'video', sentAt: new Date().toISOString() },
    { kind: 'call_accept', callId },
    { kind: 'call_ready', callId },
    { kind: 'call_decline', callId, reason: 'declined' },
    { kind: 'call_cancel', callId },
    { kind: 'call_end', callId, reason: 'hangup' },
    { kind: 'call_mute', callId, muted: true },
    { kind: 'call_video', callId, enabled: false },
  ]

  it.each(validEnvelopes)('accepts $kind controls', (envelope) => {
    expect(isCallEnvelope(envelope)).toBe(true)
  })

  it('rejects malformed IDs, timestamps, mute states, and oversized reasons', () => {
    expect(isCallEnvelope({ kind: 'call_accept', callId: 'short' })).toBe(false)
    expect(isCallEnvelope({ kind: 'call_invite', callId, sentAt: 'not-a-date' })).toBe(false)
    expect(
      isCallEnvelope({
        kind: 'call_invite',
        callId,
        mode: 'screen',
        sentAt: new Date().toISOString(),
      }),
    ).toBe(false)
    expect(isCallEnvelope({ kind: 'call_mute', callId, muted: 'yes' })).toBe(false)
    expect(isCallEnvelope({ kind: 'call_video', callId, enabled: 'yes' })).toBe(false)
    expect(
      isCallEnvelope({ kind: 'call_end', callId, reason: 'x'.repeat(121) }),
    ).toBe(false)
  })
})

describe('deterministic call safety', () => {
  it('chooses exactly one outgoing invitation during a crossed call', () => {
    expect(localInviteWins('peer-a', 'peer-b')).toBe(true)
    expect(localInviteWins('peer-b', 'peer-a')).toBe(false)
  })

  it('ignores stale controls from another call or peer', () => {
    expect(callControlMatches(activeCall, 'peer-b', { kind: 'call_end', callId })).toBe(true)
    expect(
      callControlMatches(activeCall, 'peer-b', {
        kind: 'call_cancel',
        callId: '00000000-0000-0000-0000-000000000000',
      }),
    ).toBe(false)
    expect(callControlMatches(activeCall, 'peer-c', { kind: 'call_mute', callId, muted: true }))
      .toBe(false)
    expect(
      callControlMatches(activeCall, 'peer-b', {
        kind: 'call_video',
        callId: '00000000-0000-0000-0000-000000000000',
        enabled: false,
      }),
    ).toBe(false)
  })

  it('invalidates late microphone results after cancellation', () => {
    expect(mediaRequestIsCurrent(4, 4, activeCall, callId, 'peer-b')).toBe(true)
    expect(mediaRequestIsCurrent(4, 5, activeCall, callId, 'peer-b')).toBe(false)
  })

  it('provides useful permission and device failures', () => {
    expect(microphoneErrorMessage(new DOMException('', 'NotAllowedError'))).toContain('denied')
    expect(microphoneErrorMessage(new DOMException('', 'NotFoundError'))).toContain('No microphone')
    expect(microphoneErrorMessage(new DOMException('', 'NotReadableError'))).toContain('another app')
    expect(cameraErrorMessage(new DOMException('', 'NotAllowedError'))).toContain('denied')
    expect(cameraErrorMessage(new DOMException('', 'NotFoundError'))).toContain(
      'camera and microphone',
    )
    expect(cameraErrorMessage(new DOMException('', 'OverconstrainedError'))).toContain(
      'not available',
    )
  })
})
