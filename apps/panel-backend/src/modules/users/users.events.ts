import { eventBus } from '../../lib/infra/event-bus.js';
import { nodeUsersQueue } from './users.queue.js';
import { notifyTelegramAsync } from '../../lib/notify/telegram-notify.js';
import { prisma } from '../../prisma.js';

/**
 * Register all user-related event handlers.
 * Called once at app bootstrap.
 *
 * Handlers translate domain events into background jobs (BullMQ).
 * The actual node sync happens in workers (slice 9 will implement
 * the mTLS calls). For now workers are mock log-only.
 */
export function registerUserEventHandlers(): void {
  eventBus.on('user.created', async ({ userId, username }) => {
    console.log(`[event] user.created - ${username} (${userId})`);
    await nodeUsersQueue.add('addUser', { userId });
  });

  eventBus.on('user.updated', async ({ userId, changes }) => {
    console.log(`[event] user.updated - ${userId} - ${changes.join(', ')}`);
    // A-022: the squads decide which nodes and inbounds the user is on, so a
    // change of squads rolls the user out again (addUser takes them off the
    // nodes they no longer reach). Pure metadata needs no node sync; status
    // changes have their own event below. A-053: so do reissued credentials,
    // the nodes replace the identity they hold for this user id.
    if (changes.includes('groupIds') || changes.includes('credentials')) {
      await nodeUsersQueue.add('addUser', { userId });
    }
  });

  // A-022: a squad that changed what it grants (profiles, hosts) moves its
  // members' reach. Each active member is rolled out again; addUser skips a
  // member who is not active.
  eventBus.on('squad.changed', async ({ squadId }) => {
    const members = await prisma.groupMember.findMany({
      where: { groupId: squadId, user: { deletedAt: null, status: 'active' } },
      select: { userId: true },
    });
    if (members.length === 0) return;
    await nodeUsersQueue.addBulk(members.map((m) => ({ name: 'addUser', data: { userId: m.userId } })));
  });

  eventBus.on('user.status-changed', async ({ userId, from, to }) => {
    console.log(`[event] user.status-changed - ${userId} - ${from} → ${to}`);
    // Going non-active → remove user from nodes
    if (to === 'disabled' || to === 'limited' || to === 'expired') {
      await nodeUsersQueue.add('removeUser', { userId });
    }
    // Going back to active → re-add to nodes
    if (to === 'active' && from !== 'active') {
      await nodeUsersQueue.add('addUser', { userId });
    }
    // Slice 32 - admin alert on the two operator-visible transitions:
    // expired (subscription lapse) and limited (quota burn). Skip the
    // routine `active ↔ disabled` toggles, admins are the ones flipping
    // those and don't need to be told what they just did.
    if (to === 'expired' || to === 'limited') {
      const icon = to === 'expired' ? '⏳' : '📊';
      notifyTelegramAsync(
        `${icon} *User ${to}*\nuserId: \`${userId}\`\nprevious: ${from}`,
      );
    }
  });

  eventBus.on('user.deleted', async ({ userId }) => {
    console.log(`[event] user.deleted - ${userId}`);
    await nodeUsersQueue.add('removeUser', { userId });
  });

  // Traffic reset means the user is back under quota. Without this handler,
  // users who got flipped to 'limited' would stay locked even after the
  // strategy-boundary reset cleared their usedTrafficBytes, the operator
  // had to flip them back manually. Flip limited→active and let the
  // status-changed cascade do the addUser fan-out, emitting the event
  // already triggers nodeUsersQueue.add('addUser') in the handler above.
  // (Earlier version did both, producing double-enqueue on every reset.)
  eventBus.on('user.traffic-reset', async ({ userId }) => {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { status: true },
    });
    if (!user || user.status !== 'limited') return;
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'active' },
    });
    eventBus.emit('user.status-changed', {
      userId,
      from: 'limited',
      to: 'active',
    });
  });
}
