import { narrowingFact, squadReach, type Squad } from '@/lib/domain/squads'

/**
 * Adding a user to a squad with no rows lifts the narrowing of their other squads
 * (subscription.service.ts:755): gates B2, asked with its cost before the save.
 */
export function widenedBy(before: readonly string[], after: readonly string[], squads: readonly Squad[]): { empty: Squad; narrowed: Squad[] } | null {
  const added = after.filter((id) => !before.includes(id))
  const empty = squads.find((s) => added.includes(s.id) && squadReach(s) === 'empty')
  const narrowed = narrowingFact(after, squads).narrowed
  return empty && narrowed.length > 0 ? { empty, narrowed } : null
}
