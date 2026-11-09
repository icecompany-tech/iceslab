// F-15: the host's own address. The server takes these fields as they come (open by the decision
// of 02.11, Bk-46), so this screen is not to be the way in: it refuses at the field.
export type AddressProblem = 'newline' | 'space' | 'comma' | 'scheme' | 'url' | 'port'

export function addressProblem(text: string): AddressProblem | null {
  if (/[\r\n]/.test(text)) return 'newline'
  const value = text.trim()
  if (value === '') return null
  if (/\s/.test(value)) return 'space'
  if (value.includes(',')) return 'comma'
  if (value.includes('://')) return 'scheme'
  // A path, a query, a fragment or a user part would ride into the client link as part of the host (AUDT 10.11).
  if (/[/?#@]/.test(value)) return 'url'
  // One colon is a port; an IPv6 literal has several and no port unless it is bracketed.
  if (/^[^:]+:\d*$/.test(value) || /\]:\d*$/.test(value)) return 'port'
  return null
}
