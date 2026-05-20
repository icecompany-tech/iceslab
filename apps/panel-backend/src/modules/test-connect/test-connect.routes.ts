import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.hook.js';
import { testProfileConnect } from './test-connect.service.js';

const ProfileIdParam = z.object({ id: z.uuid() });

/**
 * Slice 31 — `POST /api/profiles/:id/test-connect` runs an outbound
 * reachability probe against every enabled binding × host of the profile.
 *
 * Returns one result per (binding, host) — TLS handshake (xray, naive)
 * or TCP connect (everything else). Bounded latency: each probe times
 * out at 5s and they run concurrently, so the response always lands
 * within ~6s regardless of how many bindings the profile has.
 *
 * Auth: requireAuth — admin-only. The probes run from the panel
 * container's network, so they validate the panel→public-internet path
 * (handy for catching firewall/DNS issues) but say nothing about the
 * client→public-internet path.
 */
export async function testConnectRoutes(app: FastifyInstance): Promise<void> {
  // Wave-14 #15: per-route auth (see users.routes.ts header comment).
  const auth = { onRequest: [requireAuth] };

  app.post('/api/profiles/:id/test-connect', auth, async (req, reply) => {
    const { id } = ProfileIdParam.parse(req.params);
    try {
      const results = await testProfileConnect(id);
      return reply.send({ results });
    } catch (err) {
      if (err instanceof Error && err.message === 'Profile not found') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}
