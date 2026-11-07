// GET /api/users and the answers about one user.
import { arr, bool, maybe, nullable, num, obj, optional, str } from '@/lib/net/parse'

export const parseUser = obj({
  id: str,
  shortId: str,
  username: str,
  status: str,
  expireAt: nullable(str),
  trafficLimitBytes: nullable(num),
  trafficUsedBytes: num,
  lifetimeTrafficBytes: num,
  trafficLimitStrategy: str,
  lastTrafficResetAt: nullable(str),
  lastOnlineAt: nullable(str),
  firstConnectedAt: nullable(str),
  lastConnectedNodeId: nullable(str),
  lastConnectedNodeName: nullable(str),
  subscriptionToken: str,
  subRevokedAt: nullable(str),
  hwidDeviceLimit: nullable(num),
  routingPreset: maybe(nullable(str)),
  customRoutingPresetId: maybe(nullable(str)),
  description: nullable(str),
  tag: nullable(str),
  telegramId: nullable(str),
  email: nullable(str),
  groupIds: arr(str),
  createdAt: str,
})

export type User = ReturnType<typeof parseUser>

export const parseUsersPage = obj({ users: arr(parseUser), total: num })

const parsePreset = obj({ id: str, name: str, builtIn: bool })

export const parseDelivery = obj({
  routing: optional(
    obj({
      effectivePreset: maybe(parsePreset),
      userPreset: maybe(nullable(parsePreset)),
      squadPreset: maybe(nullable(parsePreset)),
      squadConflict: maybe(bool),
    }),
  ),
})

export type DeliveryRouting = NonNullable<ReturnType<typeof parseDelivery>['routing']>

export const parseEndpoints = obj({ endpoints: arr(obj({ protocol: str, label: str, nodeId: str, host: str, port: num, uri: str })) })

export type UserEndpoint = ReturnType<typeof parseEndpoints>['endpoints'][number]

export const parseDevices = obj({ devices: arr(obj({ id: str, hwid: str, label: nullable(str), firstSeenAt: str, lastSeenAt: str })) })

export type HwidDevice = ReturnType<typeof parseDevices>['devices'][number]

export const parseBulkReport = obj({
  requested: num,
  succeeded: num,
  ok: arr(str),
  failed: arr(obj({ userId: str, error: optional(str) })),
})

export type BulkReport = ReturnType<typeof parseBulkReport>

export type UserStatusWord = 'active' | 'expired' | 'limited' | 'disabled' | 'unknown'

export function statusWord(status: string): UserStatusWord {
  return status === 'active' || status === 'expired' || status === 'limited' || status === 'disabled' ? status : 'unknown'
}

/** As the server lands a user on a save: `statusAfterEdit`, users.service.ts:429-442. */
export function accessOutcome(choice: 'active' | 'disabled', facts: { expireAt: string | null; limitBytes: number | null; usedBytes: number }, now: number): 'active' | 'disabled' | 'expired' | 'limited' {
  if (choice === 'disabled') return 'disabled'
  if (facts.expireAt && Date.parse(facts.expireAt) < now) return 'expired'
  if (facts.limitBytes !== null && facts.usedBytes >= facts.limitBytes) return 'limited'
  return 'active'
}

/** A subscription link from what /api/auth/status says, or null: no link is better than a wrong one. */
export function subscriptionUrl(token: string, panel: { publicUrl?: string | null; subscriptionPathPrefix?: string | null } | undefined): string | null {
  const origin = panel?.publicUrl ?? ''
  const prefix = panel?.subscriptionPathPrefix ?? ''
  if (!/^https?:\/\/[^/]/.test(origin) || !prefix.startsWith('/')) return null
  return `${origin}${prefix}/${token}`
}

/** `url` with `protocols` first, as the server writes the same link. */
export function withProtocol(url: string, protocol: string | null): string {
  return protocol === null ? url : `${url}?protocols=${protocol}`
}
