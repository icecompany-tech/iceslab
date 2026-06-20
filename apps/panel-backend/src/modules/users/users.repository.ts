import { prisma } from '../../prisma.js';
import type { User, UserTraffic, Prisma } from '../../generated/prisma/client.js';

export type UserWithTraffic = User & {
  traffic: UserTraffic | null;
  groupMembers: { groupId: string }[];
};

export interface ListParams {
  page: number;
  limit: number;
  status?: string;
  groupId?: string;
  search?: string;
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
    include: { traffic: true, groupMembers: { select: { groupId: true } } },
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
    include: { traffic: true, groupMembers: { select: { groupId: true } } },
  });
}

export async function updateById(
  id: string,
  data: Prisma.UserUpdateInput,
): Promise<UserWithTraffic> {
  return prisma.user.update({
    where: { id },
    data,
    include: { traffic: true, groupMembers: { select: { groupId: true } } },
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
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(params.status ? { status: params.status } : {}),
    ...(params.groupId
      ? { groupMembers: { some: { groupId: params.groupId } } }
      : {}),
    ...(params.search
      ? {
          OR: [
            { username: { contains: params.search, mode: 'insensitive' } },
            { email:    { contains: params.search, mode: 'insensitive' } },
            { tag:      { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { traffic: true, groupMembers: { select: { groupId: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total };
}