import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import { inboundSyncQueue } from '../inbounds/inbounds.queue.js';
import { cronTasksQueue } from '../scheduler/scheduler.queue.js';
import { nodeUsersQueue } from '../users/users.queue.js';

/**
 * Slice 37: Bull-board observability UI mounted at `/admin/queues`.
 *
 * Visualises BullMQ state across all three queues we run:
 *   - `node-users`: per-node user CRUD push (slice 11+13).
 *   - `inbound-sync`: auto-push inbound configs to nodes (slice 24a).
 *   - `cron-tasks`: periodic schedulers (traffic resets, polls).
 *
 * Useful when a job is stuck (Redis down, agent offline, mTLS broken):
 * admins see waiting/active/failed counts at a glance and can drill into
 * a specific job's args + error stack instead of grepping pino output.
 *
 * Auth: protected by the same `requireAuth` hook used elsewhere, JWT
 * cookie OR `Bearer icp_*` API token. If unauthenticated, the static
 * UI assets and the JSON API both return 401.
 */
export async function bullBoardRoutes(app: FastifyInstance): Promise<void> {
  const adapter = new FastifyAdapter();
  adapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(inboundSyncQueue),
      new BullMQAdapter(cronTasksQueue),
      new BullMQAdapter(nodeUsersQueue),
    ],
    serverAdapter: adapter,
  });

  // Mount the bull-board adapter under /admin/queues. The wrapper plugin
  // installs a single onRequest hook so every request to that prefix
  // (UI assets + JSON API) goes through requireAuth.
  await app.register(
    async (scope) => {
      scope.addHook('onRequest', requireAuth);
      await scope.register(adapter.registerPlugin(), {
        prefix: '/admin/queues',
      });
    },
    { prefix: '/' },
  );
}
