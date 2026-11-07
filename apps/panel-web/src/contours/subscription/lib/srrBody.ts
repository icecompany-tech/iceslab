import { isCatchAll } from '@/contours/subscription/lib/srrMatch'
import { srrTemplatePatch } from '@/contours/subscription/lib/srrTemplate'
import type { CreateSrrInput, SrrRule, SubscriptionFormat, UpdateSrrInput } from '@/lib/old/srr'

export interface RuleDraft {
  name: string
  uaPattern: string
  priority: string
  format: SubscriptionFormat
  enabled: boolean
  templateName: string | null
}

const STEP = 10
const FIRST = 100
const MAX_PRIORITY = 10_000

/** A new rule lands after the others but ahead of a catch-all, which would make it unreachable. */
export function nextPriority(rules: readonly Pick<SrrRule, 'priority' | 'uaPattern'>[]): number {
  const catchAlls = rules.filter((r) => isCatchAll(r.uaPattern)).map((r) => r.priority)
  const others = rules.filter((r) => !isCatchAll(r.uaPattern)).map((r) => r.priority)
  const next = others.length > 0 ? Math.max(...others) + STEP : FIRST
  const ceiling = catchAlls.length > 0 ? Math.min(...catchAlls) : Infinity
  return next < ceiling ? next : Math.max(0, ceiling - 1)
}

export function draftOfRule(rule: SrrRule | null, rules: readonly SrrRule[]): RuleDraft {
  if (!rule) return { name: '', uaPattern: '', priority: String(nextPriority(rules)), format: 'plain', enabled: true, templateName: null }
  return { name: rule.name, uaPattern: rule.uaPattern, priority: String(rule.priority), format: rule.format, enabled: rule.enabled, templateName: rule.templateName ?? null }
}

export function priorityValid(text: string): boolean {
  const value = text.trim()
  return /^\d+$/.test(value) && Number(value) <= MAX_PRIORITY
}

export function ruleCreateBody(draft: RuleDraft): CreateSrrInput {
  return { name: draft.name.trim(), uaPattern: draft.uaPattern, format: draft.format, priority: Number(draft.priority.trim()), enabled: draft.enabled, ...srrTemplatePatch(undefined, draft.templateName, true) }
}

/** Only what changed (F-K3); a server older than the template field never gets the key. */
export function ruleUpdateBody(rule: SrrRule, draft: RuleDraft): UpdateSrrInput {
  const priority = Number(draft.priority.trim())
  return {
    ...(draft.name.trim() !== rule.name ? { name: draft.name.trim() } : {}),
    ...(draft.uaPattern !== rule.uaPattern ? { uaPattern: draft.uaPattern } : {}),
    ...(draft.format !== rule.format ? { format: draft.format } : {}),
    ...(priority !== rule.priority ? { priority } : {}),
    ...(draft.enabled !== rule.enabled ? { enabled: draft.enabled } : {}),
    ...srrTemplatePatch(rule.templateName, draft.templateName, false),
  }
}

export type FallsTo = { kind: 'catchAll'; name: string; format: SubscriptionFormat } | { kind: 'endpointDefault' }

/** Where the clients of a deleted rule land at the end of the walk: the window names it (F-K6). */
export function fallsTo(rules: readonly SrrRule[], gone: SrrRule): FallsTo {
  const last = rules.filter((r) => r.id !== gone.id && r.enabled && isCatchAll(r.uaPattern)).sort((a, b) => a.priority - b.priority)[0]
  return last ? { kind: 'catchAll', name: last.name, format: last.format } : { kind: 'endpointDefault' }
}
