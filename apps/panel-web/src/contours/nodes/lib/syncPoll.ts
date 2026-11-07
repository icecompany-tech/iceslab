import type { NodeSyncStatus } from '@/lib/old/nodes';

/**
 * How often the node page asks whether its config has landed, and when it
 * stops asking (stand 26.10: the agent drew the policy a second after the save,
 * the «saved, not applied» strip stayed until a reload).
 *
 *   pending   online and not applied: every 5 s, the push lands in seconds;
 *   timedOut  still not applied CONFIRM_MINUTES after the change: polling stops
 *             and the strip says the node did not confirm in that time;
 *   waiting   offline: the cron re-pushes when it is back, every 15 s;
 *   applied   every 30 s, only to notice a change saved on another screen
 *             (a policy edited in its own editor bumps this node too).
 *
 * The change time is the server's `configChangedAt`; one that does not parse
 * is not «just now», so it times out rather than polling for ever.
 */
export const SYNC_CONFIRM_MINUTES = 5;
const PENDING_MS = 5_000;
const WAITING_MS = 15_000;
const APPLIED_MS = 30_000;

export interface SyncPoll {
  /** react-query refetchInterval: false stops it. */
  intervalMs: number | false;
  /** Online, not applied, and past the confirm window. */
  timedOut: boolean;
}

export function syncPoll(status: Pick<NodeSyncStatus, 'applied' | 'online' | 'configChangedAt'> | undefined, now: number): SyncPoll {
  if (!status) return { intervalMs: WAITING_MS, timedOut: false };
  if (status.applied) return { intervalMs: APPLIED_MS, timedOut: false };
  if (!status.online) return { intervalMs: WAITING_MS, timedOut: false };
  const changed = Date.parse(status.configChangedAt);
  const late = !Number.isFinite(changed) || now - changed > SYNC_CONFIRM_MINUTES * 60_000;
  return late ? { intervalMs: false, timedOut: true } : { intervalMs: PENDING_MS, timedOut: false };
}
