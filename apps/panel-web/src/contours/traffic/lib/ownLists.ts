import { parseRules, splitLines } from '@/contours/traffic/lib/routeExchange'
import type { UpdateSettingsInput } from '@/lib/old/settings'

export type LineProblem = 'separator' | 'ext' | 'regexp' | 'prefix'

// The server answers 400 to these (A-103): an address or a CIDR is written bare.
const REFUSED_PREFIX = /^(ip|cidr):/i

/** What a rule row refuses before any request: a dead prefix, or a space inside one entry. */
export function refusedTokens(tokens: readonly string[]): string[] {
  return tokens.filter((t) => REFUSED_PREFIX.test(t) || /\s/.test(t))
}

/**
 * F-26: one line of an own list, before any request. A list is one matcher per line, a comma or a
 * space is two written as one. `ext:` is a panel geo set: the client has no such file.
 */
export function lineProblem(line: string): LineProblem | null {
  const value = line.trim()
  if (/[\s,]/.test(value)) return 'separator'
  if (REFUSED_PREFIX.test(value)) return 'prefix'
  if (value.startsWith('ext:') || value.startsWith('ext-ip:')) return 'ext'
  if (value.startsWith('regexp:')) {
    try {
      new RegExp(value.slice('regexp:'.length))
    } catch {
      return 'regexp'
    }
  }
  return null
}

export function listProblems(text: string): { line: string; problem: LineProblem }[] {
  return text.split('\n').flatMap((raw) => {
    const problem = raw.trim() === '' ? null : lineProblem(raw)
    return problem ? [{ line: raw.trim(), problem }] : []
  })
}

export interface OwnDraft {
  direct: string
  proxy: string
  block: string
  rules: string
}

export function draftOfOwn(settings: { subscriptionCustomDomainLists?: { direct?: string[]; proxy?: string[]; block?: string[] } | null; subscriptionCustomRoutingRules?: Record<string, unknown>[] | null }): OwnDraft {
  const lists = settings.subscriptionCustomDomainLists
  return {
    direct: (lists?.direct ?? []).join('\n'),
    proxy: (lists?.proxy ?? []).join('\n'),
    block: (lists?.block ?? []).join('\n'),
    rules: settings.subscriptionCustomRoutingRules ? JSON.stringify(settings.subscriptionCustomRoutingRules, null, 2) : '',
  }
}

/** Only the side that changed goes out: all three lists empty clears the setting, so a subscription stays byte for byte «no lists». */
export function ownBody(stored: OwnDraft, draft: OwnDraft): UpdateSettingsInput {
  const lists = (d: OwnDraft) => ({ direct: splitLines(d.direct), proxy: splitLines(d.proxy), block: splitLines(d.block) })
  const next = lists(draft)
  const listsChanged = JSON.stringify(next) !== JSON.stringify(lists(stored))
  const empty = next.direct.length + next.proxy.length + next.block.length === 0
  return {
    ...(listsChanged ? { subscriptionCustomDomainLists: empty ? null : next } : {}),
    ...(draft.rules.trim() !== stored.rules.trim() ? { subscriptionCustomRoutingRules: parseRules(draft.rules).rules } : {}),
  }
}
