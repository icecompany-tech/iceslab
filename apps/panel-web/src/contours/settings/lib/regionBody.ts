/** Only what changed goes out: a code left alone is not resent, a rename does not touch it (F-K3). */
export function regionUpdateBody(stored: { name: string; code: string }, draft: { name: string; code: string }): { name?: string; code?: string } {
  const name = draft.name.trim()
  const code = draft.code.trim()
  return { ...(name !== stored.name ? { name } : {}), ...(code !== stored.code ? { code } : {}) }
}

/** A count the server did not send is unknown, not zero: «safe to delete» on no answer would be a claim. */
export function regionNodes(region: { nodeCount?: unknown }): number | null {
  const n = region.nodeCount
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null
}

/** Never the empty name: it used to save as the default over the operator's own. */
export function brandBody(stored: string, typed: string): { brandName: string } | null {
  const name = typed.trim()
  return name === '' || name === stored ? null : { brandName: name }
}
