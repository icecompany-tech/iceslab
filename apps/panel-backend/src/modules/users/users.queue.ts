import { Queue, Worker, type Job } from 'bullmq';
import type { AddUserRequest, RemoveUserRequest } from '@iceslab/shared';
import { redis } from '../../lib/redis.js';
import { prisma } from '../../prisma.js';
import { NodeTransport, NodeRequestError } from '../nodes/nodes.transport.js';
import { deriveTuicPassword, deriveAnytlsPassword } from '../../lib/credentials.js';
import { getLogger } from '../../lib/logger.js';

// ───── Job data shapes ─────

export interface AddUserJobData {
  userId: string;
}

export interface RemoveUserJobData {
  userId: string;
}

export interface BackfillNodeJobData {
  nodeId: string;
}

export type NodeUserJobData = AddUserJobData | RemoveUserJobData | BackfillNodeJobData;

// ───── Queue ─────

const QUEUE_NAME = 'node-users';

export const nodeUsersQueue = new Queue<NodeUserJobData>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },     // 1s, 2s, 4s
    removeOnComplete: { age: 3600, count: 1000 },      // keep 1h or last 1000
    removeOnFail: { age: 86400 },                      // keep 24h on fail
  },
});

// ───── Sync helpers ─────

interface NodeRow {
  id: string;
  name: string;
  address: string;
}

async function fetchActiveNodes(): Promise<NodeRow[]> {
  return prisma.node.findMany({
    where: { deletedAt: null, status: { not: 'disabled' } },
    select: { id: true, name: true, address: true },
  });
}

/**
 * Fan-out a single addUser/removeUser call to every active node, awaiting all
 * outcomes (allSettled) so we surface ALL failures rather than short-circuit
 * on the first. Throws if any node failed — BullMQ retries the whole job, so
 * `addUser`/`removeUser` MUST be idempotent on the node side (re-adding an
 * existing user is a no-op).
 */
async function fanOut<T>(
  nodes: NodeRow[],
  call: (node: NodeRow) => Promise<T>,
  label: string,
): Promise<void> {
  if (nodes.length === 0) {
    getLogger().info(`[worker:node-users] ${label} — no active nodes, skipping`);
    return;
  }
  const results = await Promise.allSettled(
    nodes.map(async (node) => {
      await call(node);
      getLogger().info(`[worker:node-users] ${label} → ${node.name} ok`);
    }),
  );
  const failures = results.flatMap((r, i) =>
    r.status === 'rejected' ? [{ node: nodes[i]!, reason: r.reason }] : [],
  );
  for (const f of failures) {
    const detail =
      f.reason instanceof NodeRequestError
        ? `${f.reason.status} ${f.reason.message}`
        : String(f.reason);
    getLogger().info(`[worker:node-users] ${label} → ${f.node.name} FAILED: ${detail}`);
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((f) => f.reason),
      `${failures.length}/${nodes.length} nodes failed for ${label}`,
    );
  }
}

async function syncAddUser(userId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      status: true,
      shortId: true,
      username: true,
      hysteriaPassword: true,
      naivePassword: true,
      xrayUuid: true,
      amneziawgPublicKey: true,
    },
  });
  if (!user) {
    getLogger().info(`[worker:node-users] addUser ${userId} — user not found, skipping`);
    return;
  }
  // #4 - status-gate. A stale addUser (enqueued before a flip to
  // limited/expired, or racing a removeUser for the same user) must not
  // resurrect a non-active user on the nodes. Together with syncRemoveUser's
  // gate this makes the node user-set converge to the live DB status no matter
  // what order the add/remove jobs happen to run in.
  if (user.status !== 'active') {
    getLogger().info(
      `[worker:node-users] addUser ${userId} — status=${user.status}, not active, skipping`,
    );
    return;
  }

  const req: AddUserRequest = {
    userId: user.id,
    shortId: user.shortId,
    username: user.username,
    credentials: {
      hysteriaPassword: user.hysteriaPassword,
      naivePassword: user.naivePassword,
      xrayUuid: user.xrayUuid,
      amneziawgPublicKey: user.amneziawgPublicKey,
      tuicUuid: user.xrayUuid,
      tuicPassword: deriveTuicPassword(user.xrayUuid),
      anytlsPassword: deriveAnytlsPassword(user.xrayUuid),
    },
  };

  const nodes = await fetchActiveNodes();
  await fanOut(
    nodes,
    (node) => new NodeTransport(node).addUser(req),
    `addUser ${userId}`,
  );
}

