import { prisma } from '../../prisma.js';

/**
 * "Saved, but not applied yet" for one node.
 *
 * Saving anything that feeds a node's inbound set (a binding, the profile
 * behind it, one of its hosts, a cascade it is a hop of) queues an async push.
 * Until 2026-09-11 only cascades could tell a landed push from one in flight,
 * because only getCascadeStatus did the comparison; a node card had nothing to
 * draw the state from, so a save looked identical whether it had reached the
 * machine or not.
 */

/**
 * The one rule, extracted so cascade status and the node card cannot drift.
 *
 * Strictly greater, not >=: an acknowledgement stamped in the same millisecond
 * as the save is the PREVIOUS push (the stamp is written when applyInbounds
 * returns, the save happens before the job is queued), and calling that
 * "applied" would show a green node for a config it never received.
 */
export function isConfigApplied(
  lastInboundSyncAt: Date | null | undefined,
  savedAt: Date,
): boolean {
  return !!lastInboundSyncAt && lastInboundSyncAt > savedAt;
}

export interface NodeSyncStatusDto {
  /** Last acknowledged push, ISO. null = this node has never taken a config. */
  lastInboundSyncAt: string | null;
  /** When the config this node should be running was last edited, ISO. */
  configChangedAt: string;
  /** configChangedAt is older than the acknowledgement. */
  applied: boolean;
  /** An unapplied config on an offline node is waiting, not stuck: the sync
   *  cron re-pushes when it comes back. The card says different things about
   *  the two, so the answer travels with the flag. */
  online: boolean;
}

/**
 * When did this node's config last change?
 *
 * A node does not own its inbound set: it is assembled from the bindings
 * pointing at it, the profiles behind those bindings, the hosts under them, and
 * any cascade the node is a hop of. Editing a profile shared by six nodes
 * changes the config of all six without touching a single node row.
 *
 * `node.updatedAt` is deliberately NOT part of this, and that is the whole
 * subtlety. It moves for reasons that have nothing to do with config: the
 * status poller writes status / lastStatusMessage / coreVersion every tick, and
 * the push path itself stamps lastInboundSyncAt on the same row, which bumps
 * updatedAt a millisecond AFTER the acknowledgement it is recording. Include it
 * and every node reads as permanently pending, including the one that just
 * successfully applied. Caught by the test for this file, which is the only
 * reason it is not shipping that way.
 *
 * The cost of leaving it out: an edit to the node row itself (domain,
 * hardening, WARP) does change the pushed config and is not visible here. Those
 * edits enqueue their own sync through the event bus, so the state is wrong
 * only for the seconds between the save and the acknowledgement, and it errs
 * toward "applied" rather than toward crying wolf on every healthy node.
 * Closing it properly needs a column that records when a node's own config last
 * changed, which is a migration and a separate piece of work.
 *
 * `createdAt` is the baseline instead: it never moves, and a node with nothing
 * bound to it has nothing to apply.
 *
 * Four aggregates rather than one join: each is an indexed max() on a small
 * table, and they run together. This is also why the comparison is NOT on the
 * list DTO, where it would be four queries per row.
 */
export async function getNodeSyncStatus(nodeId: string): Promise<NodeSyncStatusDto | null> {
  const node = await prisma.node.findFirst({
    where: { id: nodeId, deletedAt: null },
    select: { createdAt: true, lastInboundSyncAt: true, status: true },
  });
  if (!node) return null;

  const [bindings, profiles, hosts, cascades] = await Promise.all([
    prisma.profileNodeBinding.aggregate({ _max: { updatedAt: true }, where: { nodeId } }),
    prisma.profile.aggregate({
      _max: { updatedAt: true },
      where: { bindings: { some: { nodeId } } },
    }),
    prisma.host.aggregate({
      _max: { updatedAt: true },
      where: { binding: { nodeId } },
    }),
    prisma.cascade.aggregate({
      _max: { updatedAt: true },
      // Legacy hops and both v4 pools: a node reached through any of them runs
      // cascade fragments, and editing the cascade rewrites them.
      where: {
        OR: [
          { hops: { some: { nodeId } } },
          { positions: { some: { nodes: { some: { nodeId } } } } },
          { directions: { some: { nodes: { some: { nodeId } } } } },
        ],
      },
    }),
  ]);

  const changedAt = [
    bindings._max.updatedAt,
    profiles._max.updatedAt,
    hosts._max.updatedAt,
    cascades._max.updatedAt,
  ].reduce<Date>((latest, d) => (d && d > latest ? d : latest), node.createdAt);

  return {
    lastInboundSyncAt: node.lastInboundSyncAt?.toISOString() ?? null,
    configChangedAt: changedAt.toISOString(),
    applied: isConfigApplied(node.lastInboundSyncAt, changedAt),
    online: node.status === 'online',
  };
}
