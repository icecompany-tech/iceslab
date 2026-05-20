import type { HostMetricsResponse } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { redis } from '../../lib/redis.js';
import { NodeTransport, NodeRequestError } from './nodes.transport.js';
import { inboundSyncQueue } from '../inbounds/inbounds.queue.js';
import { notifyTelegramAsync, escapeMarkdown } from '../../lib/telegram-notify.js';

const METRICS_KEY_PREFIX = 'node:metrics:';
const METRICS_TTL_SECONDS = 60;

export function nodeMetricsKey(nodeId: string): string {
  return `${METRICS_KEY_PREFIX}${nodeId}`;
}

export async function readCachedNodeMetrics(
  nodeId: string,
): Promise<HostMetricsResponse | null> {
  const raw = await redis.get(nodeMetricsKey(nodeId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HostMetricsResponse;
  } catch {
    return null;
  }
}

/**
 * Poll every active node's `/healthz` over mTLS and update `nodes.status`
 * + `lastStatusChange` + `lastStatusMessage`. Runs on a 30-second cron tick.
 *
 * Status mapping:
 *   - HTTP 200 + body.status === "ok"        → "online"
 *   - HTTP 200 + body.status === "degraded"  → "unreachable" (subprocess down etc.)
 *   - any error / timeout                    → "unreachable"
 *
 * `disabled` is admin-managed and never overwritten here. Soft-deleted nodes
 * are excluded by the same `deletedAt: null` filter we use for fan-out.
 *
 * Slice 23.1 — added after VPS test 2026-05-06, where the panel never lifted
 * a freshly-installed node out of `unknown` because no poller existed.
 */
export async function pollNodeStatuses(): Promise<{ ok: number; down: number }> {
  const nodes = await prisma.node.findMany({
    where: { deletedAt: null, status: { not: 'disabled' } },
    select: { id: true, name: true, address: true, status: true, lastStatusMessage: true },
  });

  if (nodes.length === 0) return { ok: 0, down: 0 };

  let ok = 0;
  let down = 0;

  await Promise.all(
    nodes.map(async (node) => {
      const result = await checkOne(node);
      if (result.status === 'online') ok++;
      else down++;
      // Write to DB when status OR message changed since last tick. We also
      // compare lastStatusMessage so that a "degraded → ok" transition
      // actually clears the old degraded blurb from the UI. Pre-wave-13 the
      // guard was `statusChanged || result.message` — which never re-wrote
      // when the new message was null, leaving stale `degraded: {...}` in
      // the row forever after the underlying subprocess came back.
      const statusChanged = result.status !== node.status;
      const messageChanged = result.message !== node.lastStatusMessage;
      if (statusChanged || messageChanged) {
        await prisma.node.update({
          where: { id: node.id },
          data: {
            status: result.status,
            lastStatusChange: statusChanged ? new Date() : undefined,
            lastStatusMessage: result.message,
          },
        });
      }
      // Re-push inbounds when a node comes back up. Without this, any
      // applyInbounds attempts that happened while the node was offline
      // (e.g. auto-deploy at node creation, or binding edits during a
      // network blip) get exhausted by BullMQ retries and never resume —
      // xray/etc would stay unconfigured even though the agent is alive.
      // Cheap: the node-agent dedupes identical pushes on its side.
      if (statusChanged && result.status === 'online') {
        void inboundSyncQueue
          .add(
            'applyNodeInbounds',
            { nodeId: node.id },
            { jobId: `apply-${node.id}` },
          )
          .catch((err: unknown) => {
            console.error(`[cron] re-enqueue applyInbounds for ${node.name} failed:`, err);
          });
      }
      // Slice 32 — admin alerts on node status flips. Skip the initial
      // `unknown → online` transition (new node coming up isn't an alert
      // event) but alert on every later flip in either direction. The
      // notifyTelegramAsync helper is a no-op when env isn't configured,
      // so this stays free for operators who don't use Telegram.
      if (statusChanged && node.status !== 'unknown') {
        const icon = result.status === 'online' ? '✅' : '🔴';
        notifyTelegramAsync(
          `${icon} *Node ${result.status}*\nname: \`${escapeMarkdown(node.name)}\`\naddress: \`${escapeMarkdown(node.address)}\`` +
            (result.message ? `\nlast: ${escapeMarkdown(result.message)}` : ''),
        );
      }
    }),
  );

  return { ok, down };
}

interface PollResult {
  status: 'online' | 'unreachable';
  message: string | null;
}

/**
 * Pull /metrics from every online node in parallel and cache in Redis with
 * TTL 60s. Per-node failures are swallowed (we just won't have fresh metrics
 * for that node — the dashboard will show the previous sample until TTL or
 * "—" if it's the first run).
 *
 * Runs on a 15-second tick. Disabled / unreachable nodes are skipped — no
 * point hammering them.
 */
export async function pollNodeMetrics(): Promise<{ ok: number; failed: number }> {
  const nodes = await prisma.node.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['disabled', 'unreachable'] },
    },
    select: { id: true, address: true },
  });
  if (nodes.length === 0) return { ok: 0, failed: 0 };

  let ok = 0;
  let failed = 0;
  await Promise.all(
    nodes.map(async (node) => {
      try {
        const transport = new NodeTransport(node);
        const m = await transport.getMetrics();
        await redis.set(
          nodeMetricsKey(node.id),
          JSON.stringify(m),
          'EX',
          METRICS_TTL_SECONDS,
        );
        ok++;
      } catch {
        failed++;
      }
    }),
  );
  return { ok, failed };
}

async function checkOne(node: {
  id: string;
  name: string;
  address: string;
}): Promise<PollResult> {
  try {
    const transport = new NodeTransport(node);
    const res = await transport.healthcheck();
    if (res.status === 'ok') {
      return { status: 'online', message: null };
    }
    // node-agent reachable + healthy, but one of the protocol sub-cores
    // isn't running. Normal for a fresh node with no Profile+Binding yet
    // (xray/ss/etc have no config → not started). Keep status online,
    // surface detail in lastStatusMessage; it auto-clears once a binding
    // lands and the core boots.
    return {
      status: 'online',
      message: `degraded: ${JSON.stringify(res).slice(0, 160)}`,
    };
  } catch (err) {
    if (err instanceof NodeRequestError) {
      return { status: 'unreachable', message: `${err.status} ${err.message}`.slice(0, 200) };
    }
    return {
      status: 'unreachable',
      message: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    };
  }
}
