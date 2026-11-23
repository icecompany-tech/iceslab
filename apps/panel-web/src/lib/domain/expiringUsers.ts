/** Both the count and the linked roster use the same active-user window. */
export function expiringWeek(timestamp: number) {
  const start = Math.floor(timestamp / 3_600_000) * 3_600_000
  return { expiresAfter: new Date(start).toISOString(), expiresBefore: new Date(start + 7 * 86_400_000).toISOString() }
}
