import { describe, expect, it } from 'vitest'
import { compactWaveform } from './useVoiceRecorder'

describe('voice waveform compaction', () => {
  it('creates a stable number of visible bars for silence', () => {
    expect(compactWaveform([], 4)).toEqual([0.08, 0.08, 0.08, 0.08])
  })

  it('preserves peaks while constraining values to the display range', () => {
    expect(compactWaveform([0.1, 0.7, 0.2, 2], 2)).toEqual([0.7, 1])
  })
})
