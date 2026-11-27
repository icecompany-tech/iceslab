import { eventBus } from '../../lib/infra/event-bus.js';
import { prisma } from '../../prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import { isUniqueViolationOn } from '../../lib/util/unique-violation.js';
import { ALL_SQUAD_ID } from './squads.constants.js';
import type { CreateSquadInput, ReorderSquadsInput, UpdateSquadInput } from './squads.schemas.js';
import { mapSquadToPublic, type PublicSquadDto } from './squads.mapper.js';
import {
  assertCustomPresetExists,
  presetUpdateData,
  rethrowPresetGone,
} from '../routing-presets/routing-presets.assign.js';

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

export class SquadOrderConflictError extends Error {
  constructor(public ids: string[]) {
    super('Squad order changed. Reload it before trying again.');
    this.name = 'SquadOrderConflictError';
  }
}

// ───── Service methods ─────

// Soft-deleted users still keep their `group_members` rows (we only flip
// `users.deletedAt`, the join row stays for restore-ability). So the naive
// `_count: { members: true }` over-counts. Filter to live users only.
const includeRelations = {
  groupProfiles: { select: { profileId: true } },
  groupHosts: { select: { hostId: true } },
  cascadeExits: {
    select: {
      cascadeId: true,
      directionId: true,
      exitNodeId: true,
      // For the exitNodeIds the old screen still reads: a direction row
      // answers with its CURRENT pool.
      direction: { select: { nodes: { select: { nodeId: true } } } },
    },
  },
  cascadesOff: { select: { cascadeId: true } },
  routePolicies: { select: { policyId: true } },
  _count: {
    select: {
      members: { where: { user: { deletedAt: null } } },
    },
  },
} as const;

/** A-149: an exitAcl entry that names something the cascade does not have. */
export class SquadExitAclError extends Error {
  readonly code = 'EXIT_ACL_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'SquadExitAclError';
  }
}

type ExitAclInput = { cascadeId: string; directionIds?: string[]; exitNodeIds?: string[] }[];
type ExitRow = { groupId: string; cascadeId: string; directionId: string | null; exitNodeId: string | null };

const givenList = (e: ExitAclInput[number]): string[] => e.directionIds ?? e.exitNodeIds ?? [];

/**
 * The allow rows an exitAcl stands for, keyed by DIRECTION (A-149).
 *
 * `directionIds` are checked to belong to the cascade. `exitNodeIds` (the
 * screen that has not moved yet) become every direction whose pool holds one
 * of them, which is exactly what that screen meant: it ticked the nodes it
 * showed under a direction. A node under no direction is refused rather than
 * dropped: dropping it could leave the entry with no rows, and no rows reads
 * as "every exit". A cascade with no directions (the legacy hop shape) has
 * nothing to key by and keeps node rows.
 *
 * An entry whose list is empty is the cascade switched OFF, stored in its own
 * table (offRows).
 */
