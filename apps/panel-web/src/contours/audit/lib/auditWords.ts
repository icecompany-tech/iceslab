import { ADMIN_AUDIT_ACTIONS, type AdminAuditAction, type AdminAuditEventDto } from '@iceslab/shared'
import type { DICT } from '@/contours/audit/dict'

type Words = typeof DICT.ru

/** The groups the filter offers, in contract order: the first segment of an action, sent as the prefix 'cascade.'. */
export const ACTION_GROUPS: readonly string[] = [...new Set(ADMIN_AUDIT_ACTIONS.map((a) => a.split('.')[0] ?? a))]

const GROUP_PREFIX = 'group:'
const MS_IN_DAY = 86_400_000

export const groupValue = (group: string) => `${GROUP_PREFIX}${group}`

/** The filter's value: '' (all), 'group:<g>' or an action; anything else sends nothing. */
export function actionFilterParam(value: string): string | undefined {
  if (!value) return undefined
  if (value.startsWith(GROUP_PREFIX)) return `${value.slice(GROUP_PREFIX.length)}.`
  return (ADMIN_AUDIT_ACTIONS as readonly string[]).includes(value) ? value : undefined
}

export function periodFrom(days: number | null, now: number): string | undefined {
  return days === null ? undefined : new Date(now - days * MS_IN_DAY).toISOString()
}

const TOKEN_PREFIX = 'api token: '
const UNKNOWN_ACCOUNT = 'unknown account'
const PANEL_SETTINGS = 'panel settings'

/** F-1: synthetic names in the panel's words, old rows read the same as new ones. */
export function actorWords(e: Pick<AdminAuditEventDto, 'actor'>, words: Words): string {
  switch (e.actor.kind) {
    case 'anonymous':
      return words.anonymous
    case 'system':
      return e.actor.label || words.system
    case 'api_token': {
      const label = e.actor.label ?? ''
      return words.tokenActor(label.startsWith(TOKEN_PREFIX) ? label.slice(TOKEN_PREFIX.length) : label)
    }
    case 'admin':
      return e.actor.label ?? ''
  }
}

export const actionWords = (action: string, words: Words) => words.action[action] ?? action

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const detailOf = (e: Partial<Pick<AdminAuditEventDto, 'detail'>>) => (e.detail && typeof e.detail === 'object' ? (e.detail as Record<string, unknown>) : null)

export function targetWords(e: Pick<AdminAuditEventDto, 'target'> & Partial<Pick<AdminAuditEventDto, 'action' | 'detail'>>, words: Words): string {
  const d = detailOf(e)
  const label = e.target.label ?? ''
  if (e.action === 'users.bulk') {
    const fromLabel = /^(\d+) users$/.exec(label)?.[1]
    const count = num(d?.requested) ?? (fromLabel ? Number(fromLabel) : null)
    if (count !== null) return words.usersCount(count)
  }
  if (e.action === 'auth.login' && num(d?.suppressed) !== null) return label ? words.loginSummaryNetwork(label) : words.loginSummaryAll
  if (e.target.kind === 'settings') return words.panelSettings
  if (e.target.kind === 'admin' && (label === '' || label === UNKNOWN_ACCOUNT)) return words.unknownAccount
  const kind = words.target[e.target.kind] ?? e.target.kind
  const name = label.startsWith(TOKEN_PREFIX) ? label.slice(TOKEN_PREFIX.length) : label === PANEL_SETTINGS ? words.panelSettings : label
  return name ? `${kind} ${name}` : kind
}

export function outcomeWords(e: Pick<AdminAuditEventDto, 'outcome' | 'refusal'>, words: Words): string {
  switch (e.outcome) {
    case 'refused':
      return e.refusal ? words.outcomeRefusedCode(e.refusal) : words.outcomeRefused
    case 'failed':
      return words.outcomeFailed
    case 'ok':
      return words.outcomeOk
  }
}

/** A sign-in refusal summary: the row carries why it is one row. */
export const isLoginSummary = (e: Pick<AdminAuditEventDto, 'action' | 'detail'>) => e.action === 'auth.login' && num(detailOf(e)?.suppressed) !== null

/**
 * The lines of an opened row, by the action's own fields, then the network. Read field by
 * field and checked: a row by an older server says less, never something wrong.
 */
export function detailLines(e: AdminAuditEventDto, words: Words, date: (iso: string) => string): string[] {
  const d = detailOf(e)
  const out: string[] = []
  const day = (v: unknown) => {
    if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return null
    return date(v)
  }
  if (d) {
    switch (e.action as AdminAuditAction) {
      case 'auth.login': {
        const suppressed = num(d.suppressed)
        if (suppressed !== null) out.push(words.loginSuppressed(suppressed, day(d.windowStart) ?? '?'))
        else {
          if (d.twoFactor === true) out.push(words.loginTwoFactor)
          if (d.locked === true) out.push(words.loginLocked)
        }
        break
      }
      case 'apiToken.create':
      case 'apiToken.revoke': {
        const scopes = strs(d.scopes)
        if (scopes.length > 0) out.push(words.scopes(scopes.includes('*') ? words.scopesAll : scopes.join(', ')))
        break
      }
      case 'settings.update': {
        const changed = strs(d.changed)
        if (changed.length > 0) out.push(words.settingsChanged(changed.join(', ')))
        break
      }
      case 'users.bulk': {
        if (typeof d.action === 'string') out.push(words.bulkAction(words.bulk[d.action] ?? d.action))
        const requested = num(d.requested)
        const succeeded = num(d.succeeded)
        const failed = num(d.failed)
        if (requested !== null && succeeded !== null && failed !== null) out.push(words.bulkCounts(requested, succeeded, failed))
        const days = num(d.expireDays)
        if (days !== null) out.push(words.bulkDays(days))
        out.push(words.bulkUsers(strs(d.userIds).length))
        break
      }
      case 'user.delete': {
        const after = day(d.erasedAfter)
        if (after) out.push(words.erasedAfter(after))
        break
      }
      case 'node.connLog.clear': {
        const parts = Array.isArray(d.outcome)
          ? d.outcome.flatMap((o: unknown) => {
              const r = o && typeof o === 'object' ? (o as Record<string, unknown>) : {}
              return typeof r.source === 'string' && typeof r.state === 'string' ? [`${r.source}: ${words.connLog[r.state] ?? r.state}`] : []
            })
          : []
        if (parts.length > 0) out.push(parts.join(', '))
        break
      }
      case 'node.cert.rotate': {
        const until = day(d.notAfter)
        if (until) out.push(words.certUntil(until))
        break
      }
      case 'cascade.create':
      case 'cascade.update':
      case 'cascade.delete':
      case 'cascade.enable':
      case 'cascade.disable': {
        const directions = num(d.directions)
        const nodes = num(d.nodes)
        if (directions !== null && nodes !== null) out.push(words.cascadeShape(directions, nodes))
        break
      }
      case 'nodePolicy.create':
      case 'nodePolicy.update':
      case 'nodePolicy.delete': {
        const rules = num(d.rules)
        const nodes = num(d.nodes)
        if (rules !== null && nodes !== null) out.push(words.policyShape(rules, nodes))
        break
      }
      case 'nodePolicy.attach':
      case 'nodePolicy.detach':
        if (typeof d.policyLabel === 'string' && d.policyLabel) out.push(words.policy(d.policyLabel))
        break
      case 'admin.register':
      case 'admin.password.change':
      case 'admin.2fa.enable':
      case 'admin.2fa.disable':
      case 'user.credentials.reissue':
        break
    }
  }
  if (e.sourceNetwork) out.push(words.network(e.sourceNetwork))
  return out
}
