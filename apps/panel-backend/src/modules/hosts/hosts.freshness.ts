import { prisma } from '../../prisma.js';
import { SUBSCRIPTION_REQUEST_RETENTION_DAYS } from '../maintenance/retention.cron.js';

/**
 * Who is still holding the old link.
 *
 * Editing a host, or the binding or profile under it, changes the URL a client
 * already has. Nothing breaks at that moment: the subscriber keeps connecting
 * on the old config until it stops authenticating, and then finds out on their
 * own, which is the failure this screen exists to get ahead of.
 *
 * No column and no migration. The panel already writes a row per `/sub` poll
 * (SubscriptionRequestHistory), so "has this person re-read since the change"
 * is a question the existing data answers, and a monotonic v3/v4 number on the
 * host would add nothing the timestamps do not already say.
 */

/**
 * When the config behind this host last changed.
 *
 * A host is a set of overrides on top of `binding + profile`, so the two rows
 * under it are part of its config: moving the port is an edit to the BINDING and
 * it changes the link every client holds without touching the host row. Same
 * shape as the node's `configChangedAt`, for the same reason - the unit of
 * editing and the unit of config are different things.
 */
export function hostConfigChangedAt(parts: {
  host: Date;
  binding: Date;
  profile: Date;
}): Date {
  return [parts.binding, parts.profile].reduce(
    (latest, d) => (d > latest ? d : latest),
    parts.host,
  );
}

export interface HostFreshnessDto {
  configChangedAt: string;
  /** Subscribers who fetched the subscription after that moment: their client
   *  holds the current link. */
  current: number;
  /** Subscribers who have not. Their config is the old one. */
  stale: number;
  total: number;
  /** Subset of `stale` with no request on record at all: either they never
   *  fetched, or their last fetch fell out of the retention window below. Split
   *  out because the two read differently on screen - "never installed it" is a
   *  sales problem, "has not opened the app in three months" is not. */
  neverFetched: number;
  /** How far back the evidence goes. Beyond this the history is pruned, so a
   *  quiet subscriber counts as stale. For this screen that is the RIGHT
   *  answer rather than a rounding error: someone who has not polled in that
   *  long is certainly still on the old link. */
  retentionDays: number;
}

export async function getHostFreshness(hostId: string): Promise<HostFreshnessDto | null> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: {
      updatedAt: true,
      binding: {
        select: { updatedAt: true, profile: { select: { updatedAt: true } } },
      },
    },
  });
  if (!host) return null;

  const changedAt = hostConfigChangedAt({
    host: host.updatedAt,
    binding: host.binding.updatedAt,
    profile: host.binding.profile.updatedAt,
  });

  // The audience is the same join `reachByHost` uses, including the squad
  // narrowing rule (no GroupHost rows for a squad = it hands out every host of
  // its profiles; any rows = exactly those). Counting people rather than
  // memberships matters here as much as it does there: one person in two squads
  // is one person who cannot connect.
  //
  // Strictly `>`, the same boundary as isConfigApplied and for the same reason:
  // a poll in the same millisecond as the save carries the config from BEFORE
  // it, so equal has to count as stale. Erring the other way would report a
  // subscriber as safe while their client holds a link that no longer works.
  const [row] = await prisma.$queryRaw<
    { total: number; current: number; never_fetched: number }[]
  >`
    SELECT COUNT(DISTINCT u.id)::int AS total,
           COUNT(DISTINCT u.id) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM subscription_request_history r
               WHERE r.user_id = u.id AND r.requested_at > ${changedAt}
             )
           )::int AS current,
           COUNT(DISTINCT u.id) FILTER (
             WHERE NOT EXISTS (
               SELECT 1 FROM subscription_request_history r2 WHERE r2.user_id = u.id
             )
           )::int AS never_fetched
    FROM hosts h
    JOIN profile_node_bindings b ON b.id = h.binding_id
    JOIN group_profiles gp       ON gp.profile_id = b.profile_id
    JOIN group_members gm        ON gm.group_id = gp.group_id
    JOIN users u                 ON u.id = gm.user_id AND u.deleted_at IS NULL
    WHERE h.id = ${hostId}::uuid
      AND (
        NOT EXISTS (SELECT 1 FROM group_hosts x WHERE x.group_id = gp.group_id)
        OR EXISTS (SELECT 1 FROM group_hosts y
                   WHERE y.group_id = gp.group_id AND y.host_id = h.id)
      )
  `;

  const total = row?.total ?? 0;
  const current = row?.current ?? 0;
  return {
    configChangedAt: changedAt.toISOString(),
    current,
    stale: total - current,
    total,
    neverFetched: row?.never_fetched ?? 0,
    retentionDays: SUBSCRIPTION_REQUEST_RETENTION_DAYS,
  };
}
