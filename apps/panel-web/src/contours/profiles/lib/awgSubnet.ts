// How many users a subnet holds, by the server's own rule (amneziawg.subnet.ts): network, the
// server's .1 and broadcast are reserved, the prefix goes from /8 to /30. No request is needed.
const CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/
const RESERVED = 3

export function subnetCapacity(cidr: string): number | null {
  const match = CIDR.exec(cidr.trim())
  if (!match) return null
  const octets = match.slice(1, 5).map(Number)
  const prefix = Number(match[5])
  if (octets.some((o) => o > 255) || prefix < 8 || prefix > 30) return null
  return 2 ** (32 - prefix) - RESERVED
}
