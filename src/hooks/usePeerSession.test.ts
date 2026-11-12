import { describe, expect, it } from 'vitest'
import { isPeerEnvelope } from './usePeerSession'

describe('peer message receipts', () => {
  it('accepts a bounded list of seen message IDs', () => {
    expect(isPeerEnvelope({ kind: 'seen', ids: ['first', 'second'] })).toBe(true)
  })

  it('rejects malformed and oversized seen receipts', () => {
    expect(isPeerEnvelope({ kind: 'seen', ids: ['valid', 42] })).toBe(false)
    expect(
      isPeerEnvelope({
        kind: 'seen',
        ids: Array.from({ length: 101 }, (_, index) => String(index)),
      }),
    ).toBe(false)
  })
})

describe('peer profiles', () => {
  it('accepts bounded display names and rejects empty names', () => {
    expect(isPeerEnvelope({ kind: 'profile', name: 'Akhil' })).toBe(true)
    expect(isPeerEnvelope({ kind: 'profile', name: ' ' })).toBe(false)
    expect(isPeerEnvelope({ kind: 'profile', name: 'x'.repeat(25) })).toBe(false)
  })
})

describe('private call controls', () => {
  const callId = '123e4567-e89b-12d3-a456-426614174000'

  it('accepts typed call controls on the peer channel', () => {
    expect(
      isPeerEnvelope({
        kind: 'call_invite',
        callId,
        mode: 'video',
        sentAt: new Date().toISOString(),
      }),
    ).toBe(true)
    expect(isPeerEnvelope({ kind: 'call_accept', callId })).toBe(true)
    expect(isPeerEnvelope({ kind: 'call_ready', callId })).toBe(true)
    expect(isPeerEnvelope({ kind: 'call_decline', callId, reason: 'declined' })).toBe(true)
    expect(isPeerEnvelope({ kind: 'call_cancel', callId })).toBe(true)
    expect(isPeerEnvelope({ kind: 'call_end', callId, reason: 'hangup' })).toBe(true)
    expect(isPeerEnvelope({ kind: 'call_mute', callId, muted: true })).toBe(true)
    expect(isPeerEnvelope({ kind: 'call_video', callId, enabled: false })).toBe(true)
  })

  it('rejects injected malformed call controls', () => {
    expect(isPeerEnvelope({ kind: 'call_invite', callId, sentAt: 'yesterday' })).toBe(false)
    expect(isPeerEnvelope({ kind: 'call_mute', callId, muted: 1 })).toBe(false)
    expect(isPeerEnvelope({ kind: 'call_end', callId: '../../room' })).toBe(false)
  })
})

describe('replies and reactions', () => {
  it('accepts bounded replies and the supported reaction set', () => {
    expect(
      isPeerEnvelope({
        kind: 'chat',
        id: 'reply',
        text: 'Got it',
        sentAt: new Date().toISOString(),
        replyTo: { id: 'original', text: 'Are you there?', author: 'Peer' },
      }),
    ).toBe(true)
    expect(isPeerEnvelope({ kind: 'reaction', messageId: 'reply', emoji: '❤️' })).toBe(true)
    expect(isPeerEnvelope({ kind: 'reaction', messageId: 'reply', emoji: '🚀' })).toBe(false)
  })

  it('accepts bounded edits and deletes while rejecting empty edits', () => {
    expect(
      isPeerEnvelope({
        kind: 'message_edit',
        messageId: 'message-1',
        text: 'Corrected text',
        editedAt: new Date().toISOString(),
      }),
    ).toBe(true)
    expect(
      isPeerEnvelope({
        kind: 'message_edit',
        messageId: 'message-1',
        text: '   ',
        editedAt: new Date().toISOString(),
      }),
    ).toBe(false)
    expect(
      isPeerEnvelope({
        kind: 'message_delete',
        messageId: 'message-1',
        deletedAt: new Date().toISOString(),
      }),
    ).toBe(true)
  })
})
