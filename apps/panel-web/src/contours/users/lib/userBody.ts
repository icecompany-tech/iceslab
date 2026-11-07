// What a save sends. The old server takes the traffic limit in whole GB only: a fraction
// is 400, and `trafficLimitBytes` is silently ignored (checked live 2026-11-06, Bk-119). A limit
// stored in bytes that is not a whole GB stays as it is while the field is untouched (F-8).
import type { User } from '@/contours/users/lib/users'

const GiB = 1024 ** 3

export type LimitUnit = 'GB' | 'TB'

export interface UserDraft {
  status: 'active' | 'disabled'
  groupIds: string[]
  unlimited: boolean
  limitText: string
  limitUnit: LimitUnit
  strategy: string
  noExpiry: boolean
  expireAt: string | null
  email: string
  telegramId: string
  deviceLimit: string
  tag: string
  description: string
}

const decimal = (n: number) => String(Math.round(n * 1000) / 1000)

export function draftOfUser(user: User): UserDraft {
  return {
    status: user.status === 'disabled' ? 'disabled' : 'active',
    groupIds: user.groupIds,
    unlimited: user.trafficLimitBytes === null,
    limitText: user.trafficLimitBytes === null ? '' : decimal(user.trafficLimitBytes / GiB),
    limitUnit: 'GB',
    strategy: user.trafficLimitStrategy,
    noExpiry: user.expireAt === null,
    expireAt: user.expireAt,
    email: user.email ?? '',
    telegramId: user.telegramId ?? '',
    deviceLimit: user.hwidDeviceLimit === null ? '' : String(user.hwidDeviceLimit),
    tag: user.tag ?? '',
    description: user.description ?? '',
  }
}

/** Whole GB from what was typed, or null: the field refuses and nothing is sent. */
export function limitToGb(text: string, unit: LimitUnit): number | null {
  const n = Number(text.trim().replace(',', '.'))
  if (text.trim() === '' || !Number.isFinite(n) || n <= 0) return null
  const gb = unit === 'TB' ? n * 1024 : n
  return Number.isInteger(gb) ? gb : null
}

export function limitError(draft: Pick<UserDraft, 'unlimited' | 'limitText' | 'limitUnit'>, touched: boolean, bad: string): string | undefined {
  if (draft.unlimited || !touched) return undefined
  return limitToGb(draft.limitText, draft.limitUnit) === null ? bad : undefined
}

export const deviceLimitValid = (text: string) => text.trim() === '' || /^\d+$/.test(text.trim())

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))
const textOrNull = (s: string) => (s.trim() === '' ? null : s.trim())
const limitTouched = (a: UserDraft, b: UserDraft) => a.unlimited !== b.unlimited || a.limitText !== b.limitText || a.limitUnit !== b.limitUnit

export interface UserBodyFields {
  status?: 'active' | 'disabled'
  groupIds?: string[]
  trafficLimitGb?: number | null
  trafficLimitStrategy?: string
  expireAt?: string | null
  email?: string | null
  telegramId?: string | null
  hwidDeviceLimit?: number | null
  tag?: string | null
  description?: string | null
}

/** Only what changed: an untouched form gives {} and is not sent (F-K3). */
export function updateBody(initial: UserDraft, draft: UserDraft): UserBodyFields {
  const body: UserBodyFields = {}
  if (draft.status !== initial.status) body.status = draft.status
  if (!sameSet(draft.groupIds, initial.groupIds)) body.groupIds = draft.groupIds
  if (limitTouched(initial, draft)) {
    if (draft.unlimited) body.trafficLimitGb = null
    else {
      const gb = limitToGb(draft.limitText, draft.limitUnit)
      if (gb !== null) body.trafficLimitGb = gb
    }
  }
  if (draft.strategy !== initial.strategy) body.trafficLimitStrategy = draft.strategy
  const expireAt = draft.noExpiry ? null : draft.expireAt
  if (expireAt !== (initial.noExpiry ? null : initial.expireAt)) body.expireAt = expireAt
  if (draft.email !== initial.email) body.email = textOrNull(draft.email)
  if (draft.telegramId !== initial.telegramId) body.telegramId = textOrNull(draft.telegramId)
  if (draft.deviceLimit !== initial.deviceLimit) body.hwidDeviceLimit = draft.deviceLimit.trim() === '' ? null : Number(draft.deviceLimit)
  if (draft.tag !== initial.tag) body.tag = textOrNull(draft.tag)
  if (draft.description !== initial.description) body.description = textOrNull(draft.description)
  return body
}

export interface NewUserFields {
  username: string
  subscriptionToken?: string
}

export function createBody(fields: NewUserFields, draft: UserDraft) {
  const token = fields.subscriptionToken?.trim()
  return {
    username: fields.username.trim(),
    ...(token ? { subscriptionToken: token } : {}),
    groupIds: draft.groupIds,
    trafficLimitGb: draft.unlimited ? null : limitToGb(draft.limitText, draft.limitUnit),
    trafficLimitStrategy: draft.strategy,
    expireAt: draft.noExpiry ? null : draft.expireAt,
    email: textOrNull(draft.email),
    telegramId: textOrNull(draft.telegramId),
    hwidDeviceLimit: draft.deviceLimit.trim() === '' ? null : Number(draft.deviceLimit),
    tag: textOrNull(draft.tag),
    description: textOrNull(draft.description),
  }
}
