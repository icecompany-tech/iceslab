const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export interface TermParts {
  days: number
  hours: number
}

/** What is left, whole days and hours. Past the end both are zero. */
export function termLeft(expireAt: string, now: number): TermParts {
  // To the nearest hour: seconds since the form opened must not turn 30 days into 29 and 23.
  const hoursLeft = Math.round(Math.max(Date.parse(expireAt) - now, 0) / HOUR_MS)
  return { days: Math.floor(hoursLeft / 24), hours: hoursLeft % 24 }
}

export const expireFromParts = (parts: TermParts, now: number) => new Date(now + parts.days * DAY_MS + parts.hours * HOUR_MS).toISOString()

/** From the current end, and an expired one from now: as the server counts, users.service.ts:476-481. */
export function extendFrom(expireAt: string, days: number, now: number): string {
  const end = Date.parse(expireAt)
  return new Date(Math.max(end, now) + days * DAY_MS).toISOString()
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)
