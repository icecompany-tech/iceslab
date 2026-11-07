import { describe, expect, it } from 'vitest'
import { draftOfRule, fallsTo, nextPriority, priorityValid, ruleCreateBody, ruleUpdateBody } from '@/contours/subscription/lib/srrBody'
import type { SrrRule } from '@/lib/old/srr'

const rule = (over: Partial<SrrRule> = {}): SrrRule => ({ id: 'r1', name: 'Happ', uaPattern: '(?i)happ', format: 'plain', priority: 10, enabled: true, templateName: null, createdAt: '', updatedAt: '', ...over })
const all = rule({ id: 'all', name: 'Все', uaPattern: '.*', format: 'singbox', priority: 1000 })

describe('rule bodies', () => {
  it('untouched rule sends nothing', () => {
    expect(ruleUpdateBody(rule(), draftOfRule(rule(), []))).toEqual({})
  })

  it('a change sends only itself, a template back to Default is null', () => {
    const stored = rule({ templateName: 'mine' })
    const draft = draftOfRule(stored, [])
    expect(ruleUpdateBody(stored, { ...draft, priority: '20' })).toEqual({ priority: 20 })
    expect(ruleUpdateBody(stored, { ...draft, templateName: null })).toEqual({ templateName: null })
  })

  it('a server older than the template field gets no key', () => {
    const stored = rule({ templateName: undefined })
    expect(ruleUpdateBody(stored, draftOfRule(stored, []))).toEqual({})
  })

  it('a new rule carries a template only when chosen', () => {
    const draft = { ...draftOfRule(null, []), name: ' n ', uaPattern: 'x' }
    expect(ruleCreateBody(draft)).toEqual({ name: 'n', uaPattern: 'x', format: 'plain', priority: 100, enabled: true })
    expect(ruleCreateBody({ ...draft, templateName: 't' }).templateName).toBe('t')
  })

  it('a new rule lands after the others, ahead of the catch-all', () => {
    expect(nextPriority([])).toBe(100)
    expect(nextPriority([rule({ priority: 50 })])).toBe(60)
    expect(nextPriority([rule({ priority: 50 }), all])).toBe(60)
    expect(nextPriority([rule({ priority: 999 }), all])).toBe(999)
  })

  it('priority is a whole number in range', () => {
    expect(priorityValid('0')).toBe(true)
    expect(priorityValid('10000')).toBe(true)
    expect(priorityValid('10001')).toBe(false)
    expect(priorityValid('1.5')).toBe(false)
    expect(priorityValid('')).toBe(false)
  })

  it('F-K6: the delete window knows where clients land', () => {
    expect(fallsTo([rule(), all], rule())).toEqual({ kind: 'catchAll', name: 'Все', format: 'singbox' })
    expect(fallsTo([rule(), all], all)).toEqual({ kind: 'endpointDefault' })
    expect(fallsTo([rule(), { ...all, enabled: false }], rule())).toEqual({ kind: 'endpointDefault' })
  })
})
