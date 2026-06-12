import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { validateCascadeHops } from './cascade.validation.js';
import { generateLinkCreds } from './cascade.config.js';
import type { CreateCascadeInput, UpdateCascadeInput } from './cascade.schemas.js';
import { mapCascade, type CascadeDto } from './cascade.mapper.js';

export class CascadeNotFoundError extends Error {
  constructor(id: string) {
    super(`Cascade ${id} not found`);
    this.name = 'CascadeNotFoundError';
  }
}
export class CascadeNameTakenError extends Error {
  constructor(name: string) {
    super(`Cascade name "${name}" is already in use`);
    this.name = 'CascadeNameTakenError';
  }
}
export class CascadeNodeMissingError extends Error {
  constructor(nodeId: string) {
    super(`Node ${nodeId} does not exist`);
    this.name = 'CascadeNodeMissingError';
  }
}

const hopInclude = {
  hops: {
    orderBy: { position: 'asc' as const },
    include: { node: { select: { id: true, name: true } } },
  },
};

async function assertNodesExist(nodeIds: string[]): Promise<void> {
  const found = await prisma.node.findMany({
    where: { id: { in: nodeIds }, deletedAt: null },
    select: { id: true },
  });
  const ok = new Set(found.map((n) => n.id));
  for (const id of nodeIds) {
    if (!ok.has(id)) throw new CascadeNodeMissingError(id);
  }
}

export async function listCascades(): Promise<CascadeDto[]> {
  const rows = await prisma.cascade.findMany({
    include: hopInclude,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(mapCascade);
}

export async function getCascade(id: string): Promise<CascadeDto> {
  const c = await prisma.cascade.findUnique({ where: { id }, include: hopInclude });
  if (!c) throw new CascadeNotFoundError(id);
  return mapCascade(c);
}

export async function createCascade(input: CreateCascadeInput): Promise<CascadeDto> {
  const hops = validateCascadeHops(input.hops);
  await assertNodesExist(hops.map((h) => h.nodeId));
  // C2 - pre-generate inter-hop link creds; stored on each non-exit hop.
  const creds = generateLinkCreds(hops.length);
  try {
    const c = await prisma.cascade.create({
      data: {
        name: input.name,
        enabled: input.enabled,
        hops: {
          create: hops.map((h, idx) => ({
            // Nested create uses the checked input -> connect the relation
            // rather than setting the raw nodeId scalar.
            node: { connect: { id: h.nodeId } },
            position: h.position,
            entryProtocol: h.entryProtocol ?? null,
            linkProtocol: h.linkProtocol ?? null,
            // Fresh object literal so it's assignable to Prisma's Json input
            // (a typed LinkCred lacks the index signature Json requires).
            ...(idx < hops.length - 1
              ? { linkConfig: { uuid: creds[idx]!.uuid, port: creds[idx]!.port } }
              : {}),
          })),
        },
      },
      include: hopInclude,
    });
    return mapCascade(c);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CascadeNameTakenError(input.name);
    }
    throw err;
  }
}

export async function updateCascade(id: string, input: UpdateCascadeInput): Promise<CascadeDto> {
  const existing = await prisma.cascade.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new CascadeNotFoundError(id);

  const hops = input.hops ? validateCascadeHops(input.hops) : null;
  if (hops) await assertNodesExist(hops.map((h) => h.nodeId));
  const creds = hops ? generateLinkCreds(hops.length) : [];

  try {
    const c = await prisma.$transaction(async (tx) => {
      await tx.cascade.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });
      if (hops) {
        // Hops are interdependent (positions/protocols), so replace the whole
        // set rather than diffing.
        await tx.cascadeHop.deleteMany({ where: { cascadeId: id } });
        await tx.cascadeHop.createMany({
          // createMany uses the unchecked input, so the raw nodeId scalar is
          // correct here (no relation connect).
          data: hops.map((h, idx) => ({
            cascadeId: id,
            nodeId: h.nodeId,
            position: h.position,
            entryProtocol: h.entryProtocol ?? null,
            linkProtocol: h.linkProtocol ?? null,
            ...(idx < hops.length - 1
              ? { linkConfig: { uuid: creds[idx]!.uuid, port: creds[idx]!.port } }
              : {}),
          })),
        });
      }
      return tx.cascade.findUniqueOrThrow({ where: { id }, include: hopInclude });
    });
    return mapCascade(c);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CascadeNameTakenError(input.name ?? '');
    }
    throw err;
  }
}

export async function deleteCascade(id: string): Promise<void> {
  try {
    await prisma.cascade.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new CascadeNotFoundError(id);
    }
    throw err;
  }
}
