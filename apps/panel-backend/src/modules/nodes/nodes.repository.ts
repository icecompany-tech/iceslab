import { prisma } from '../../prisma.js';
import type { Node, Prisma } from '../../generated/prisma/client.js';

export interface ListParams {
  page: number;
  limit: number;
  status?: string;
  regionId?: string;
}

export async function findActiveById(id: string): Promise<Node | null> {
  return prisma.node.findFirst({ where: { id, deletedAt: null } });
}

export async function existsActive(id: string): Promise<boolean> {
  const count = await prisma.node.count({ where: { id, deletedAt: null } });
  return count > 0;
}

export async function findActiveByName(name: string): Promise<Node | null> {
  return prisma.node.findFirst({ where: { name, deletedAt: null } });
}

export async function findActiveByAddress(address: string): Promise<Node | null> {
  return prisma.node.findFirst({ where: { address, deletedAt: null } });
}

export async function create(data: Prisma.NodeUncheckedCreateInput): Promise<Node> {
  // Unchecked variant lets us set FKs by id (`regionId`) directly without
  // the nested `region: { connect: ... }` ceremony, for service-layer
  // usage that's owning the FK assignment we prefer the flat shape.
  return prisma.node.create({ data });
}

export async function updateById(
  id: string,
  data: Prisma.NodeUncheckedUpdateInput,
): Promise<Node> {
  return prisma.node.update({ where: { id }, data });
}

export async function softDelete(id: string): Promise<void> {
  await prisma.node.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function list(params: ListParams): Promise<{
  nodes: Node[];
  total: number;
}> {
  const where: Prisma.NodeWhereInput = {
    deletedAt: null,
    ...(params.status ? { status: params.status } : {}),
    ...(params.regionId ? { regionId: params.regionId } : {}),
  };
  const [nodes, total] = await Promise.all([
    prisma.node.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.node.count({ where }),
  ]);
  return { nodes, total };
}
