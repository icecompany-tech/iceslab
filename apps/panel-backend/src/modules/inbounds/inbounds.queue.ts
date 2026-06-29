import { Queue, Worker, type Job } from 'bullmq';
import type { ApplyInboundsRequest, InboundDto, ProtocolName } from '@iceslab/shared';
import { redis } from '../../lib/redis.js';
import { prisma } from '../../prisma.js';
import { mtprotoSecret } from '../../core-adapters/mtproto/index.js';
import { NodeTransport, NodeRequestError } from '../nodes/nodes.transport.js';
import { inboundSyncJobs } from '../../lib/metrics.js';
import { allocatePeer, preallocatePeers } from '../amneziawg/amneziawg.service.js';
import { getCascadeFragmentsForNode } from '../cascades/cascade.service.js';
import { deriveTuicPassword, deriveAnytlsPassword } from '../../lib/credentials.js';
import { getLogger } from '../../lib/logger.js';

// ───── Job data shapes ─────

export interface ApplyNodeInboundsJobData {
  /** Which node's inbound set to recompute and push. */
  nodeId: string;
}

// ───── Queue ─────

const QUEUE_NAME = 'inbound-sync';

/**
 * Redis key for the "dirty" flag used by the dirty-flag coalescing pattern.
 *
 * Race the flag fixes: BullMQ's per-jobId dedupe rejects new enqueues for
 * jobs that are currently `active` (mid-push), so an admin edit landing
 * during the 5-30 s mTLS push window was silently dropped — the running
 * worker never saw the change, and no new push got scheduled. Next push
 * had to wait for an unrelated event.
 *
 * Sequence with the flag:
 *   enqueue → SET dirty
 *   worker start → DEL dirty (consume current intent)
 *   worker do-work (any concurrent enqueue re-SETs the flag here)
 *   worker end → GET dirty; if set, re-enqueue (new job, succeeds since
 *               the active one just completed)
 */
export function inboundDirtyKey(nodeId: string): string {
  return `inbound-sync:dirty:${nodeId}`;
}

export const inboundSyncQueue = new Queue<ApplyNodeInboundsJobData>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    // Two retries (exponential 1 s / 2 s). Inbound config push is idempotent
    // by design so retrying is always safe; we stop sooner than addUser
    // because applyInbounds restarts the protocol server and stacking
    // restarts on a flaky network is louder than stacking addUser noops.
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    // Coalescing uses `jobId: apply-<nodeId>` so duplicate enqueues collapse
    // into one push. BUT BullMQ's deduplication treats a failed job in the
    // failed-set as still "owning" the jobId — new enqueues become silent
    // no-ops until the failed job is reaped. With `age: 86400` that's a
    // 24-hour deadlock per node after a single transient failure (panel
    // rebuilds, network blips, mTLS hiccups during cert rotation).
    //
    // Fix: drop failed jobs immediately. Operators see retries via the
    // `[worker:inbound-sync] applyInbounds X FAILED: ...` getLogger().info
    // before the final retry; long-term failures will re-enqueue on the
    // next event (binding/profile change), which is the right behaviour.
    removeOnFail: true,
  },
});

// ───── Sync helper ─────

interface NodeRow {
  id: string;
  name: string;
  address: string;
}

async function fetchNode(nodeId: string): Promise<NodeRow | null> {
  return prisma.node.findFirst({
    where: { id: nodeId, deletedAt: null, status: { not: 'disabled' } },
    select: { id: true, name: true, address: true },
  });
}

interface ActiveUser {
  id: string;
  shortId: string;
  username: string;
  xrayUuid: string;
  hysteriaPassword: string;
  amneziawgPublicKey: string;
  naivePassword: string;
}

async function fetchActiveUsers(): Promise<ActiveUser[]> {
  const now = new Date();
  return prisma.user.findMany({
    where: {
      status: 'active',
      OR: [{ expireAt: null }, { expireAt: { gt: now } }],
    },
    select: {
      id: true,
      shortId: true,
      username: true,
      xrayUuid: true,
      hysteriaPassword: true,
      amneziawgPublicKey: true,
      naivePassword: true,
    },
  });
}

