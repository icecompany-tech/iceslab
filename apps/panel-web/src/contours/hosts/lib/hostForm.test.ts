import { describe, expect, it } from 'vitest'
import { draftOfHost, draftProblems, emptyDraft, hostCreateFields, hostUpdateBody } from '@/contours/hosts/lib/hostForm'
import type { Host } from '@/lib/old/hosts'

const host = { remark: 'Direct', enabled: true, addressOverride: null, sniOverride: null, hostHeaderOverride: null, pathOverride: null, fingerprintOverride: null, alpn: [], securityLayer: 'default', allowInsecure: false, disableForFormats: ['clash'], serverDescription: null, isHidden: false } as unknown as Host

describe('the body of a host save', () => {
  it('an untouched form sends nothing', () => {
    const draft = draftOfHost(host)
    expect(hostUpdateBody(draft, { ...draft })).toEqual({})
  })

  it('sends only what changed, a cleared field as null', () => {
    const draft = { ...draftOfHost(host), sni: 'a.example' }
    expect(hostUpdateBody(draft, { ...draft, sni: '' })).toEqual({ sniOverride: null })
    expect(hostUpdateBody(draft, { ...draft, remark: 'x' })).toEqual({ remark: 'x' })
    expect(hostUpdateBody(draft, { ...draft, disabledFormats: [] })).toEqual({ disableForFormats: [] })
  })

  it('on a create a field the profile cannot serve is sent as null, not as an earlier choice', () => {
    const draft = { ...emptyDraft(), remark: 'r', sni: 'stale.example', alpn: ['h2'] }
    const fields = hostCreateFields(draft, { sniOverride: { supported: false }, alpn: { supported: false } })
    expect(fields.sniOverride).toBeNull()
    expect(fields.alpn).toEqual([])
    expect(hostCreateFields(draft, { sniOverride: { supported: true } }).sniOverride).toBe('stale.example')
  })

  it('refuses at the field', () => {
    expect(draftProblems({ ...emptyDraft(), remark: ' ', address: 'a b' })).toMatchObject({ remark: true, address: 'space' })
  })
})
