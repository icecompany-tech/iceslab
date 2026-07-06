import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Map an authenticated API-token request to the scope it requires. Returns null
 * when no scope grants this route, so a restricted token is denied by default
 * (least-privilege / fail-safe: a route nobody mapped is closed, not open).
 *
 * Convention: `<resource>:<verb>` where `resource` is the first path segment
 * after `/api/` and `verb` is `read` (GET/HEAD) or `write` (everything else).
 * Examples:
 *   GET    /api/users            -> users:read
 *   POST   /api/users            -> users:write
 *   PUT    /api/users/:id        -> users:write
 *   POST   /api/users/:id/revoke -> users:write
 *   GET    /api/nodes/:id        -> nodes:read
 * One special case: the per-user endpoints list reveals subscription config, so
 * it needs `sub:read` rather than `users:read`.
 */
export function requiredScopeFor(method: string, url: string | undefined): string | null {
  if (!url || !url.startsWith('/api/')) return null;
  if (url === '/api/users/:id/endpoints' && (method === 'GET' || method === 'HEAD')) {
    return 'sub:read';
  }
  const resource = url.slice('/api/'.length).split('/')[0];
  if (!resource) return null;
  const verb = method === 'GET' || method === 'HEAD' ? 'read' : 'write';
  return `${resource}:${verb}`;
}

/**
 * Resources a scoped API token can legitimately be granted, i.e. the first
 * path segment after `/api/` for every token-reachable route (see
 * requiredScopeFor). Kept in sync with the routes by hand. `api-tokens`,
 * `auth` and `internal` are omitted on purpose: tokens can never reach those
 * (blockApiTokenAccess / login / node-only), so granting them would be a
 * dead scope.
 */
const SCOPEABLE_RESOURCES = [
  'users',
  'nodes',
  'profiles',
  'bindings',
  'hosts',
  'squads',
  'srr',
  'regions',
  'inbounds',
  'cascades',
  'hwid-devices',
  'settings',
  'recipes',
  'dashboard',
  'system',
] as const;

/**
 * The set of scopes a token may carry: `*` (full), the special `sub:read`
 * (the per-user endpoints route), and `<resource>:read|write` for every
 * scopeable resource. Used to validate scopes at mint time so a typo like
 * `user:read` (vs `users:read`) is rejected instead of silently producing a
 * token that matches no route and 403s everywhere (a fail-closed footgun).
 */
export const KNOWN_SCOPES: ReadonlySet<string> = new Set<string>([
  '*',
  'sub:read',
  ...SCOPEABLE_RESOURCES.flatMap((r) => [`${r}:read`, `${r}:write`]),
]);

/** True if `scope` is a scope the panel actually recognises (see KNOWN_SCOPES). */
export function isKnownScope(scope: string): boolean {
  return KNOWN_SCOPES.has(scope);
}

/**
 * Global preHandler that enforces API-token scopes. It runs AFTER route-level
 * `requireAuth` (onRequest), so `request.apiToken` is already populated when a
 * request authenticated via an `icp_*` token. No-op for:
 *   - non-token requests: admin-JWT sessions and public routes leave
 *     `request.apiToken` unset and keep full access.
 *   - full / legacy tokens: empty scopes, or scopes containing `*`.
 * A token carrying explicit scopes may only reach routes whose required scope
 * it holds; anything else is 403 (default-deny).
 */
export async function enforceScopes(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.apiToken;
  if (!token) return; // admin JWT or public route, not scope-restricted
  const scopes = token.scopes;
  if (scopes.length === 0 || scopes.includes('*')) return; // full / legacy token

  const required = requiredScopeFor(request.method, request.routeOptions?.url);
  if (!required || !scopes.includes(required)) {
    return reply.code(403).send({
      error: 'FORBIDDEN',
      message: required
        ? `API token is missing the required scope (${required}) for this route`
        : 'API token scope does not grant access to this route',
    });
  }
}