export async function fetchEnabledInbounds(nodeId: string): Promise<InboundDto[]> {
  // Slice 27 — walks ProfileNodeBinding rows joined to Profile, and resolves
  // the deployable config for each. Replaces the old per-node `inbounds`
  // table read while keeping the wire format identical (the node-agent
  // doesn't know about profile/binding split — it just gets a flat list).
  const bindings = await prisma.profileNodeBinding.findMany({
    where: {
      nodeId,
      enabled: true,
      profile: { enabled: true },
    },
    include: {
      profile: {
        select: { id: true, name: true, protocol: true, config: true },
      },
    },
    orderBy: { port: 'asc' },
  });

  const inbounds = bindings.map((b) => {
    // Shallow merge: per-binding overrides win over profile.config. Used for
    // ACME domain, AmneziaWG private key, Shadowsocks server PSK, etc.
    const baseConfig = (b.profile.config ?? {}) as Record<string, unknown>;
    const overrides = (b.overrides ?? {}) as Record<string, unknown>;
    let config = { ...baseConfig, ...overrides } as InboundDto['config'];

    // Slice 41 — mtproto secret derived from (binding.id, domain). Both
    // the wire push (here) and subscription generator key on binding.id so
    // the secret stays in lock-step on both sides.
    if (b.profile.protocol === 'mtproto') {
      const cfg = config as { domain?: string };
      if (cfg && cfg.domain) {
        config = {
          ...cfg,
          secret: mtprotoSecret(b.id, cfg.domain),
        } as InboundDto['config'];
      }
    }

    // AmneziaWG: inject the binding-level port into the protocol config so
    // the agent binds the awg-quick interface to the port the admin set
    // (typical 443 for stealth) instead of WireGuard's default 51820.
    // Without this, the wgconf subscription advertises Endpoint=:443 but
    // the server actually listens on 51820 — handshake never completes.
    // Caught live awg-VPS cycle #6 2026-05-12.
    if (b.profile.protocol === 'amneziawg') {
      config = {
        ...(config as Record<string, unknown>),
        listenPort: b.port,
      } as InboundDto['config'];
    }

    return {
      id: b.id,
      name: b.profile.name,
      protocol: b.profile.protocol as ProtocolName,
      port: b.port,
      config,
    };
  });

  // B3/G - REALITY self-steal: serverNames is a per-NODE property (must resolve
  // to THIS node's IP), not per-profile. For any xray inbound whose profile is in
  // self-steal mode, override serverNames with the node's own domain so SNI and IP
  // stay consistent (the node-agent serves a local TLS fallback for it; see
  // selfsteal.go). One self-steal profile can deploy to N nodes, each using its
  // own domain. If the node has no domain set, self-steal cannot work; surface it.
  const selfStealInbounds = inbounds.filter(
    (i) =>
      i.protocol === 'xray' &&
      (i.config as { realityMode?: string }).realityMode === 'self-steal',
  );
  if (selfStealInbounds.length > 0) {
    const nodeRow = await prisma.node.findUnique({
      where: { id: nodeId },
      select: { domain: true },
    });
    const domain = nodeRow?.domain ?? null;
    for (const ib of selfStealInbounds) {
      if (domain) {
        // Key MUST be `realityServerNames` (the wire-contract field the
        // node reads - see packages/shared XrayInboundCfg + the Go adapter).
        // A bare `serverNames` is an unknown key the agent's JSON decode
        // silently drops, leaving REALITY with the profile serverName and an
        // empty per-node SNI: SNI/IP mismatch + the local TLS fallback never
        // starts, so self-steal fails closed. Caught in review 2026-06-17.
        ib.config = {
          ...(ib.config as Record<string, unknown>),
          realityServerNames: [domain],
        } as InboundDto['config'];
      } else {
        getLogger().info(
          `[inbound-sync] node ${nodeId} xray inbound ${ib.id} is REALITY self-steal but the node has no domain set; serverNames not overridden (self-steal will not work until a domain is set on the node)`,
        );
      }
    }
  }

  // C3 - if this node is a hop in an enabled cascade, attach its chaining
  // fragments (link-in inbound, link-out outbound, routing rules) to the node's
  // xray inbound. The node-agent merges them into the xray config and forwards
  // entry->exit. Non-cascade nodes: getCascadeFragmentsForNode returns null and
  // this is a no-op, so the wire stays byte-identical to before.
  const cascade = await getCascadeFragmentsForNode(nodeId);
  if (cascade) {
    // A node runs a single xray config.json, so the first xray inbound is the
    // one (and only one) that carries the cascade.
    const xrayInbound = inbounds.find((i) => i.protocol === 'xray');
    if (xrayInbound) {
      xrayInbound.config = {
        ...(xrayInbound.config as Record<string, unknown>),
        cascade,
      } as InboundDto['config'];
    } else {
      getLogger().info(
        `[inbound-sync] node ${nodeId} is in an enabled cascade but has no xray inbound; cascade not applied`,
      );
    }
  }

  return inbounds;
}

