/** Both the count and the linked roster use the same active-user window. */
export function expiringWeek(timestamp: number) {
  return { expiresAfter: new Date(timestamp).toISOString(), expiresBefore: new Date(timestamp + 7 * 86_400_000).toISOString() }
}
