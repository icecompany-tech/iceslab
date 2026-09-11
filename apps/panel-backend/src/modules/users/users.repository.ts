import { ONLINE_WINDOW_MS } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import type { User, Prisma } from '../../generated/prisma/client.js';
import type { TrafficWithNode } from './users.mapper.js';

export type UserWithTraffic = User & {
  traffic: TrafficWithNode | null;
  groupMembers: { groupId: string }[];
};

/**
 * What every read of a user pulls with it.
 *
 * The node behind `lastConnectedNodeId` is joined here rather than looked up by
 * the caller: the list hands back up to 500 rows and the column shows a name,
 * so resolving ids client-side would be a second request per page. Only id and
 * name are selected, a node row carries keys and hardening flags that have no
 * business in a user DTO.
 */
const USER_INCLUDE = {
  traffic: { include: { lastConnectedNode: { select: { id: true, name: true } } } },
  groupMembers: { select: { groupId: true } },
} satisfies Prisma.UserInclude;

export type UserSort =
  | 'username'
  | 'createdAt'
  | 'expireAt'
  | 'traffic'
  | 'lastOnline'
  | 'firstConnected'
  | 'lifetimeTraffic';

export interface ListParams {
  page: number;
  limit: number;
  status?: string;
  groupId?: string;
  search?: string;
  tag?: string;
  /** R3 - filter by the per-user routing override. A preset id keeps only users
   *  pinned to it; `any` keeps everyone who has one; `none` keeps those who
   *  inherit. Without this the override is invisible in bulk: it lives in a
   *  collapsed Advanced block on one user's page, so nobody can answer "who did
   *  we pin, and why is that one person routed differently". */
  routingPreset?: string;
  // Per-column filters. Each one exists because the column is in the table and
  // an operator has a question it answers; see ListUsersQuerySchema for the
  // parameter shapes and why a percentage filter is not among them.
  nodeId?: string;
  online?: 'online' | 'offline' | 'never';
  expiresBefore?: Date;
  expiresAfter?: Date;
  hasExpiry?: 'yes' | 'no';
  trafficLimit?: 'limited' | 'unlimited';
  usedOver?: number;
  usedUnder?: number;
  deviceLimit?: 'set' | 'unset';
  telegram?: 'linked' | 'none';
  email?: 'set' | 'none';
  revoked?: 'yes' | 'no';
  hasTag?: 'yes' | 'no';
  createdBefore?: Date;
  createdAfter?: Date;
  firstConnectedBefore?: Date;
  firstConnectedAfter?: Date;
  sort?: UserSort;
  order?: 'asc' | 'desc';
}

/** Sentinels accepted by `routingPreset` alongside a concrete preset id. */
export const ROUTING_FILTER_ANY = 'any';
export const ROUTING_FILTER_NONE = 'none';

/** `nodeId=none` asks for the users no node has ever seen. Safe as a sentinel
 *  because the other accepted value is a uuid. */
export const NODE_FILTER_NONE = 'none';

/**
 * Sortable columns, mapped to Prisma order clauses. Traffic lives on the
 * related row, hence the nested form. `nulls: 'last'` on expireAt keeps
 * never-expiring users at the bottom instead of leading the list.
 */
function orderClause(
  sort: UserSort,
  order: 'asc' | 'desc',
): Prisma.UserOrderByWithRelationInput {
  switch (sort) {
    case 'traffic':
      return { traffic: { usedTrafficBytes: order } };
    case 'lifetimeTraffic':
      return { traffic: { lifetimeTrafficBytes: order } };
    case 'lastOnline':
      return { traffic: { onlineAt: order } };
    case 'firstConnected':
      return { traffic: { firstConnectedAt: order } };
    case 'expireAt':
      return { expireAt: { sort: order, nulls: 'last' } };
    case 'createdAt':
      return { createdAt: order };
    case 'username':
    default:
      return { username: order };
  }
}

export async function findActiveByUsername(username: string): Promise<User | null> {
  return prisma.user.findFirst({
    where: { username, deletedAt: null },
  });
}

export async function findBySubscriptionToken(
  token: string,
): Promise<{ id: string } | null> {
  // subscription_token is globally @unique (incl. soft-deleted rows), so this
  // catches an import clash against any existing user.
  return prisma.user.findUnique({
    where: { subscriptionToken: token },
    select: { id: true },
  });
}

export async function findActiveById(id: string): Promise<UserWithTraffic | null> {
  return prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: USER_INCLUDE,
  });
}

export async function existsActive(id: string): Promise<boolean> {
  const count = await prisma.user.count({
    where: { id, deletedAt: null },
  });
  return count > 0;
}

export async function create(data: Prisma.UserCreateInput): Promise<UserWithTraffic> {
  return prisma.user.create({
    data,
    include: USER_INCLUDE,
  });
}

export async function updateById(
  id: string,
  data: Prisma.UserUpdateInput,
): Promise<UserWithTraffic> {
  return prisma.user.update({
    where: { id },
    data,
    include: USER_INCLUDE,
  });
}