async function exitAclRows(groupId: string, exitAcl: ExitAclInput): Promise<ExitRow[]> {
  const live = exitAcl.filter((e) => givenList(e).length > 0);
  if (live.length === 0) return [];
  /**
   * A-134: narrowing the ways out of a cascade entered through hysteria or
   * AmneziaWG is refused. Such an entry hands every user to the chain as one
   * socks user (hysteria) or by its interface (AWG), the chain picks the way
   * out, and nothing on the node can tell one squad's users from another's:
   * the narrowing would be words on the squad screen and nothing on the node.
   * Switching such a cascade off for a squad (an empty list) stays allowed.
   */
  const throughChain = await prisma.cascadePosition.findMany({
    where: {
      position: 0,
      cascadeId: { in: live.map((e) => e.cascadeId) },
      entryProtocol: { in: ['hysteria', 'amneziawg'] },
    },
    select: { entryProtocol: true, cascade: { select: { name: true } } },
  });
  if (throughChain.length > 0) {
    const c = throughChain[0]!;
    throw new SquadExitAclError(
      `cascade "${c.cascade.name}" is entered through ${c.entryProtocol}, which hands every user to the chain ` +
        `without telling them apart, so its ways out cannot be narrowed for a squad. Switch the cascade on or off ` +
        `for the squad instead.`,
    );
  }
  const directions = await prisma.cascadeDirection.findMany({
    where: { cascadeId: { in: live.map((e) => e.cascadeId) } },
    select: { id: true, cascadeId: true, nodes: { select: { nodeId: true } } },
  });
  const rows: ExitRow[] = [];
  for (const e of live) {
    const own = directions.filter((d) => d.cascadeId === e.cascadeId);
    if (e.directionIds !== undefined) {
      for (const id of new Set(e.directionIds)) {
        if (!own.some((d) => d.id === id)) {
          throw new SquadExitAclError(`direction ${id} is not a direction of cascade ${e.cascadeId}`);
        }
        rows.push({ groupId, cascadeId: e.cascadeId, directionId: id, exitNodeId: null });
      }
      continue;
    }
    const nodeIds = [...new Set(e.exitNodeIds ?? [])];
    if (own.length === 0) {
      for (const n of nodeIds) rows.push({ groupId, cascadeId: e.cascadeId, directionId: null, exitNodeId: n });
      continue;
    }
    const picked = new Set<string>();
    for (const n of nodeIds) {
      const under = own.filter((d) => d.nodes.some((x) => x.nodeId === n));
      if (under.length === 0) {
        throw new SquadExitAclError(`node ${n} is in no direction of cascade ${e.cascadeId}`);
      }
      for (const d of under) picked.add(d.id);
    }
    for (const id of picked) rows.push({ groupId, cascadeId: e.cascadeId, directionId: id, exitNodeId: null });
  }
  return rows;
}

function offRows(groupId: string, exitAcl: ExitAclInput): { groupId: string; cascadeId: string }[] {
  return exitAcl.filter((e) => givenList(e).length === 0).map((e) => ({ groupId, cascadeId: e.cascadeId }));
}

const squadOrder = [
  { displayOrder: 'asc' },
  { id: 'asc' },
] satisfies Prisma.GroupOrderByWithRelationInput[];

async function lockSquadOrder(tx: Prisma.TransactionClient): Promise<void> {
  // Serialize order writers and inserts/deletes, including writers that do
  // not use this service. Ordinary list and subscription reads can continue.
  await tx.$executeRaw`LOCK TABLE "groups" IN SHARE ROW EXCLUSIVE MODE`;
}

function sameSquadOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export async function reorderSquads({ expectedIds, ids }: ReorderSquadsInput): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await lockSquadOrder(tx);
    const current = (await tx.group.findMany({ select: { id: true }, orderBy: squadOrder }))
      .map(({ id }) => id);
    // A retry after a committed write already has the requested result.
    if (sameSquadOrder(current, ids)) return current;
    if (!sameSquadOrder(current, expectedIds)) throw new SquadOrderConflictError(current);

    // One update, and only display order. Keep timestamps and grants intact.
    await tx.$executeRaw`
      UPDATE "groups" AS squad
      SET "display_order" = desired.position::integer
      FROM unnest(ARRAY[${Prisma.join(ids)}]::uuid[]) WITH ORDINALITY AS desired(id, position)
      WHERE squad.id = desired.id AND squad.display_order <> desired.position
    `;
    return ids;
  });
}

