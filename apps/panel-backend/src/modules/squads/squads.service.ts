import { prisma } from '../../prisma.js';
import { ALL_SQUAD_ID } from './squads.constants.js';
import type { CreateSquadInput, UpdateSquadInput } from './squads.schemas.js';
import { mapSquadToPublic, type PublicSquadDto } from './squads.mapper.js';

// ───── Domain errors ─────

export class SquadNotFoundError extends Error {
  constructor(public id: string) {
    super(`Squad ${id} not found`);
    this.name = 'SquadNotFoundError';
  }
}

export class SquadAlreadyExistsError extends Error {
  constructor(public name: string) {
    super(`Squad "${name}" already exists`);
    this.name = 'SquadAlreadyExistsError';
  }
}

export class SquadProtectedError extends Error {
  constructor() {
    super('The "All" squad is system-managed and cannot be modified or deleted');
    this.name = 'SquadProtectedError';
  }
}

// ───── Service methods ─────

// Soft-deleted users still keep their `group_members` rows (we only flip
// `users.deletedAt`, the join row stays for restore-ability). So the naive
// `_count: { members: true }` over-counts. Filter to live users only.
const includeRelations = {
  groupProfiles: { select: { profileId: true } },
  _count: {
    select: {
      members: { where: { user: { deletedAt: null } } },
    },
  },
} as const;

export async function listSquads(): Promise<PublicSquadDto[]> {
  const rows = await prisma.group.findMany({
    include: includeRelations,
    orderBy: [{ createdAt: 'asc' }],
  });
  return rows.map(mapSquadToPublic);
}

export async function getSquadById(id: string): Promise<PublicSquadDto> {
  const row = await prisma.group.findUnique({
    where: { id },
    include: includeRelations,
  });
  if (!row) throw new SquadNotFoundError(id);
  return mapSquadToPublic(row);
}

export async function createSquad(input: CreateSquadInput): Promise<PublicSquadDto> {
  const existing = await prisma.group.findUnique({ where: { name: input.name } });
  if (existing) throw new SquadAlreadyExistsError(input.name);

  const row = await prisma.group.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      routingPreset: input.routingPreset ?? null,
      hwidDeviceLimit: input.hwidDeviceLimit ?? null,
      groupProfiles: {
        create: input.profileIds.map((profileId) => ({ profileId })),
      },
    },
    include: includeRelations,
  });
  return mapSquadToPublic(row);
}

export async function updateSquad(
  id: string,
  input: UpdateSquadInput,
): Promise<PublicSquadDto> {
  // The "All" squad is system-managed: it auto-tracks every profile (the
  // profile.created handler attaches new profiles to it). Admins can't rename
  // it, can't change its profile set, can't blow it away. Everything else
  // about a user's view-of-the-world depends on this squad existing with its
  // known UUID.
  if (id === ALL_SQUAD_ID) throw new SquadProtectedError();

  const existing = await prisma.group.findUnique({ where: { id } });
  if (!existing) throw new SquadNotFoundError(id);

  if (input.name && input.name !== existing.name) {
    const dupe = await prisma.group.findUnique({ where: { name: input.name } });
    if (dupe) throw new SquadAlreadyExistsError(input.name);
  }

  // Profile set replacement, done via tx so concurrent updates can't leave
  // half-applied state. Wipe the join rows, write the new ones.
  const row = await prisma.$transaction(async (tx) => {
    if (input.profileIds !== undefined) {
      await tx.groupProfile.deleteMany({ where: { groupId: id } });
      if (input.profileIds.length > 0) {
        await tx.groupProfile.createMany({
          data: input.profileIds.map((profileId) => ({ groupId: id, profileId })),
        });
      }
    }
    return tx.group.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.routingPreset !== undefined ? { routingPreset: input.routingPreset } : {}),
        ...(input.hwidDeviceLimit !== undefined ? { hwidDeviceLimit: input.hwidDeviceLimit } : {}),
      },
      include: includeRelations,
    });
  });

  return mapSquadToPublic(row);
}

export async function deleteSquad(id: string): Promise<void> {
  if (id === ALL_SQUAD_ID) throw new SquadProtectedError();
  const existing = await prisma.group.findUnique({ where: { id } });
  if (!existing) throw new SquadNotFoundError(id);

  // Cascade is on for both group_profiles and group_members (see schema).
  // Users who lose their last squad would be invisible to subscription,
  // backstop them into "All" so they don't end up with empty subs.
  await prisma.$transaction(async (tx) => {
    const orphanedUserIds = await tx.groupMember
      .findMany({
        where: { groupId: id },
        select: { userId: true },
      })
      .then((rows) => rows.map((r) => r.userId));

    await tx.group.delete({ where: { id } });

    if (orphanedUserIds.length === 0) return;

    // Find users whose only group was the one we just deleted.
    const remaining = await tx.groupMember.findMany({
      where: { userId: { in: orphanedUserIds } },
      select: { userId: true },
    });
    const stillHaveAGroup = new Set(remaining.map((r) => r.userId));
    const reallyOrphaned = orphanedUserIds.filter((id) => !stillHaveAGroup.has(id));

    if (reallyOrphaned.length > 0) {
      await tx.groupMember.createMany({
        data: reallyOrphaned.map((userId) => ({ groupId: ALL_SQUAD_ID, userId })),
        skipDuplicates: true,
      });
    }
  });
}
