import { describe, expect, it } from 'vitest'
import { draftErrors, draftOfNode, hostChanged, nodeUpdateBody } from '@/contours/nodes/lib/nodeBody'
import type { Node } from '@/lib/old/nodes'

const node = { name: 'de-01', address: '91.1.1.1:1337', countryCode: 'DE', regionId: null, domain: null, consumptionMultiplier: 1, maxUsers: null, policyId: null } as unknown as Node

describe('the body of a node save', () => {
  it('an untouched form sends nothing', () => {
    const draft = draftOfNode(node)
    expect(nodeUpdateBody(draft, { ...draft }, node)).toEqual({})
  })

  it('sends only what changed', () => {
    const draft = draftOfNode(node)
    expect(nodeUpdateBody(draft, { ...draft, name: 'de-02' }, node)).toEqual({ name: 'de-02' })
    expect(nodeUpdateBody(draft, { ...draft, port: '2222' }, node)).toEqual({ address: '91.1.1.1:2222' })
    expect(nodeUpdateBody(draft, { ...draft, policyId: 'p' }, node)).toEqual({ policyId: 'p' })
    expect(nodeUpdateBody(draft, { ...draft, maxUsers: '5' }, node)).toEqual({ maxUsers: 5 })
    expect(nodeUpdateBody(draft, { ...draft, domain: 'de.example.net' }, node)).toEqual({ domain: 'de.example.net' })
  })

  it('a detached policy is a real null', () => {
    const withPolicy = { ...node, policyId: 'p' } as Node
    const draft = draftOfNode(withPolicy)
    expect(nodeUpdateBody(draft, { ...draft, policyId: '' }, withPolicy)).toEqual({ policyId: null })
  })

  it('core versions: only the changed component, null puts it back on the pin', () => {
    const pinned = { ...node, coreVersions: { xray: '26.3.27' } } as Node
    const draft = draftOfNode(pinned)
    expect(nodeUpdateBody(draft, { ...draft }, pinned)).toEqual({})
    expect(nodeUpdateBody(draft, { ...draft, coreVersions: { xray: '26.3.27', singbox: '1.13.14' } }, pinned)).toEqual({ coreVersions: { singbox: '1.13.14' } })
    expect(nodeUpdateBody(draft, { ...draft, coreVersions: {} }, pinned)).toEqual({ coreVersions: { xray: null } })
  })

  it('core versions: a server without the field gets no key', () => {
    const draft = draftOfNode(node)
    expect(nodeUpdateBody(draft, { ...draft, coreVersions: { xray: '26.3.27' } }, node)).toEqual({})
  })

  it('refuses at the field', () => {
    const draft = draftOfNode(node)
    expect(draftErrors(draft)).toEqual({})
    expect(draftErrors({ ...draft, name: ' ', port: '70000', domain: 'https://x', multiplier: 'x', maxUsers: '-1' })).toEqual({ name: true, port: true, domain: true, multiplier: true, maxUsers: true })
  })

  it('tells a change of host from a change of port', () => {
    expect(hostChanged({ host: 'a' }, { host: 'a ' })).toBe(false)
    expect(hostChanged({ host: 'a' }, { host: 'b' })).toBe(true)
  })
})
