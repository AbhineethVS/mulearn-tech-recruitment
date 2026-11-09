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
