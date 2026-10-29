import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.hook.js';
import { PermissiveUuid } from '../../lib/util/uuid-schema.js';
import * as svc from './api-tokens.service.js';
import { isKnownScope } from '../auth/scope.hook.js';
import { prisma } from '../../prisma.js';
import { audit } from '../audit/audit.hook.js';

const CreateInput = z.object({
  name: z.string().min(1).max(64),
  scopes: z
    .array(z.string().max(64))
    .max(32)
    .default([])
    .refine((arr) => arr.every(isKnownScope), {
      message:
        'Unknown scope. Use <resource>:read|write, sub:read, or leave empty / "*" for full access',
    }),
});

const IdParam = z.object({ id: PermissiveUuid });

/** A token's scopes as the audit log keeps them: none is a full token, '*'. */
const scopesOf = (scopes: string[]) => (scopes.length === 0 ? ['*'] : scopes);

/**
 * API-tokens management endpoints are admin-JWT-only, a leaked API token
 * shouldn't be able to mint or revoke other tokens (privilege escalation).
 * The session must come from a real admin login.
 *
 * Async hook signature is REQUIRED, a sync `function` without a `done`
 * callback parameter hangs the request lifecycle in Fastify v5 (Fastify
 * waits forever for the hook to signal completion).
 */
async function blockApiTokenAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (request.apiToken) {
    return reply.code(403).send({
      error: 'FORBIDDEN',
      message: 'API tokens cannot manage other API tokens, log in as admin',
    });
  }
}

export async function apiTokensRoutes(app: FastifyInstance): Promise<void> {
  // Wave-14 #15: per-route auth + blockApiTokenAccess (see users.routes.ts
  // header comment). Both hooks must fire on every route, order matters,
  // blockApiTokenAccess relies on requireAuth populating req.admin first.
  const auth = { onRequest: [requireAuth, blockApiTokenAccess] };

  app.get('/api/api-tokens', auth, async (_req, reply) => {
    return reply.send({ tokens: await svc.listTokens() });
  });

  app.post('/api/api-tokens', auth, async (req, reply) => {
    const input = CreateInput.parse(req.body);
    // The token by its name and what it may do; never the token, its hash or
    // a prefix. No id until it exists: a refused create keeps the name.
    const entry = audit(req, {
      action: 'apiToken.create',
      target: { kind: 'api_token', id: null, label: input.name },
      detail: { scopes: scopesOf(input.scopes) },
    });
    try {
      const { token, plaintext } = await svc.createToken(
        input.name,
        input.scopes,
        req.admin?.id ?? null,
      );
      entry.target.id = token.id;
      return reply.code(201).send({ ...token, token: plaintext });
    } catch (err) {
      if (err instanceof svc.ApiTokenNameTakenError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  app.delete('/api/api-tokens/:id', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    // As it stood: its name and scopes are gone with it.
    const standing = await prisma.apiToken.findUnique({ where: { id }, select: { name: true, scopes: true } });
    if (standing) {
      audit(req, {
        action: 'apiToken.revoke',
        target: { kind: 'api_token', id, label: standing.name },
        detail: { scopes: scopesOf(Array.isArray(standing.scopes) ? (standing.scopes as string[]) : []) },
      });
    }
    try {
      await svc.deleteToken(id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof svc.ApiTokenNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}
