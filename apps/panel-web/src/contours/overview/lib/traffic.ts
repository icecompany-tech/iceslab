/** The change against the previous period, or null when there is nothing to compare with. */
export function changePercent(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null
}

export const sumHourly = (hours: readonly { bytes: number }[]) => hours.reduce((sum, h) => sum + h.bytes, 0)

/** Problems first, then not verified, then the rest by today's traffic. */
export function byAttention<T extends { name: string; todayBytes: number; health: string }>(rows: readonly T[]): T[] {
  const rank = (health: string) => (health === 'problem' ? 0 : health === 'unverified' ? 1 : health === 'ok' ? 2 : 3)
  return [...rows].sort((a, b) => rank(a.health) - rank(b.health) || b.todayBytes - a.todayBytes || a.name.localeCompare(b.name))
}

/** The certificate colour of the frame: amber within a fortnight, red past its end. */
export function certTone(days: number): 'expired' | 'soon' | 'fine' {
  if (days < 0) return 'expired'
  return days <= 14 ? 'soon' : 'fine'
}
