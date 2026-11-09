// A user who does not exist yet has no id to ask the server about, so the configs are guessed from
// squads, profiles, bindings and hosts. The window says it is a guess, never a fact.

export interface EstimateInput {
  picked: readonly string[]
  squads: readonly { id: string; profileIds: readonly string[]; hostIds: readonly string[] }[]
  profiles: readonly { id: string; protocol: string }[]
  bindings: readonly { id: string; profileId: string; nodeId: string; port: number; enabled: boolean }[]
  hosts: readonly { id: string; bindingId: string }[]
  nodes: ReadonlyMap<string, { name: string; countryCode: string | null }>
}

export interface EstimateRow {
  key: string
  nodeId: string
  nodeName: string
  countryCode: string | null
  protocol: string
  port: number
}

/**
 * A squad with hosts narrows all of its profiles to them (old server, squads.prisma:21-27); one
 * without hosts hands out every binding of its profiles. The user gets the union of their squads.
 */
export function estimateConfigs(input: EstimateInput): EstimateRow[] {
  const protocolOf = new Map(input.profiles.map((p) => [p.id, p.protocol]))
  const hostsOf = new Map<string, string[]>()
  for (const host of input.hosts) hostsOf.set(host.bindingId, [...(hostsOf.get(host.bindingId) ?? []), host.id])
  const allowed = new Set<string>()
  for (const squad of input.squads.filter((s) => input.picked.includes(s.id))) {
    const narrowed = new Set(squad.hostIds)
    for (const binding of input.bindings) {
      if (!binding.enabled || !squad.profileIds.includes(binding.profileId)) continue
      if (narrowed.size > 0 && !(hostsOf.get(binding.id) ?? []).some((id) => narrowed.has(id))) continue
      allowed.add(binding.id)
    }
  }
  return input.bindings
    .filter((b) => allowed.has(b.id))
    .flatMap((b) => {
      const node = input.nodes.get(b.nodeId)
      const protocol = protocolOf.get(b.profileId)
      return node && protocol ? [{ key: b.id, nodeId: b.nodeId, nodeName: node.name, countryCode: node.countryCode, protocol, port: b.port }] : []
    })
}

const DAY_MS = 86_400_000

/** The term of a preset in days, from the date the form holds now; no term stays no term. */
export function presetDays(noExpiry: boolean, expireAt: string | null, now: number): number | null {
  if (noExpiry || expireAt === null) return null
  const at = new Date(expireAt).getTime()
  return Number.isFinite(at) ? Math.max(1, Math.round((at - now) / DAY_MS)) : null
}
