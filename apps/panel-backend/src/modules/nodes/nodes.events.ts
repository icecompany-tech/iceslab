import { eventBus } from '../../lib/event-bus.js';
import { nodeUsersQueue } from '../users/users.queue.js';

/**
 * Register node-related event handlers. Mirrors users/users.events.ts.
 *
 * Today the only handler is `node.created` → enqueue a backfillNode job
 * so existing active users land on the freshly-registered node. Without
 * this, a new node stays empty until each user is mutated again, caught
 * live during the 2026-05-06 VPS test (Hysteria auth rejected pre-existing
 * user because adapter map was empty on the new node).
 */
export function registerNodeEventHandlers(): void {
  eventBus.on('node.created', async ({ nodeId, nodeName }) => {
    console.log(`[event] node.created: ${nodeName} (${nodeId})`);
    await nodeUsersQueue.add('backfillNode', { nodeId });
  });
}
