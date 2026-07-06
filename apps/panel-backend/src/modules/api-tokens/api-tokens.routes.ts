import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.hook.js';
import { PermissiveUuid } from '../../lib/uuid-schema.js';
import * as svc from './api-tokens.service.js';

const CreateInput = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(z.string().max(64)).max(32).default([]),
});

const IdParam = z.object({ id: PermissiveUuid });

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
    try {
      const { token, plaintext } = await svc.createToken(
        input.name,
        input.scopes,
        req.admin?.id ?? null,
      );
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