export async function resetTraffic(userId: string): Promise<void> {
  // upsert (not update) so a legacy user missing its UserTraffic row still
  // resets cleanly instead of throwing P2025.
  await prisma.userTraffic.upsert({
    where: { userId },
    update: { usedTrafficBytes: 0n, lastTrafficResetAt: new Date() },
    create: { userId, usedTrafficBytes: 0n, lastTrafficResetAt: new Date() },
  });
}

export async function softDelete(id: string): Promise<void> {
  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function list(params: ListParams): Promise<{
  users: UserWithTraffic[];
  total: number;
}> {
  // Every filter is pushed as its own clause instead of being merged into one
  // object literal. Several of them narrow the SAME relation (`traffic` carries
  // presence, the last node, consumed bytes and the first-seen stamp), and one
  // object cannot hold that key twice: written as a literal, the last filter
  // silently wins and the operator gets a list that ignores half of what they
  // asked for.
  const and: Prisma.UserWhereInput[] = [];

  if (params.status) and.push({ status: params.status });
  if (params.groupId) and.push({ groupMembers: { some: { groupId: params.groupId } } });
  if (params.tag) and.push({ tag: params.tag });
  if (params.hasTag) and.push(params.hasTag === 'yes' ? { tag: { not: null } } : { tag: null });

  if (params.routingPreset === ROUTING_FILTER_ANY) and.push({ routingPreset: { not: null } });
  else if (params.routingPreset === ROUTING_FILTER_NONE) and.push({ routingPreset: null });
  else if (params.routingPreset) and.push({ routingPreset: params.routingPreset });

  if (params.search) {
    const term = params.search;
    const or: Prisma.UserWhereInput[] = [
      { username: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { tag: { contains: term, mode: 'insensitive' } },
      // The short id is what an operator has in front of them when a subscriber
      // quotes a link, and it was the one identifier this box could not find.
      { shortId: { contains: term, mode: 'insensitive' } },
    ];
    // A telegram id is a bigint column, so `contains` cannot reach it. Pasting
    // one in and getting nothing back is how an operator concludes the search
    // is broken; matched exactly, and only when the term is a plain number.
    if (/^\d{1,19}$/.test(term)) {
      try {
        or.push({ telegramId: BigInt(term) });
      } catch {
        // Out of bigint range: not a telegram id, the text matches above stand.
      }
    }
    and.push({ OR: or });
  }

  // ───── the traffic row: presence, last node, bytes, first seen ─────
  if (params.online === 'online') {
    and.push({ traffic: { onlineAt: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) } } });
  } else if (params.online === 'offline') {
    // Seen at some point, not recently. Never-connected users are their own
    // cohort below, not a quiet third of this one.
    and.push({ traffic: { onlineAt: { lt: new Date(Date.now() - ONLINE_WINDOW_MS) } } });
  } else if (params.online === 'never') {
    and.push({ OR: [{ traffic: { is: null } }, { traffic: { onlineAt: null } }] });
  }

  if (params.nodeId === NODE_FILTER_NONE) {
    and.push({ OR: [{ traffic: { is: null } }, { traffic: { lastConnectedNodeId: null } }] });
  } else if (params.nodeId) {
    and.push({ traffic: { lastConnectedNodeId: params.nodeId } });
  }

  if (params.usedOver !== undefined) {
    and.push({ traffic: { usedTrafficBytes: { gte: BigInt(params.usedOver) } } });
  }
  if (params.usedUnder !== undefined) {
    and.push({ traffic: { usedTrafficBytes: { lte: BigInt(params.usedUnder) } } });
  }
  if (params.firstConnectedAfter) {
    and.push({ traffic: { firstConnectedAt: { gte: params.firstConnectedAfter } } });
  }
  if (params.firstConnectedBefore) {
    and.push({ traffic: { firstConnectedAt: { lte: params.firstConnectedBefore } } });
  }

  // ───── the user row ─────
  if (params.expiresAfter) and.push({ expireAt: { gte: params.expiresAfter } });
  if (params.expiresBefore) and.push({ expireAt: { lte: params.expiresBefore } });
  if (params.hasExpiry) {
    and.push(params.hasExpiry === 'yes' ? { expireAt: { not: null } } : { expireAt: null });
  }
  if (params.trafficLimit) {
    and.push(
      params.trafficLimit === 'limited'
        ? { trafficLimitBytes: { not: null } }
        : { trafficLimitBytes: null },
    );
  }
  if (params.deviceLimit) {
    and.push(
      params.deviceLimit === 'set'
        ? { hwidDeviceLimit: { not: null } }
        : { hwidDeviceLimit: null },
    );
  }
  if (params.telegram) {
    and.push(params.telegram === 'linked' ? { telegramId: { not: null } } : { telegramId: null });
  }
  if (params.email) {
    and.push(params.email === 'set' ? { email: { not: null } } : { email: null });
  }
  if (params.revoked) {
    and.push(params.revoked === 'yes' ? { subRevokedAt: { not: null } } : { subRevokedAt: null });
  }
  if (params.createdAfter) and.push({ createdAt: { gte: params.createdAfter } });
  if (params.createdBefore) and.push({ createdAt: { lte: params.createdBefore } });

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(and.length ? { AND: and } : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: USER_INCLUDE,
      orderBy: orderClause(params.sort ?? 'username', params.order ?? 'asc'),
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total };
}