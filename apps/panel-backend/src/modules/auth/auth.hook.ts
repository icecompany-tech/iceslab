import { createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { findAdminById } from '../admin/admin.service.js';
import { prisma } from '../../prisma.js';

interface JwtSignPayload {
  sub: string;
  role: string;
}

interface JwtVerifiedPayload extends JwtSignPayload {
  iat: number;
  exp: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: {
      id: string;
      role: string;
    };
    /** Set when the request is authenticated via API token (icp_*) instead
     *  of an admin JWT. Routes that need to distinguish (e.g. block API
     *  tokens from managing other API tokens) check this. */
    apiToken?: {
      id: string;
      name: string;
      scopes: string[];
    };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtSignPayload;        // what we pass to reply.jwtSign(...)
    user: JwtVerifiedPayload;       // what request.user becomes after jwtVerify()
  }
}

const API_TOKEN_PREFIX = 'icp_';

function hashApiToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Bearer-token alternative to JWT. When the Authorization header carries an
 * `icp_*` token (issued via /api/api-tokens), look it up by SHA-256 hash and,
 * if found, treat the request as authenticated with admin-level access.
 *
 * Trade-offs vs JWT:
 *   - Stateless? No, every request hits api_tokens. Acceptable: the table
 *     is tiny (admin-issued, dozens of rows max). Could memoize in Redis
 *     later if it becomes a hotspot.
 *   - Revocation? Instant via DELETE /api/api-tokens/:id. JWT can't do that
 *     short of rotating the signing secret.
 *   - Expiry? Tokens don't expire today, admin manually revokes when no
 *     longer needed.
 */
async function tryApiToken(
  request: FastifyRequest,
): Promise<
  | {
      /** Issuing admin's id, or null for legacy tokens minted before the
       *  FK existed. Callers MUST cope with null, handlers that need to
       *  attribute the action to a specific admin should 401 in that case. */
      adminId: string | null;
      role: string;
      tokenId: string;
      tokenName: string;
      scopes: string[];
    }
  | null
> {
  const auth = request.headers.authorization;
  if (!auth) return null;
  const matched = /^Bearer\s+(icp_[A-Za-z0-9_-]+)$/.exec(auth);
  if (!matched) return null;
  const plaintext = matched[1]!;

  const tokenHash = hashApiToken(plaintext);
  const row = await prisma.apiToken.findUnique({ where: { tokenHash } });
  if (!row) return null;

  // Best-effort lastUsedAt, fire-and-forget so the request response time
  // doesn't pay for the audit write. Debounce to once-per-60s per token:
  // a hot integration hitting 10 rps would otherwise pin api_tokens with
  // 864k UPDATEs/day for the same row.
  const lastUsed = row.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - lastUsed > 60_000) {
    void prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }

  const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
  // API tokens act with admin role; per-route scope enforcement lives in the
  // global enforceScopes preHandler (scope.hook.ts). Empty scopes = full admin
  // (legacy / full token); explicit scopes are least-privilege.
  // adminId is the ISSUING admin's id (or null for legacy rows); previously
  // we lied here with row.id (the token's own PK), which broke /api/auth/me
  // and any FK column that tries to attribute actions to an admin.
  return {
    adminId: row.createdByAdminId,
    role: 'admin',
    tokenId: row.id,
    tokenName: row.name,
    scopes,
  };
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Try API-token path first, when the header is unmistakably
  // `Bearer icp_*` we skip jwtVerify entirely.
  const apiAuth = await tryApiToken(request);
  if (apiAuth) {
    // Only populate request.admin when the token has a real issuing-admin
    // FK. Legacy tokens (pre-migration) carry null and stay token-only,
    // /api/auth/me will 401 for those instead of returning random data.
    if (apiAuth.adminId) {
      request.admin = { id: apiAuth.adminId, role: apiAuth.role };
    }
    request.apiToken = {
      id: apiAuth.tokenId,
      name: apiAuth.tokenName,
      scopes: apiAuth.scopes,
    };
    return;
  }

  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Missing or invalid token' });
    return;
  }

  const payload = request.user;
  const admin = await findAdminById(payload.sub);
  if (!admin) {
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Admin no longer exists' });
    return;
  }

  request.admin = { id: admin.id, role: admin.role };
}

// Re-export for tests / future call-sites.
export { API_TOKEN_PREFIX };