export async function listSquads(): Promise<PublicSquadDto[]> {
  const rows = await prisma.group.findMany({
    include: includeRelations,
    orderBy: squadOrder,
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
  // Resolved before the write: a refusal must not leave half a squad.
  const exitRows = await exitAclRows('', input.exitAcl);
  await assertCustomPresetExists(input.customRoutingPresetId);

  const row = await prisma.$transaction(async (tx) => {
    await lockSquadOrder(tx);
    return tx.group.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        routingPreset: input.routingPreset ?? null,
        // A-229 - or an own preset (the schema refused both at once).
        ...(input.customRoutingPresetId
          ? { customRoutingPreset: { connect: { id: input.customRoutingPresetId } } }
          : {}),
        hwidDeviceLimit: input.hwidDeviceLimit ?? null,
        groupProfiles: {
          create: input.profileIds.map((profileId) => ({ profileId })),
        },
        // Opt-in narrowing: an empty list means every host of the granted
        // profiles, which is what a squad has always done.
        groupHosts: {
          create: input.hostIds.map((hostId) => ({ hostId })),
        },
        cascadeExits: {
          create: exitRows.map((r) => ({
            cascade: { connect: { id: r.cascadeId } },
            ...(r.directionId ? { direction: { connect: { id: r.directionId } } } : {}),
            ...(r.exitNodeId ? { node: { connect: { id: r.exitNodeId } } } : {}),
          })),
        },
        cascadesOff: {
          create: offRows('', input.exitAcl).map((o) => ({ cascade: { connect: { id: o.cascadeId } } })),
        },
        routePolicies: {
          create: input.policyIds.map((policyId) => ({ policy: { connect: { id: policyId } } })),
        },
      },
      include: includeRelations,
    });
  }).catch((err: unknown) => {
    // The check above is read-then-insert: a create racing it loses here.
    if (isUniqueViolationOn(err, 'groups_name_key', ['name'])) throw new SquadAlreadyExistsError(input.name);
    return rethrowPresetGone(err, input.customRoutingPresetId);
  });
  eventBus.emit('squad.changed', { squadId: row.id });
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

  const exitRows = input.exitAcl !== undefined ? await exitAclRows(id, input.exitAcl) : [];
  const presetFields = presetUpdateData(input);
  await assertCustomPresetExists(presetFields.customRoutingPresetId);

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
    // Replace the host allow-list. An EMPTY array is meaningful here and is
    // not the same as omitting the field: it clears the restriction, putting
    // the squad back to every host of its profiles.
    if (input.hostIds !== undefined) {
      await tx.groupHost.deleteMany({ where: { groupId: id } });
      if (input.hostIds.length > 0) {
        await tx.groupHost.createMany({
          data: input.hostIds.map((hostId) => ({ groupId: id, hostId })),
        });
      }
    }
    // A4 increment 2: replace the exit allow-list (set semantics), same as
    // profiles. Both tables together: they are one list on the API, and a
    // cascade moving from "off" to "these exits" must not end up as both.
    if (input.exitAcl !== undefined) {
      await tx.groupCascadeExit.deleteMany({ where: { groupId: id } });
      await tx.groupCascadeOff.deleteMany({ where: { groupId: id } });
      if (exitRows.length > 0) {
        await tx.groupCascadeExit.createMany({ data: exitRows });
      }
      const off = offRows(id, input.exitAcl);
      if (off.length > 0) {
        await tx.groupCascadeOff.createMany({ data: off });
      }
    }
    // A4 ad-split: replace the route-policy grant set (set semantics).
    if (input.policyIds !== undefined) {
      await tx.groupRoutePolicy.deleteMany({ where: { groupId: id } });
      if (input.policyIds.length > 0) {
        await tx.groupRoutePolicy.createMany({
          data: input.policyIds.map((policyId) => ({ groupId: id, policyId })),
        });
      }
    }
    return tx.group.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        // R3-a + A-229: one preset, a built-in key or an own one; a value on
        // one side clears the other (presetUpdateData).
        ...presetFields,
        ...(input.hwidDeviceLimit !== undefined ? { hwidDeviceLimit: input.hwidDeviceLimit } : {}),
      },
      include: includeRelations,
    });
  }).catch((err: unknown) => {
    // A rename racing the check above (A-257).
    if (input.name !== undefined && isUniqueViolationOn(err, 'groups_name_key', ['name'])) {
      throw new SquadAlreadyExistsError(input.name);
    }
    return rethrowPresetGone(err, presetFields.customRoutingPresetId);
  });

  // A squad edit changes what its members are handed, and the binding cache is
  // keyed by squad SET rather than by contents, so nothing else would notice.
  eventBus.emit('squad.changed', { squadId: id });
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
