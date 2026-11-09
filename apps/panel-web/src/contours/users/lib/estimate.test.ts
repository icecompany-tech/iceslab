import { describe, expect, it } from 'vitest'
import { estimateConfigs, presetDays } from '@/contours/users/lib/estimate'

const base = {
  squads: [
    { id: 'all', profileIds: ['p1'], hostIds: [] },
    { id: 'narrow', profileIds: ['p1', 'p2'], hostIds: ['h-de'] },
  ],
  profiles: [
    { id: 'p1', protocol: 'xray' },
    { id: 'p2', protocol: 'hysteria' },
  ],
  bindings: [
    { id: 'b-de', profileId: 'p1', nodeId: 'de', port: 443, enabled: true },
    { id: 'b-nl', profileId: 'p1', nodeId: 'nl', port: 443, enabled: true },
    { id: 'b-hy', profileId: 'p2', nodeId: 'de', port: 8443, enabled: true },
    { id: 'b-off', profileId: 'p1', nodeId: 'se', port: 443, enabled: false },
  ],
  hosts: [
    { id: 'h-de', bindingId: 'b-de' },
    { id: 'h-nl', bindingId: 'b-nl' },
    { id: 'h-hy', bindingId: 'b-hy' },
  ],
  nodes: new Map([
    ['de', { name: 'de-01', countryCode: 'de' }],
    ['nl', { name: 'nl-01', countryCode: 'nl' }],
    ['se', { name: 'se-01', countryCode: 'se' }],
  ]),
}

describe('estimateConfigs', () => {
  it('a squad without hosts gives every enabled binding of its profiles', () => {
    expect(estimateConfigs({ ...base, picked: ['all'] }).map((r) => r.key)).toEqual(['b-de', 'b-nl'])
  })

  it('a narrowed squad gives only bindings with its hosts, across all its profiles', () => {
    expect(estimateConfigs({ ...base, picked: ['narrow'] }).map((r) => r.key)).toEqual(['b-de'])
  })

  it('several squads give the union, each binding once', () => {
    expect(estimateConfigs({ ...base, picked: ['all', 'narrow'] }).map((r) => r.key)).toEqual(['b-de', 'b-nl'])
  })

  it('no squad picked, nothing; a binding with an unknown node or profile is not guessed', () => {
    expect(estimateConfigs({ ...base, picked: [] })).toEqual([])
    expect(estimateConfigs({ ...base, picked: ['all'], nodes: new Map() })).toEqual([])
  })

  it('rows carry node, country, protocol and port', () => {
    expect(estimateConfigs({ ...base, picked: ['all'] })[0]).toEqual({ key: 'b-de', nodeId: 'de', nodeName: 'de-01', countryCode: 'de', protocol: 'xray', port: 443 })
  })
})

describe('presetDays', () => {
  const now = Date.parse('2026-11-06T12:00:00Z')

  it('no term stays no term', () => {
    expect(presetDays(true, '2026-12-06T12:00:00Z', now)).toBeNull()
  })

  it('days from now, rounded, at least one', () => {
    expect(presetDays(false, '2026-12-06T12:00:00Z', now)).toBe(30)
    expect(presetDays(false, '2026-11-06T13:00:00Z', now)).toBe(1)
  })

  it('a date that does not parse gives no term rather than a guess', () => {
    expect(presetDays(false, 'x', now)).toBeNull()
  })
})
