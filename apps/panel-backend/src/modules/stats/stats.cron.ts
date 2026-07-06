import { prisma } from '../../prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import { NodeTransport, NodeRequestError } from '../nodes/nodes.transport.js';
import { getLogger } from '../../lib/logger.js';
import {
  computeNodeStatsWrites,
  computeUserDeltas,
  type StatsUserEntry,
} from './stats.compute.js';

/**
 * Per-node in-memory snapshot of the last seen cumulative `totalBytesIn/Out`
 * from the agent. Used by the "no per-user accounting" fallback (mtproto +
 * any future single-counter adapter) to compute deltas tick-to-tick. Lives
 * in module scope - cleared when the backend restarts; that's fine, the
 * first tick after restart just records the current snapshot.
 */
const totalSnapshot = new Map<string, { in: bigint; out: bigint }>();

/**
 * Per-user per-poll sanity ceiling for ingested traffic deltas. node-stats-poll
 * runs every 30s (scheduler.queue.ts), so one user's delta is at most ~30s of
 * traffic. 1 TiB in 30s is ~293 Gbit/s, beyond any VPS link by orders of
 * magnitude, so a per-poll delta above this is never real: it's an agent
 * re-billing its lifetime cumulative (e.g. a node-agent built before the AWG
 * per-poll-delta fix, commit 5197f4a, which re-sent the whole counter every
 * poll). computeNodeStatsWrites discards such entries instead of nuking a user's
 * quota and the node's history with phantom TiB; we log each one so the operator
 * knows to redeploy that node-agent. Generous on purpose - a missed poll that
 * batches several intervals of a saturated link still stays well under 1 TiB.
 */
const NODE_STATS_MAX_USER_DELTA_BYTES = 1024 ** 4; // 1 TiB

/**
 * Poll per-user traffic stats from every online node and roll them into
 * `user_traffic.used_traffic_bytes` (per-user) and `node_usage_history`
 * (per-node, hourly bucket).
 *
 * Agent-side: xray's `api statsquery -reset` returns deltas since last
 * poll; the agent's `GET /stats` endpoint already wraps that. Other cores
 * (Hysteria/AWG/Naive/SS) don't expose per-user counters today - they're
 * absent from the response and silently skipped here.
 *
 * Apply `node.consumptionMultiplier` to the user-side delta so premium
 * regions count more (or less) against per-user limits.
 *
 * B3 - per-node writes go out as one bulk `unnest`-based upsert per table
 * (user_traffic, node_user_usage_history) instead of N individual upserts.
 * That collapses 2N statements into 2, cutting round-trips and the row-lock
 * window on `user_traffic` under contention. All writes for a node still run
 * in one `$transaction`: the agent's getStats() destructively drained the
 * upstream counters, so a partial commit would burn deltas - all-or-nothing
 * means an upsert failure rolls back and the agent returns cumulative+new on
 * the next tick.
 *
 * Idempotent: on transient failure, skip and try next tick. Never block
 * the cron loop on one slow/down node.
 */
