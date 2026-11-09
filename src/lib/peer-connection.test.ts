import { describe, expect, it } from 'vitest'
import { diagnoseIceFailure } from './peer-connection'

describe('ICE failure diagnosis', () => {
  it('identifies likely isolation when both peers advertise the same private subnet', () => {
    const diagnosis = diagnoseIceFailure({
      localCandidates: [
        'candidate:1 1 udp 2122129151 192.168.31.217 51095 typ host generation 0',
      ],
      remoteCandidates: [
        'candidate:2 1 udp 2113937151 192.168.31.36 43866 typ host generation 0',
      ],
      turnConfigured: false,
    })

    expect(diagnosis.title).toBe('Likely local-network isolation')
    expect(diagnosis.detail).toContain('laptop’s mobile hotspot')
  })

  it('distinguishes a blocked direct route when peers are not on one private subnet', () => {
    const diagnosis = diagnoseIceFailure({
      localCandidates: ['candidate:1 1 udp 1 10.0.0.2 5000 typ host'],
      remoteCandidates: ['candidate:2 1 udp 1 192.168.1.3 6000 typ host'],
      turnConfigured: false,
    })

    expect(diagnosis.title).toBe('The direct route is blocked')
  })
})
