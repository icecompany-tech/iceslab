const UNKNOWN_CLIENTS: readonly string[] = ['Other', 'Unknown']

/** The server's two names for a client it could not read. */
export function unknownClients(byClient: readonly { client: string; count: number }[]): number {
  return byClient.filter((c) => UNKNOWN_CLIENTS.includes(c.client)).reduce((sum, c) => sum + c.count, 0)
}

/** How hard one account polls; null when nobody fetched, a division by zero would read as a number. */
export function perUserPerDay(total: number, users: number, days: number): number | null {
  return users > 0 && days > 0 ? total / users / days : null
}

const PERCENT = 100

export const shareOf = (value: number, max: number) => (max > 0 ? (value / max) * PERCENT : 0)
