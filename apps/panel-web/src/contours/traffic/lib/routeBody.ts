import { toPolicyInput, type RoutePolicy, type RoutePolicyInput, type RouteRule } from '@/lib/old/routePolicies'
import { toRuleInput, type NodePolicy, type NodePolicyInput, type PolicyRule } from '@/lib/old/nodePolicies'
import { NEW_POLICY_ID, policySets, strip } from '@/contours/traffic/lib/routeRules'

export const isEmptyPolicy = (rules: readonly Pick<RouteRule, 'match'>[]) => rules.every((r) => r.match.filter(Boolean).length === 0)

/**
 * What a save of a route policy sends: only what changed against what it was opened with, and null
 * for nothing. F-10: an empty policy is closed here, the server part of it is Bk, the form holds it.
 */
export function routePolicyBody(policy: RoutePolicy, name: string, rules: readonly RouteRule[]): Partial<RoutePolicyInput> | null {
  const typed = name.trim()
  if (typed === '' || isEmptyPolicy(rules)) return null
  const input = toPolicyInput(typed, strip([...rules]))
  if (policy.id === NEW_POLICY_ID) return input
  const sets = policySets([...rules])
  const stored = { block: [...new Set(policy.blockDomains)].sort(), direct: [...new Set(policy.directDomains)].sort() }
  return {
    ...(typed !== policy.name ? { name: typed } : {}),
    ...(JSON.stringify(sets.block) !== JSON.stringify(stored.block) ? { blockDomains: input.blockDomains } : {}),
    ...(JSON.stringify(sets.direct) !== JSON.stringify(stored.direct) ? { directDomains: input.directDomains } : {}),
  }
}

export const NEW_NODE_POLICY_ID = 'draft'

/** The rules go whole or not at all: a policy is its order, and a partial list would delete the rest. */
export function nodePolicyBody(policy: NodePolicy, name: string, rules: readonly PolicyRule[]): Partial<NodePolicyInput> | null {
  const typed = name.trim()
  if (typed === '') return null
  const input = toRuleInput([...rules])
  if (policy.id === NEW_NODE_POLICY_ID) return { name: typed, rules: input }
  return {
    ...(typed !== policy.name ? { name: typed } : {}),
    ...(JSON.stringify(input) !== JSON.stringify(toRuleInput(policy.rules)) ? { rules: input } : {}),
  }
}

export const isUntouched = (body: object | null) => body !== null && Object.keys(body).length === 0
