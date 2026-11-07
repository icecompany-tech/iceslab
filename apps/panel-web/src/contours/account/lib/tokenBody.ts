/**
 * What the server grants on the old API: by section, read or write, plus `sub:read` and an
 * explicit `*` (scope.hook.ts). Request-level scopes wait for S3 (Bk-154), and the tree test
 * holds this list against the server's.
 */
export const RESOURCES = ['users', 'nodes', 'profiles', 'bindings', 'hosts', 'squads', 'srr', 'regions', 'cascades', 'hwid-devices', 'settings', 'recipes', 'dashboard', 'system', 'route-policies', 'node-policies', 'named-outbounds', 'geo-sets', 'routing-presets', 'subscription-templates'] as const

export const SUB_READ = 'sub:read'
export const FULL = '*'

export type TokenSet = 'bot' | 'full' | 'manual'

export const BOT_SCOPES: readonly string[] = ['users:read', 'users:write', SUB_READ, 'squads:read']

export interface TokenDraft {
  name: string
  set: TokenSet
  picked: readonly string[]
}

export function scopesOf(draft: Pick<TokenDraft, 'set' | 'picked'>): readonly string[] {
  switch (draft.set) {
    case 'full':
      return [FULL]
    case 'bot':
      return BOT_SCOPES
    case 'manual':
      return draft.picked
  }
}

/**
 * Null closes the button. An empty list is a full admin on the server (scope.hook.ts:111,
 * Б3), so no path here may ever send one: full access only by an explicit `*`.
 */
export function tokenBody(draft: TokenDraft): { name: string; scopes: string[] } | null {
  const name = draft.name.trim()
  const scopes = scopesOf(draft)
  if (name === '' || scopes.length === 0) return null
  return { name, scopes: [...scopes] }
}

export function togglePicked(picked: readonly string[], scope: string, on: boolean): string[] {
  const rest = picked.filter((s) => s !== scope)
  return on ? [...rest, scope] : rest
}

/** Empty is a legacy full token, as the server reads it. */
export const isFullToken = (scopes: readonly string[]) => scopes.length === 0 || scopes.includes(FULL)
