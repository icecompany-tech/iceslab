import { describe, expect, it } from 'vitest'
import { draftOfOwn, lineProblem, listProblems, ownBody, refusedTokens } from '@/contours/traffic/lib/ownLists'

describe('F-26: an own list line', () => {
  it('a rule row refuses the prefixes the server answers 400 to, and a space inside an entry', () => {
    expect(refusedTokens(['ip:1.1.1.1', 'CIDR:10.0.0.0/8', 'a b', 'geoip:ru', '1.1.1.1', 'vk.com'])).toEqual(['ip:1.1.1.1', 'CIDR:10.0.0.0/8', 'a b'])
  })

  it('refuses before any request', () => {
    expect(lineProblem('ip:1.1.1.1')).toBe('prefix')
    expect(lineProblem('a.com, b.com')).toBe('separator')
    expect(lineProblem('a.com b.com')).toBe('separator')
    expect(lineProblem('ext:x:y')).toBe('ext')
    expect(lineProblem('regexp:(')).toBe('regexp')
  })

  it('passes what a client can read', () => {
    for (const ok of ['vk.com', 'domain:x.ru', 'geosite:category-ru', 'regexp:^a.*$', 'full:x.ru']) expect(lineProblem(ok)).toBeNull()
  })

  it('names the lines, blanks are not lines', () => {
    expect(listProblems('vk.com\n\n a b \next:x:y')).toEqual([{ line: 'a b', problem: 'separator' }, { line: 'ext:x:y', problem: 'ext' }])
  })
})

describe('ownBody', () => {
  const stored = draftOfOwn({ subscriptionCustomDomainLists: { direct: ['a.ru'], proxy: [], block: [] }, subscriptionCustomRoutingRules: [{ type: 'field' }] })

  it('untouched sends nothing', () => {
    expect(ownBody(stored, stored)).toEqual({})
  })

  it('a list change sends the lists and no rules', () => {
    expect(ownBody(stored, { ...stored, block: 'x.ru' })).toEqual({ subscriptionCustomDomainLists: { direct: ['a.ru'], proxy: [], block: ['x.ru'] } })
  })

  it('all lists emptied clears the setting, rules emptied clear theirs', () => {
    expect(ownBody(stored, { ...stored, direct: '' })).toEqual({ subscriptionCustomDomainLists: null })
    expect(ownBody(stored, { ...stored, rules: '  ' })).toEqual({ subscriptionCustomRoutingRules: null })
  })
})
