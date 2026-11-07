import { describe, expect, it } from 'vitest'
import { cascadeCreateBody, cascadeUpdateBody, isUntouched } from '@/contours/cascades/lib/cascadeBody'
import { appendPosition, movePosition, withUnderlay } from '@/contours/cascades/lib/cascadeForm'
import { draftOfCascade, newDraft, type CascadeDraft } from '@/contours/cascades/lib/draft'
import type { Cascade } from '@/lib/old/cascades'

const cascade = (over: Partial<Cascade> = {}): Cascade => ({
  id: 'c1',
  name: 'a4-test',
  enabled: true,
  mode: 'chain',
  hideHopsFromSub: true,
  autoProfile: false,
  hops: [],
  positions: [
    { position: 0, nodeIds: ['a'], entryProtocol: 'xray', linkProtocol: 'hy2', linkParams: { underlay: 'awg' } },
    { position: 1, nodeIds: ['b'], entryProtocol: null, linkProtocol: 'vless', linkParams: null },
  ],
  directions: [{ id: 'd1', tag: 1, countryCode: 'DE', nodeIds: ['c'], outboundId: null, linkProtocol: null, linkParams: null, linkPort: 24002 }],
  nextDirectionTag: 2,
  entryPolicy: null,
  createdAt: '',
  updatedAt: '',
  ...over,
})

const stored = () => draftOfCascade(cascade(), new Map(), true)
const edit = (over: Partial<CascadeDraft>) => ({ ...stored(), ...over })

describe('cascadeUpdateBody', () => {
  it('untouched form sends nothing, the entry policy and the consent included', () => {
    const body = cascadeUpdateBody(stored(), stored())
    expect(body).toEqual({})
    expect(isUntouched(body)).toBe(true)
  })

  it('a rename sends the name and no path, so a rename never hits the path gates', () => {
    expect(cascadeUpdateBody(stored(), edit({ name: ' a5 ' }))).toEqual({ name: 'a5' })
  })

  it('a switch sends only itself', () => {
    expect(cascadeUpdateBody(stored(), edit({ enabled: false }))).toEqual({ enabled: false })
    expect(cascadeUpdateBody(stored(), edit({ hideHops: false }))).toEqual({ hideHopsFromSub: false })
    expect(cascadeUpdateBody(stored(), edit({ autoProfile: true }))).toEqual({ autoProfile: true })
  })

  it('a pool edit sends positions and directions together, the id keeps the tag and no tag or port goes back', () => {
    const before = stored()
    const body = cascadeUpdateBody(before, { ...before, pools: before.pools.map((p, i) => (i === 1 ? { ...p, nodeIds: ['b', 'e'] } : p)) })
    expect(body.positions?.[1]?.nodeIds).toEqual(['b', 'e'])
    expect(body.directions).toEqual([{ id: 'd1', countryCode: 'DE', nodeIds: ['c'] }])
    expect(JSON.stringify(body)).not.toMatch(/"tag"|linkPort/)
  })

  it('a leg nobody touched stays absent, the touched one carries its whole params', () => {
    const before = stored()
    const body = cascadeUpdateBody(before, { ...before, pools: before.pools.map((p, i) => (i === 1 ? { ...p, linkParams: withUnderlay(p.linkParams, 'awg'), linkTouched: true } : p)) })
    expect(body.positions?.[0]).not.toHaveProperty('linkParams')
    expect(body.positions?.[1]?.linkParams).toEqual({ underlay: 'awg' })
  })

  it('a moved position sends its own leg, the server would hand it to the neighbour by number', () => {
    const before = cascade({ positions: [...cascade().positions, { position: 2, nodeIds: ['f'], entryProtocol: null, linkProtocol: 'vless', linkParams: { underlay: 'awg' } }] })
    const draft = draftOfCascade(before, new Map(), true)
    const body = cascadeUpdateBody(draft, { ...draft, pools: movePosition(draft.pools, 1, 1) })
    expect(body.positions?.[1]).toMatchObject({ nodeIds: ['f'], linkParams: { underlay: 'awg' } })
    expect(body.positions?.[2]).toMatchObject({ nodeIds: ['b'], linkParams: null })
  })

  it('a new transit says "nothing" for its leg out loud', () => {
    const draft = stored()
    const body = cascadeUpdateBody(draft, { ...draft, pools: appendPosition(draft.pools, 9).map((p) => (p.key === 9 ? { ...p, nodeIds: ['g'] } : p)) })
    expect(body.positions?.[2]).toMatchObject({ nodeIds: ['g'], linkParams: null })
  })

  it('the consent lives on one request and only when asked', () => {
    expect(cascadeUpdateBody(stored(), edit({ name: 'x' }), true)).toEqual({ name: 'x', confirmEntryChange: true })
  })

  it('the entry policy goes only when changed, null clears', () => {
    const on = draftOfCascade(cascade({ entryPolicy: { id: 'p', name: 'n', ordinal: 1 } }), new Map(), true)
    expect(cascadeUpdateBody(on, on)).toEqual({})
    expect(cascadeUpdateBody(on, { ...on, entryPolicyId: null })).toEqual({ entryPolicyId: null })
  })

  it('a server without the field never gets the key', () => {
    const old = draftOfCascade(cascade({ entryPolicy: undefined }), new Map(), false)
    expect(old.entryPolicyId).toBeUndefined()
    expect(cascadeUpdateBody(old, { ...old, name: 'x' })).toEqual({ name: 'x' })
  })

  it('an unsaved hops cascade stays hops until a path edit moves it', () => {
    const legacy = cascade({ positions: [], directions: [], mode: 'balancer', hops: [{ id: 'h0', nodeId: 'a', nodeName: 'a', position: 0, entryProtocol: 'xray', linkProtocol: 'xray' }, { id: 'h1', nodeId: 'c', nodeName: 'c', position: 1, entryProtocol: null, linkProtocol: null }] })
    const draft = draftOfCascade(legacy, new Map([['c', { countryCode: 'DE' }]]), true)
    expect(cascadeUpdateBody(draft, { ...draft, name: 'x' })).toEqual({ name: 'x' })
    expect(draft.directions[0]).toMatchObject({ id: null, countryCode: 'DE', nodeIds: ['c'] })
  })
})

describe('cascadeCreateBody', () => {
  it('a policy goes only where it acts, xray entries pick their own', () => {
    const draft: CascadeDraft = { ...newDraft(true), name: 'n', entryPolicyId: 'p' }
    expect(cascadeCreateBody(draft)).not.toHaveProperty('entryPolicyId')
    expect(cascadeCreateBody({ ...draft, pools: draft.pools.map((p) => ({ ...p, entryProtocol: 'hysteria' as const })) }).entryPolicyId).toBe('p')
  })

  it('nodes picked out of order come back without the empty rows', () => {
    const draft = newDraft(true)
    const body = cascadeCreateBody({ ...draft, name: 'n', pools: draft.pools.map((p) => ({ ...p, nodeIds: ['', 'a'] })), directions: draft.directions.map((d) => ({ ...d, countryCode: 'DE', nodeIds: ['b', ''] })) })
    expect(body.positions[0]?.nodeIds).toEqual(['a'])
    expect(body.directions[0]?.nodeIds).toEqual(['b'])
  })
})
