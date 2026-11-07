import { describe, expect, it } from 'vitest'
import { blankNodePolicy, type NodePolicy, type PolicyRule } from '@/lib/old/nodePolicies'
import type { RoutePolicy } from '@/lib/old/routePolicies'
import { isEmptyPolicy, isUntouched, nodePolicyBody, routePolicyBody } from '@/contours/traffic/lib/routeBody'
import { blankPolicy, toRules } from '@/contours/traffic/lib/routeRules'

const policy = (over: Partial<RoutePolicy> = {}): RoutePolicy => ({ id: 'p', name: 'noads', ordinal: 1, directDomains: ['vk.com'], blockDomains: ['ads.com'], ...over })

describe('routePolicyBody', () => {
  it('untouched sends nothing, row order does not count as an edit', () => {
    const p = policy()
    expect(isUntouched(routePolicyBody(p, p.name, toRules(p)))).toBe(true)
    expect(isUntouched(routePolicyBody(p, p.name, [...toRules(p)].reverse()))).toBe(true)
  })

  it('a rename sends the name and no lists', () => {
    const p = policy()
    expect(routePolicyBody(p, ' x ', toRules(p))).toEqual({ name: 'x' })
  })

  it('a change of one list sends that list', () => {
    const p = policy()
    const rules = toRules(p).map((r) => (r.action === 'block' ? { ...r, match: ['ads.org'] } : r))
    expect(routePolicyBody(p, p.name, rules)).toEqual({ blockDomains: ['ads.org'] })
  })

  it('F-10: an empty policy closes the save, new or stored', () => {
    expect(routePolicyBody(blankPolicy(), 'x', [])).toBeNull()
    expect(routePolicyBody(policy(), 'x', [])).toBeNull()
    expect(routePolicyBody(policy(), 'x', [{ id: 'r', match: [''], action: 'block', note: '' }])).toBeNull()
    expect(isEmptyPolicy([{ match: [] }])).toBe(true)
  })

  it('a new policy goes whole, a nameless one is closed', () => {
    const rules = [{ id: 'r', match: ['a.com'], action: 'block' as const, note: '' }]
    expect(routePolicyBody(blankPolicy(), 'x', rules)).toEqual({ name: 'x', directDomains: [], blockDomains: ['a.com'] })
    expect(routePolicyBody(blankPolicy(), '  ', rules)).toBeNull()
  })
})

describe('nodePolicyBody', () => {
  const rule = (id: string): PolicyRule => ({ id, position: 0, enabled: true, match: { domain: ['a'], ip: [], port: null, protocol: [], network: null }, action: { kind: 'block', directionId: null } })
  const stored: NodePolicy = { ...blankNodePolicy(), id: 'n', name: 'main', rules: [rule('r1'), rule('r2')] }

  it('untouched sends nothing', () => {
    expect(isUntouched(nodePolicyBody(stored, 'main', stored.rules))).toBe(true)
  })

  it('a rename keeps the rules out, a reorder sends them whole', () => {
    expect(nodePolicyBody(stored, 'x', stored.rules)).toEqual({ name: 'x' })
    const body = nodePolicyBody(stored, 'main', [...stored.rules].reverse())
    expect(body?.rules?.map((r) => r.id)).toEqual(['r2', 'r1'])
  })

  it('a local row goes without an id, a nameless policy is closed', () => {
    expect(nodePolicyBody(stored, 'main', [...stored.rules, rule('new-1')])?.rules?.at(-1)?.id).toBeUndefined()
    expect(nodePolicyBody(stored, ' ', stored.rules)).toBeNull()
  })

  it('a draft goes whole, even with no rules', () => {
    expect(nodePolicyBody(blankNodePolicy(), 'x', [])).toEqual({ name: 'x', rules: [] })
  })
})