/**
 * Compute the current set of enabled inbounds for `nodeId` and push it to
 * that node-agent over mTLS. Idempotent (the node-side endpoint diffs).
 *
 * Slice 24 — replaces the manual `/etc/iceslab-node/env` editing dance
 * caught during the 2026-05-06 VPS test.
 */
export async function applyInboundsForNode(nodeId: string): Promise<void> {
  // Consume the dirty-flag at the start. Any enqueue that comes in WHILE
  // we're working will re-SET this key; we check it again at the end and
  // re-enqueue if it's set. See inboundDirtyKey() for the full rationale.
  await redis.del(inboundDirtyKey(nodeId)).catch(() => null);

  const node = await fetchNode(nodeId);
  if (!node) {
    getLogger().info(`[worker:inbound-sync] applyInbounds ${nodeId} — node not active, skipping`);
    return;
  }

  const inbounds = await fetchEnabledInbounds(nodeId);
  const req: ApplyInboundsRequest = { inbounds };

  getLogger().info(
    `[worker:inbound-sync] applyInbounds ${node.name} — pushing ${inbounds.length} inbound(s)`,
  );

  const transport = new NodeTransport(node);

  try {
    const res = await transport.applyInbounds(req);
    getLogger().info(
      `[worker:inbound-sync] applyInbounds ${node.name} ok — applied=${res.applied} skipped=${res.skipped}`,
    );
    inboundSyncJobs.inc({ result: 'ok' });
  } catch (err) {
    const detail =
      err instanceof NodeRequestError
        ? `${err.status} ${err.message}`
        : err instanceof Error
        ? err.message
        : String(err);
    getLogger().info(`[worker:inbound-sync] applyInbounds ${node.name} FAILED: ${detail}`);
    inboundSyncJobs.inc({ result: 'fail' });
    throw err;
  }

  // Push all active users so protocol servers (xray, hysteria, etc.) have
  // an up-to-date client list. addUser is idempotent on the node side.
  if (inbounds.length === 0) return;

  // Find the AmneziaWG profile bound to this node (at most one — single
  // awg-quick interface per host). When present, every active user with
  // AWG creds needs an allocated IP inside the profile's subnet pushed
  // alongside the public key — without it the node-agent silently
  // skips the peer (AmneziaWGAllowedIP=="" → no-op AddUser). Caught
  // live cycle #6 2026-05-12: addUser ok was logged but `awg show`
  // showed zero peers because IP was empty on the wire.
  //
  // Keyed on profileId (NOT binding.id) so a user gets the same IP on
  // every node a profile is bound to — matches the subscription /
  // wgconf path which also keys on profileId.
  const awgBinding = inbounds.find((i) => i.protocol === 'amneziawg');
  let awgProfileId: string | null = null;
  let awgSubnet: string | null = null;
  if (awgBinding) {
    const binding = await prisma.profileNodeBinding.findUnique({
      where: { id: awgBinding.id },
      select: { profileId: true, profile: { select: { config: true } } },
    });
    if (binding) {
      awgProfileId = binding.profileId;
      const pcfg = (binding.profile.config ?? {}) as { subnet?: string };
      awgSubnet = pcfg.subnet ?? '10.66.66.0/24';
    }
  }

  const users = await fetchActiveUsers();
  getLogger().info(
    `[worker:inbound-sync] pushing ${users.length} user(s) to ${node.name}`,
  );

  // Wave-14 #13: pre-allocate AWG IPs serially (allocatePeer is racy under
  // concurrency — IP slots aren't unique-indexed). Then fan out addUser in
  // bounded-parallel chunks. Pre-wave a 1000-user install did 1000 serial
  // mTLS round-trips (~50ms each) = ~50s of worker time blocked per node
  // push, which compounds when multiple nodes need re-push at once.
  const awgIpByUser = new Map<string, string>();
  if (awgProfileId && awgSubnet) {
    const awgUsers = users.filter((u) => u.amneziawgPublicKey);
    // B7 - one bulk allocation for the whole set instead of N serial
    // allocatePeer round-trips. Stragglers (race loss / contention) fall back
    // to the robust per-user allocator below.
    const bulk = await preallocatePeers(
      awgProfileId,
      awgUsers.map((u) => u.id),
      awgSubnet,
    ).catch((err) => {
      const detail = err instanceof Error ? err.message : String(err);
      getLogger().info(
        `[worker:inbound-sync] bulk preallocatePeers on profile ${awgProfileId} FAILED, per-user fallback: ${detail}`,
      );
      return new Map<string, string>();
    });
    for (const u of awgUsers) {
      let ip = bulk.get(u.id);
      if (!ip) {
        try {
          ip = (await allocatePeer(awgProfileId, u.id, awgSubnet)).ip;
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          getLogger().info(
            `[worker:inbound-sync] allocatePeer ${u.username} on profile ${awgProfileId} FAILED: ${detail}`,
          );
          // Fall through — addUser will silently skip the AWG portion on the
          // node side, other protocols still work for this user.
          continue;
        }
      }
      awgIpByUser.set(u.id, ip);
    }
  }

  // Chunked parallel fanout. 25 is a balance between throughput and not
  // hammering the node-agent's HTTP server (default Node http.Agent
  // maxSockets = Infinity but the node-agent runs single-process Go,
  // 25 concurrent in-flight is comfortably below typical default ulimits).
  const ADD_USER_CHUNK = 25;
  let chunkFailed = 0;
  for (let i = 0; i < users.length; i += ADD_USER_CHUNK) {
    const chunk = users.slice(i, i + ADD_USER_CHUNK);
    const results = await Promise.allSettled(
      chunk.map((u) =>
        transport.addUser({
          userId: u.id,
          shortId: u.shortId,
          username: u.username,
          credentials: {
            xrayUuid: u.xrayUuid,
            hysteriaPassword: u.hysteriaPassword,
            amneziawgPublicKey: u.amneziawgPublicKey,
            amneziawgAllowedIp: awgIpByUser.get(u.id),
            naivePassword: u.naivePassword,
            tuicUuid: u.xrayUuid,
            tuicPassword: deriveTuicPassword(u.xrayUuid),
            anytlsPassword: deriveAnytlsPassword(u.xrayUuid),
          },
        }),
      ),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j]!;
      if (r.status === 'rejected') {
        chunkFailed++;
        const detail = r.reason instanceof Error ? r.reason.message : String(r.reason);
        getLogger().info(
          `[worker:inbound-sync] addUser ${chunk[j]!.username} to ${node.name} FAILED: ${detail}`,
        );
      }
    }
  }
  getLogger().info(
    `[worker:inbound-sync] user sync to ${node.name} done (${users.length - chunkFailed}/${users.length} ok)`,
  );

  // End-of-job dirty check: if an admin edit landed during the push window,
  // the event handler re-SET the flag we cleared above. Re-enqueue so the
  // intermediate edit doesn't get silently lost behind BullMQ's per-jobId
  // active-job dedupe.
  const stillDirty = await redis.getdel(inboundDirtyKey(nodeId)).catch(() => null);
  if (stillDirty) {
    void inboundSyncQueue.add(
      'applyNodeInbounds',
      { nodeId },
      { jobId: `apply-${nodeId}` },
    );
  }
}

// ───── Worker ─────

export function startInboundSyncWorker(): Worker<ApplyNodeInboundsJobData> {
  return new Worker<ApplyNodeInboundsJobData>(
    QUEUE_NAME,
    async (job: Job<ApplyNodeInboundsJobData>) => {
      switch (job.name) {
        case 'applyNodeInbounds': {
          await applyInboundsForNode(job.data.nodeId);
          break;
        }
        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }
    },
    {
      connection: redis,
      // One node at a time per worker — applyInbounds restarts the protocol
      // server, parallel restarts on the same node would race. Different
      // nodes can still go in parallel because they're distinct job IDs.
      concurrency: 5,
    },
  );
}
