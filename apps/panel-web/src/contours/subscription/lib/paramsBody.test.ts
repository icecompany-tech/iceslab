import { describe, expect, it } from 'vitest'
import { cleanDead, draftOfSettings, intervalValid, paramsBody, sampleBytes, supportUrlValid } from '@/contours/subscription/lib/paramsBody'
import type { AdminSettings } from '@/lib/old/settings'

const settings = (over: Partial<AdminSettings> = {}) => ({ brandName: 'Iceslab', subscriptionUpdateIntervalHours: 24, subscriptionRoutingPreset: 'proxy-all', subscriptionDefaultFormat: 'plain', subscriptionLinkShape: 'per-exit', subscriptionSupportUrl: 'https://t.me/x', ...over }) as AdminSettings

describe('paramsBody', () => {
  it('untouched form sends nothing, stored values come back as they are', () => {
    const draft = draftOfSettings(settings({ subscriptionDeadTexts: { expired: { ru: 'да' } } }))
    expect(paramsBody(draft, draft)).toEqual({})
  })

  it('a change sends only itself, an emptied field clears with null', () => {
    const stored = draftOfSettings(settings())
    expect(paramsBody(stored, { ...stored, profileTitle: ' Ice ' })).toEqual({ subscriptionProfileTitle: 'Ice' })
    expect(paramsBody(stored, { ...stored, supportUrl: '' })).toEqual({ subscriptionSupportUrl: null })
    expect(paramsBody(stored, { ...stored, interval: '12' })).toEqual({ subscriptionUpdateIntervalHours: 12 })
    expect(paramsBody(stored, { ...stored, publicHost: 'sub.example.com' })).toEqual({ subscriptionPublicHost: 'sub.example.com' })
  })

  it('whitespace is no edit', () => {
    const stored = draftOfSettings(settings())
    expect(paramsBody(stored, { ...stored, announce: '   ' })).toEqual({})
  })

  it('dead texts drop empty branches, all empty is null', () => {
    expect(cleanDead({ expired: { ru: ' ', en: 'x' }, limited: { ru: '' } })).toEqual({ expired: { en: 'x' } })
    expect(cleanDead({ expired: { ru: '' } })).toBeNull()
    const stored = draftOfSettings(settings({ subscriptionDeadTexts: { expired: { ru: 'да' } } }))
    expect(paramsBody(stored, { ...stored, dead: { expired: { ru: '' } } })).toEqual({ subscriptionDeadTexts: null })
  })
})

describe('field checks', () => {
  it('F-11: https, http and tg pass, javascript and data do not', () => {
    for (const ok of ['', 'https://t.me/x', 'http://a.example', 'tg://resolve?domain=x']) expect(supportUrlValid(ok)).toBe(true)
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://a', 'https://', 't.me/x']) expect(supportUrlValid(bad)).toBe(false)
  })

  it('the interval is whole hours inside the server range', () => {
    for (const ok of ['1', '24', '168']) expect(intervalValid(ok)).toBe(true)
    for (const bad of ['0', '169', '1.5', '', 'x']) expect(intervalValid(bad)).toBe(false)
  })

  it('the sample speaks the server units', () => {
    expect(sampleBytes(45_787_091_200)).toBe('43 GiB')
    expect(sampleBytes(-5)).toBe('0 B')
  })
})
