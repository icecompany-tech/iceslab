import { describe, expect, it } from 'vitest'
import { createBody, deviceLimitValid, draftOfUser, limitToGb, updateBody } from '@/contours/users/lib/userBody'
import type { User } from '@/contours/users/lib/users'

const MiB = 1024 ** 2
const GiB = 1024 ** 3

const user: User = {
  id: 'u',
  shortId: 's',
  username: 'kate',
  status: 'active',
  expireAt: '2026-12-01T12:00:00.000Z',
  trafficLimitBytes: 300 * MiB,
  trafficUsedBytes: 0,
  lifetimeTrafficBytes: 0,
  trafficLimitStrategy: 'month',
  lastTrafficResetAt: null,
  lastOnlineAt: null,
  firstConnectedAt: null,
  lastConnectedNodeId: null,
  lastConnectedNodeName: null,
  subscriptionToken: 't',
  subRevokedAt: null,
  hwidDeviceLimit: null,
  routingPreset: null,
  customRoutingPresetId: null,
  description: null,
  tag: 'vip',
  telegramId: null,
  email: null,
  groupIds: ['a', 'b'],
  createdAt: '2026-01-01T00:00:00Z',
}

describe('the body of a save', () => {
  it('an untouched form sends nothing, the limit of 300 MB stays', () => {
    const draft = draftOfUser(user)
    expect(updateBody(draft, { ...draft })).toEqual({})
  })

  it('the same squads in another order are no change, a list that changed goes whole', () => {
    const draft = draftOfUser(user)
    expect(updateBody(draft, { ...draft, groupIds: ['b', 'a'] })).toEqual({})
    expect(updateBody(draft, { ...draft, groupIds: ['a'] })).toEqual({ groupIds: ['a'] })
  })

  it('editing the note does not touch the limit (F-8)', () => {
    const draft = draftOfUser(user)
    expect(updateBody(draft, { ...draft, description: 'x' })).toEqual({ description: 'x' })
  })

  it('a limit goes in whole GB, and a fraction is not sent', () => {
    const draft = draftOfUser(user)
    expect(updateBody(draft, { ...draft, limitText: '5' })).toEqual({ trafficLimitGb: 5 })
    expect(updateBody(draft, { ...draft, limitText: '1,5', limitUnit: 'TB' })).toEqual({ trafficLimitGb: 1536 })
    expect(updateBody(draft, { ...draft, limitText: '1,5' })).toEqual({})
    expect(updateBody(draft, { ...draft, unlimited: true })).toEqual({ trafficLimitGb: null })
  })

  it('reads the limit field', () => {
    expect(limitToGb('50', 'GB')).toBe(50)
    expect(limitToGb('0,5', 'TB')).toBe(512)
    for (const bad of ['', '0', '-1', 'x', '0.29']) expect(limitToGb(bad, 'GB')).toBeNull()
    expect(5 * GiB).toBeGreaterThan(0)
  })

  it('a term to the hour goes as it was set, no term as null, an empty text as null', () => {
    const draft = draftOfUser(user)
    expect(updateBody(draft, { ...draft, expireAt: '2026-12-01T17:00:00.000Z' })).toEqual({ expireAt: '2026-12-01T17:00:00.000Z' })
    expect(updateBody(draft, { ...draft, noExpiry: true })).toEqual({ expireAt: null })
    expect(updateBody(draft, { ...draft, tag: '  ' })).toEqual({ tag: null })
  })

  it('a device limit: empty is "as the squad", 0 is "no limit"', () => {
    const draft = draftOfUser(user)
    expect(updateBody(draft, { ...draft, deviceLimit: '0' })).toEqual({ hwidDeviceLimit: 0 })
    expect(deviceLimitValid('3')).toBe(true)
    expect(deviceLimitValid('a')).toBe(false)
  })

  it('a new user sends the term as a moment and a token only when given', () => {
    const draft = { ...draftOfUser(user), limitText: '50' }
    const body = createBody({ username: ' kate ' }, draft)
    expect(body.username).toBe('kate')
    expect(body.expireAt).toBe('2026-12-01T12:00:00.000Z')
    expect(body.trafficLimitGb).toBe(50)
    expect('subscriptionToken' in body).toBe(false)
    expect(createBody({ username: 'k', subscriptionToken: 'abc' }, draft).subscriptionToken).toBe('abc')
  })
})