export async function pollNodeStats(): Promise<{ ok: number; failed: number }> {
  const nodes = await prisma.node.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['disabled', 'unreachable'] },
    },
    // protocol drives the mtproto presence-only online fallback. Single-secret
    // protocols (mtproto via mtg) can't attribute traffic to a specific userId,
    // so the bytes-delta loop never touches user.onlineAt for them and the UI
    // shows OFFLINE forever. We patch around that by treating "user is tracked
    // by the adapter" as the online signal - only for protocols that force it.
    select: { id: true, address: true, consumptionMultiplier: true, protocol: true },
  });
  if (nodes.length === 0) return { ok: 0, failed: 0 };

  const now = new Date();
  // Floor to current hour bucket - UTC. node_usage_history has @@id([nodeId, hour]).
  const hourBucket = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
    ),
  );
  // Current UTC calendar day as a TZ-independent 'YYYY-MM-DD' string. The
  // bulk upsert casts it with `::date`, which (unlike binding a Date and
  // casting timestamptz->date) never shifts under the session timezone. The
  // dashboard "Top users today" groups node_user_usage_history by userId WHERE
  // date = today, so this must match startOfToday()'s UTC-midnight shape.
  const dateStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

  let ok = 0;
  let failed = 0;

  await Promise.all(
    nodes.map(async (node) => {
      try {
        const transport = new NodeTransport(node);
        const res = await transport.getStats();
        let userList: StatsUserEntry[] = res.users ?? [];
        const rawTotal = userList.reduce(
          (acc, u) => acc + (u.bytesIn || 0) + (u.bytesOut || 0),
          0,
        );
        if (rawTotal > 0) {
          getLogger().info(
            `[cron] node-stats-poll ${node.id} - ${userList.length} entries, total=${rawTotal}B`,
          );
        }

        // #5 - cumulative-mode cores (xray/singbox non-destructive read) report
        // per-user counters cumulative-since-core-start. Convert them to per-poll
        // deltas against the stored snapshot here, then persist the new snapshot in
        // the SAME transaction as the increments below, so a lost response or a
        // rolled-back commit never drops bytes. Legacy agents (no `cumulative`
        // flag) already send deltas and skip this path.
        //
        // Mixed-node fix: a node running BOTH a cumulative core (xray) and a delta
        // core (shadowsocks/awg/hysteria) OR's to response-level cumulative=true,
        // but each user now carries its own `cumulative` flag. Snapshot-delta ONLY
        // the cumulative-tagged users; the delta-tagged ones are already per-poll
        // deltas and must pass through untouched (else they get double-deltaed to
        // ~zero and that traffic goes unbilled). When no user carries the flag
        // (legacy agent) we fall back to treating the whole list as cumulative,
        // so single-core and old-agent nodes stay byte-identical.
        let snapshotUpserts: { userId: string; cumIn: bigint; cumOut: bigint }[] = [];
        if (res.cumulative && userList.length > 0) {
          const tagged = userList.some((u) => u.cumulative !== undefined);
          const cumulativeUsers = tagged ? userList.filter((u) => u.cumulative) : userList;
          const deltaUsers = tagged ? userList.filter((u) => !u.cumulative) : [];
          if (cumulativeUsers.length > 0) {
            const prevRows = await prisma.nodeUserTrafficSnapshot.findMany({
              where: { nodeId: node.id, userId: { in: cumulativeUsers.map((u) => u.userId) } },
              select: { userId: true, cumIn: true, cumOut: true },
            });
            const prev = new Map(
              prevRows.map((r) => [r.userId, { cumIn: r.cumIn, cumOut: r.cumOut }]),
            );
            const d = computeUserDeltas(cumulativeUsers, prev);
            userList = [...d.deltas, ...deltaUsers];
            snapshotUpserts = d.snapshots;
          }
        }

        // All the delta math (scaling, zero-delta skip, presence-only signal,
        // node-total delta) lives in the pure, unit-tested helper. Cumulative
        // agents (xray) report the node total as a cumulative inbound counter:
        // pass it through with nodeTotalIsCumulative so node-level history counts
        // ALL inbound traffic, including a cascade link-in that has no per-user
        // email, while per-user billing still comes from the deltas above. Legacy
        // delta agents pass their totals through for the presence-only fallback.
        const w = computeNodeStatsWrites({
          users: userList,
          multiplier: Number(node.consumptionMultiplier ?? 1) || 1,
          isPresenceOnlyProtocol: node.protocol === 'mtproto',
          totalBytesIn: res.totalBytesIn,
          totalBytesOut: res.totalBytesOut,
          nodeTotalIsCumulative: !!res.cumulative,
          prevSnapshot: totalSnapshot.get(node.id),
          maxUserDeltaBytes: NODE_STATS_MAX_USER_DELTA_BYTES,
        });

        // A non-empty clamp list is a misbehaving / outdated node-agent re-billing
        // its lifetime cumulative every poll. Discarded above so it can't corrupt
        // quotas or node history; log loudly so the operator redeploys that node.
        for (const c of w.clamped) {
          getLogger().warn(
            `[cron] node-stats-poll ${node.id} - discarded implausible delta for user ${c.userId}: in=${c.bytesIn}B out=${c.bytesOut}B in one 30s poll (> 1 TiB). Node-agent likely predates the AWG per-poll-delta fix - redeploy this node.`,
          );
        }

        const stmts: Prisma.PrismaPromise<unknown>[] = [];

        // user_traffic: bulk upsert. used+lifetime increment by the scaled
        // delta; online_at/last_connected_node_id always refreshed;
        // first_connected_at only set on insert (absent from the SET list, so
        // preserved on conflict). Presence-only rows carry scaled=0 - a no-op
        // on traffic that still touches online_at. Values bound as text[] and
        // cast in-SQL so bigints serialize unambiguously through the pg driver.
        if (w.userTrafficRows.length > 0) {
          const ids = w.userTrafficRows.map((r) => r.userId);
          const amts = w.userTrafficRows.map((r) => r.scaled.toString());
          stmts.push(
            prisma.$executeRaw(Prisma.sql`
              INSERT INTO user_traffic
                (user_id, used_traffic_bytes, lifetime_traffic_bytes, online_at, first_connected_at, last_connected_node_id)
              SELECT u.uid, u.amt, u.amt, ${now}, ${now}, ${node.id}::uuid
              FROM unnest(
                ARRAY[${Prisma.join(ids)}]::uuid[],
                ARRAY[${Prisma.join(amts)}]::bigint[]
              ) AS u(uid, amt)
              ON CONFLICT (user_id) DO UPDATE SET
                used_traffic_bytes     = user_traffic.used_traffic_bytes + EXCLUDED.used_traffic_bytes,
                lifetime_traffic_bytes = user_traffic.lifetime_traffic_bytes + EXCLUDED.lifetime_traffic_bytes,
                online_at              = EXCLUDED.online_at,
                last_connected_node_id = EXCLUDED.last_connected_node_id
            `),
          );
        }

        // node_user_usage_history: per-user daily bucket. node_id + date are
        // constant for this node/tick, so they ride as scalars; only the
        // per-user arrays unnest. Powers the dashboard "Top users today" card.
        if (w.historyRows.length > 0) {
          const ids = w.historyRows.map((r) => r.userId);
          const ins = w.historyRows.map((r) => r.bytesIn.toString());
          const outs = w.historyRows.map((r) => r.bytesOut.toString());
          stmts.push(
            prisma.$executeRaw(Prisma.sql`
              INSERT INTO node_user_usage_history (node_id, "date", user_id, bytes_in, bytes_out)
              SELECT ${node.id}::uuid, ${dateStr}::date, u.uid, u.bin, u.bout
              FROM unnest(
                ARRAY[${Prisma.join(ids)}]::uuid[],
                ARRAY[${Prisma.join(ins)}]::bigint[],
                ARRAY[${Prisma.join(outs)}]::bigint[]
              ) AS u(uid, bin, bout)
              ON CONFLICT (node_id, "date", user_id) DO UPDATE SET
                bytes_in  = node_user_usage_history.bytes_in + EXCLUDED.bytes_in,
                bytes_out = node_user_usage_history.bytes_out + EXCLUDED.bytes_out
            `),
          );
        }

        // node_usage_history: a single (nodeId, hour) row - no fan-out, so the
        // typed upsert stays. Raw (unscaled) bytes that crossed the wire.
        if (w.nodeDownload > 0n || w.nodeUpload > 0n) {
          stmts.push(
            prisma.nodeUsageHistory.upsert({
              where: { nodeId_hour: { nodeId: node.id, hour: hourBucket } },
              create: {
                nodeId: node.id,
                hour: hourBucket,
                downloadBytes: w.nodeDownload,
                uploadBytes: w.nodeUpload,
              },
              update: {
                downloadBytes: { increment: w.nodeDownload },
                uploadBytes: { increment: w.nodeUpload },
              },
            }) as unknown as Prisma.PrismaPromise<unknown>,
          );
        }

        // #5 - advance the per-(node,user) cumulative snapshot in the SAME
        // transaction as the increments. If the commit fails the snapshot stays
        // put and the next poll re-derives the delta from it, so no bytes are
        // lost. Sorted by userId for the same deadlock-safe lock order as the
        // other bulk upserts.
        if (snapshotUpserts.length > 0) {
          const sorted = [...snapshotUpserts].sort((a, b) =>
            a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0,
          );
          const sids = sorted.map((s) => s.userId);
          const sins = sorted.map((s) => s.cumIn.toString());
          const souts = sorted.map((s) => s.cumOut.toString());
          stmts.push(
            prisma.$executeRaw(Prisma.sql`
              INSERT INTO node_user_traffic_snapshot (node_id, user_id, cum_in, cum_out, updated_at)
              SELECT ${node.id}::uuid, u.uid, u.cin, u.cout, ${now}
              FROM unnest(
                ARRAY[${Prisma.join(sids)}]::uuid[],
                ARRAY[${Prisma.join(sins)}]::bigint[],
                ARRAY[${Prisma.join(souts)}]::bigint[]
              ) AS u(uid, cin, cout)
              ON CONFLICT (node_id, user_id) DO UPDATE SET
                cum_in     = EXCLUDED.cum_in,
                cum_out    = EXCLUDED.cum_out,
                updated_at = EXCLUDED.updated_at
            `),
          );
        }

        if (stmts.length > 0) {
          await prisma.$transaction(stmts);
        }
        // Advance the single-counter snapshot only after a clean commit, so a
        // failed write doesn't drop those node-level bytes (next poll
        // re-derives the delta from the un-advanced baseline).
        if (w.newSnapshot) totalSnapshot.set(node.id, w.newSnapshot);
        ok++;
      } catch (err) {
        failed++;
        const detail =
          err instanceof NodeRequestError
            ? `${err.status} ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        getLogger().error(`[cron] node-stats-poll ${node.id} FAILED: ${detail}`);
      }
    }),
  );

  return { ok, failed };
}
