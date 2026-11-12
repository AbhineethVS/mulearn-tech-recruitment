import { describe, expect, it } from 'vitest'
import {
  classifyConnectionQuality,
  classifyConnectionRoute,
  diagnoseIceFailure,
} from './peer-connection'

describe('ICE failure diagnosis', () => {
  it('identifies likely isolation when both peers advertise the same private subnet', () => {
    const diagnosis = diagnoseIceFailure({
      localCandidates: [
        'candidate:1 1 udp 2122129151 192.168.31.217 51095 typ host generation 0',
      ],
      remoteCandidates: [
        'candidate:2 1 udp 2113937151 192.168.31.36 43866 typ host generation 0',
      ],
    })

    expect(diagnosis.title).toBe('Likely local-network isolation')
    expect(diagnosis.detail).toContain('laptop’s mobile hotspot')
  })

  it('distinguishes a blocked direct route when peers are not on one private subnet', () => {
    const diagnosis = diagnoseIceFailure({
      localCandidates: ['candidate:1 1 udp 1 10.0.0.2 5000 typ host'],
      remoteCandidates: ['candidate:2 1 udp 1 192.168.1.3 6000 typ host'],
    })

    expect(diagnosis.title).toBe('The direct route is blocked')
  })
})

describe('selected connection route', () => {
  it('does not present unexpected relay candidates as a supported route', () => {
    expect(classifyConnectionRoute('relay', 'host')).toMatchObject({
      kind: 'unknown',
      label: 'Unknown WebRTC route',
    })
  })

  it('distinguishes STUN-discovered and host-only direct routes', () => {
    expect(classifyConnectionRoute('host', 'srflx').kind).toBe('stun')
    expect(classifyConnectionRoute('host', 'host').kind).toBe('host')
  })
})

describe('connection quality', () => {
  it('classifies round-trip latency without overstating missing measurements', () => {
    expect(classifyConnectionQuality(45).rating).toBe('excellent')
    expect(classifyConnectionQuality(150).rating).toBe('good')
    expect(classifyConnectionQuality(280).rating).toBe('fair')
    expect(classifyConnectionQuality(650).rating).toBe('poor')
    expect(classifyConnectionQuality(null).rating).toBe('unknown')
  })
})
