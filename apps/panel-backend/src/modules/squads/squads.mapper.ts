import type { Group, GroupProfile } from '../../generated/prisma/client.js';

export interface PublicSquadDto {
  id: string;
  name: string;
  description: string | null;
  /** Slice 27 — squad ACL operates on profiles, not per-node inbounds. */
  profileIds: string[];
  /** R3-a — per-squad routing-preset override, or null to inherit the panel default. */
  routingPreset: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

type SquadWithRelations = Group & {
  groupProfiles: Pick<GroupProfile, 'profileId'>[];
  _count?: { members: number };
};

export function mapSquadToPublic(squad: SquadWithRelations): PublicSquadDto {
  return {
    id: squad.id,
    name: squad.name,
    description: squad.description,
    profileIds: squad.groupProfiles.map((gp) => gp.profileId),
    routingPreset: squad.routingPreset,
    memberCount: squad._count?.members ?? 0,
    createdAt: squad.createdAt.toISOString(),
    updatedAt: squad.updatedAt.toISOString(),
  };
}
