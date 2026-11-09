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
})