async function syncRemoveUser(userId: string): Promise<void> {
  // #4 - status-gate. Skip the removal if the user is currently active and not
  // soft-deleted: a stale removeUser (the user was flipped back to active by a
  // traffic reset after this job was enqueued, or it races an addUser) must
  // not drop a live user. A non-active, soft-deleted, or missing user proceeds
  // to removal (idempotent node-side no-op if it is already gone). Pairs with
  // syncAddUser's gate so the terminal node state always matches DB status.
  const user = await prisma.user.findFirst({
    where: { id: userId },
    select: { status: true, deletedAt: true },
  });
  if (user && user.deletedAt === null && user.status === 'active') {
    getLogger().info(`[worker:node-users] removeUser ${userId} — user is active, skipping`);
    return;
  }

  const req: RemoveUserRequest = { userId };
  const nodes = await fetchActiveNodes();
  await fanOut(
    nodes,
    (node) => new NodeTransport(node).removeUser(req),
    `removeUser ${userId}`,
  );
}

/**
 * Push every active user to a single freshly-registered node. Run on
 * `node.created` so an empty new node doesn't stay empty until each user
 * is mutated again. AddUser is idempotent on the node side, so this is
 * also safe to re-run (e.g. from a future "Sync users" admin button).
 */
async function syncBackfillNode(nodeId: string): Promise<void> {
  const node = await prisma.node.findFirst({
    where: { id: nodeId, deletedAt: null, status: { not: 'disabled' } },
    select: { id: true, name: true, address: true },
  });
  if (!node) {
    getLogger().info(`[worker:node-users] backfillNode ${nodeId} — node not active, skipping`);
    return;
  }

  interface BackfillUserRow {
    id: string;
    shortId: string;
    username: string;
    hysteriaPassword: string;
    naivePassword: string;
    xrayUuid: string;
    amneziawgPublicKey: string;
  }

  // B14 - stream active users in id-ordered cursor pages instead of loading the
  // whole active set into memory, and fan out addUser in bounded chunks rather
  // than one unbounded Promise.allSettled (a 1000-user backfill previously fired
  // 1000 simultaneous mTLS calls at the single-process Go agent). PAGE bounds
  // memory; CHUNK bounds in-flight requests (mirrors inbounds.queue's value).
  const BACKFILL_PAGE = 500;
  const ADD_USER_CHUNK = 25;
  const transport = new NodeTransport(node);

  const failures: { username: string; reason: unknown }[] = [];
  let total = 0;
  let cursor: string | undefined;

  for (;;) {
    const page: BackfillUserRow[] = await prisma.user.findMany({
      where: { deletedAt: null, status: 'active' },
      select: {
        id: true,
        shortId: true,
        username: true,
        hysteriaPassword: true,
        naivePassword: true,
        xrayUuid: true,
        amneziawgPublicKey: true,
      },
      orderBy: { id: 'asc' },
      take: BACKFILL_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;
    total += page.length;

    for (let i = 0; i < page.length; i += ADD_USER_CHUNK) {
      const chunk = page.slice(i, i + ADD_USER_CHUNK);
      const results = await Promise.allSettled(
        chunk.map((u) => {
          const req: AddUserRequest = {
            userId: u.id,
            shortId: u.shortId,
            username: u.username,
            credentials: {
              hysteriaPassword: u.hysteriaPassword,
              naivePassword: u.naivePassword,
              xrayUuid: u.xrayUuid,
              amneziawgPublicKey: u.amneziawgPublicKey,
              tuicUuid: u.xrayUuid,
              tuicPassword: deriveTuicPassword(u.xrayUuid),
              anytlsPassword: deriveAnytlsPassword(u.xrayUuid),
            },
          };
          return transport.addUser(req);
        }),
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j]!;
        if (r.status === 'rejected') {
          const reason = r.reason;
          const detail =
            reason instanceof NodeRequestError
              ? `${reason.status} ${reason.message}`
              : String(reason);
          getLogger().info(
            `[worker:node-users] backfillNode ${node.name} → ${chunk[j]!.username} FAILED: ${detail}`,
          );
          failures.push({ username: chunk[j]!.username, reason });
        }
      }
    }

    if (page.length < BACKFILL_PAGE) break;
  }

  if (total === 0) {
    getLogger().info(`[worker:node-users] backfillNode ${node.name} — no active users, skipping`);
    return;
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((f) => f.reason),
      `${failures.length}/${total} users failed to backfill onto ${node.name}`,
    );
  }
  getLogger().info(`[worker:node-users] backfillNode ${node.name} — ${total} user(s) ok`);
}

// ───── Worker ─────

export function startNodeUsersWorker(): Worker<NodeUserJobData> {
  return new Worker<NodeUserJobData>(
    QUEUE_NAME,
    async (job: Job<NodeUserJobData>) => {
      switch (job.name) {
        case 'addUser': {
          const { userId } = job.data as AddUserJobData;
          await syncAddUser(userId);
          break;
        }
        case 'removeUser': {
          const { userId } = job.data as RemoveUserJobData;
          await syncRemoveUser(userId);
          break;
        }
        case 'backfillNode': {
          const { nodeId } = job.data as BackfillNodeJobData;
          await syncBackfillNode(nodeId);
          break;
        }
        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );
}
