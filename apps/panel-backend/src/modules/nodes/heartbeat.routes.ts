import type { FastifyInstance } from 'fastify';
import { prisma } from '../../prisma.js';
import { verifyHeartbeatToken } from './heartbeat-token.js';
import { config } from '../../config.js';
import { redis } from '../../lib/redis.js';
import { inboundSyncQueue, inboundDirtyKey } from '../inbounds/inbounds.queue.js';

/**
 * Slice 38 follow-up: detect agent restart and re-issue applyInbounds.
 *
 * The agent emits `X-Agent-Start-Time` (a per-process unix-nano string) in
 * every heartbeat. We persist the last-seen value in Redis at
 * `node:<id>:agentStartTime`. When the incoming value differs from the
 * stored one, we enqueue an `applyNodeInbounds` job which re-pushes the
 * inbound set + all active users, closing the cycle-5 gap where iOS auth
 * callbacks 404'd after agent restart until an admin toggled a profile.
 *
 * First-seen (no stored value) does NOT trigger a resync: that branch fires
 * on panel-side cold start (Redis empty) when the agent didn't actually
 * restart, and forcing a fan-out there is just noise.
 */
const AGENT_START_KEY_PREFIX = 'node:';
const AGENT_START_KEY_SUFFIX = ':agentStartTime';
// 7 days. The key just needs to outlive heartbeat-interval (60s) by a wide
// margin so that a brief Redis outage or panel restart doesn't lose the
// last-seen value and false-positive on the next heartbeat. A panel that's
// been down for >7 days is "cold start" by any reasonable definition.
const AGENT_START_TTL_SECONDS = 7 * 24 * 60 * 60;

// Hard cap on the header value we're willing to ingest. The agent emits a
// unix-nano string (~19 chars). 64 leaves slack for a future format bump.
// Fastify has its own header size limit upstream, but this is defence in
// depth: a compromised agent token shouldn't let an attacker dump arbitrary
// large strings into Redis under a node-scoped key.
const AGENT_START_MAX_LEN = 64;

async function trackAgentStart(nodeId: string, startTime: string): Promise<void> {
  if (!startTime || startTime.length > AGENT_START_MAX_LEN) return;
  // Constrain charset too: only digits/letters/`-`/`_`. Anything else is
  // by definition not a valid identifier we'd emit ourselves.
  if (!/^[A-Za-z0-9_-]+$/.test(startTime)) return;
  const key = `${AGENT_START_KEY_PREFIX}${nodeId}${AGENT_START_KEY_SUFFIX}`;
  const previous = await redis.get(key);
  await redis.set(key, startTime, 'EX', AGENT_START_TTL_SECONDS);
  if (previous && previous !== startTime) {
    // Agent restarted (in-memory user map wiped). Re-push inbounds + users.
    // Bug #3 fix (was `apply-${nodeId}-restart-${startTime}`): use the SAME
    // `apply-${nodeId}` jobId as every other inbound-sync producer so BullMQ
    // serializes pushes per node (the worker runs concurrency>1 and relies on
    // "one jobId = one node at a time"). A divergent jobId let a restart-resync
    // race a concurrent binding edit into two simultaneous protocol restarts on
    // one host. Set the dirty flag BEFORE enqueuing (same pattern as
    // inbounds.events.ts) so if a push is already active for this node, the
    // worker re-enqueues at end instead of silently dropping this resync.
    await redis.set(inboundDirtyKey(nodeId), '1').catch(() => null);
    await inboundSyncQueue.add(
      'applyNodeInbounds',
      { nodeId },
      { jobId: `apply-${nodeId}` },
    );
    console.log(
      `[heartbeat] node=${nodeId} agent restart detected (prev=${previous} new=${startTime}), enqueued applyInbounds`,
    );
  }
}

/**
 * Slice 38: heartbeat self-destruct endpoint.
 *
 * Mounted under `/api/internal/nodes` (no admin auth, agent-only).
 * The agent presents `Authorization: Bearer <token>` from its bootstrap
 * payload. Token is HMAC over (nodeId, heartbeat_secret); the secret
 * lives in `nodes.heartbeat_secret` and never leaves the panel.
 *
 * Status mapping:
 *   200 { status: "active" }    - node is registered and not soft-deleted
 *   200 { status: "disabled" }  - admin explicitly disabled the node
 *                                  (agent should pause activity but NOT
 *                                  self-destruct, admins toggle this)
 *   410 Gone                    - node was deleted; agent self-destructs
 *   401 Unauthorized            - token bad / nodeId unknown / HMAC fail
 *
 * Network errors / 5xx on the agent side are NOT treated as "delete",
 * the agent only counts explicit 410s. This keeps panel-restart and
 * brief outages from spuriously destroying production nodes.
 */
export async function heartbeatRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/status', {
    config: {
      // Bad bearers cost a DB roundtrip per request. Cap so a flood from
      // one source can't keep the panel busy. Real agents poll once a
      // minute, so 120/min/IP is generous for legitimate behind-NAT cases.
      rateLimit: {
        max: config.RATE_LIMIT_HEARTBEAT_PER_MIN,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'MISSING_BEARER' });
    }
    const token = auth.slice('Bearer '.length).trim();

    const verified = await verifyHeartbeatToken(token, async (nodeId) => {
      // Only fetch the secret column; we don't need the rest of the row
      // for verification. Soft-deleted rows DO get their secret returned
      // because we want valid-token-but-deleted to return 410, not 401.
      const row = await prisma.node.findUnique({
        where: { id: nodeId },
        select: { heartbeatSecret: true },
      });
      return row ? Buffer.from(row.heartbeatSecret as Uint8Array) : null;
    });

    if (!verified) {
      return reply.code(401).send({ error: 'INVALID_TOKEN' });
    }

    const node = await prisma.node.findUnique({
      where: { id: verified.nodeId },
      select: { deletedAt: true, status: true },
    });

    // findUnique by id on a UUID PK, if verifyHeartbeatToken found a
    // secret it means the row exists. The only way for it to be missing
    // here is a race with delete during this request; treat as Gone.
    if (!node) {
      return reply.code(410).send({ error: 'GONE' });
    }
    if (node.deletedAt) {
      return reply.code(410).send({ error: 'GONE' });
    }
    // Slice 38 follow-up: auto-resync on agent restart. Fire-and-forget
    // (we don't want a Redis hiccup to fail the heartbeat itself; if the
    // restart-detect fails, the worst case is the in-memory user map stays
    // stale until the admin toggles a profile, which was the pre-slice-38
    // status quo).
    const incomingStart = (request.headers['x-agent-start-time'] as string | undefined)?.trim();
    if (incomingStart) {
      trackAgentStart(verified.nodeId, incomingStart).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[heartbeat] node=${verified.nodeId} trackAgentStart failed: ${msg}`);
      });
    }

    if (node.status === 'disabled') {
      return reply.send({ status: 'disabled' });
    }
    return reply.send({ status: 'active' });
  });
}
