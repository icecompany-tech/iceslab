import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import { getVersionInfo } from './system.service.js';

/**
 * ROADMAP D1: system / version endpoint. Reports the running version + the
 * latest GitHub release tag so the SPA can nudge the operator to update.
 * Best-effort: if GitHub is unreachable (or the repo is private and no
 * GITHUB_TOKEN is set), `latest` is null and `updateAvailable` is false.
 */
export async function systemRoutes(app: FastifyInstance): Promise<void> {
  // Per-route auth (see users.routes.ts header comment). Admin-only info.
  const auth = { onRequest: [requireAuth] };

  app.get('/api/system/version', auth, async (_req, reply) => {
    return reply.send(await getVersionInfo());
  });
}
