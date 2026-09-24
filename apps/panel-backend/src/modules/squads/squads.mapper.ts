import type {
  Group,
  GroupProfile,
  GroupHost,
  GroupCascadeExit,
  GroupCascadeOff,
  GroupRoutePolicy,
} from '../../generated/prisma/client.js';

/** A4 increment 2: per-cascade exit allow-list, grouped by cascade for the UI. */
export interface SquadExitAclEntry {
  cascadeId: string;
  exitNodeIds: string[];
}

export interface PublicSquadDto {
  id: string;
  name: string;
  description: string | null;
  /** Slice 27: squad ACL operates on profiles, not per-node inbounds. */
  profileIds: string[];
  /** Which HOSTS of those profiles this squad hands out. EMPTY MEANS ALL, not
   *  none: the list is an opt-in restriction, like `exitAcl`. */
  hostIds: string[];
  /** A4 increment 2: per-cascade allowed exits. A cascade absent = every exit;
   *  an entry with `exitNodeIds: []` = the cascade is off for this squad. */
  exitAcl: SquadExitAclEntry[];
  /** A4 ad-split: extra route-policies granted to this squad. Empty = plain only. */
  policyIds: string[];
  /** R3-a: per-squad routing-preset override, or null to inherit the panel default. */
  routingPreset: string | null;
  /** K7: per-squad HWID device-limit default (applies when user has no explicit limit). */
  hwidDeviceLimit: number | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

type SquadWithRelations = Group & {
  groupProfiles: Pick<GroupProfile, 'profileId'>[];
  groupHosts?: Pick<GroupHost, 'hostId'>[];
  cascadeExits?: Pick<GroupCascadeExit, 'cascadeId' | 'exitNodeId'>[];
  cascadesOff?: Pick<GroupCascadeOff, 'cascadeId'>[];
  routePolicies?: Pick<GroupRoutePolicy, 'policyId'>[];
  _count?: { members: number };
};

/** Group flat (cascadeId, exitNodeId) rows into one entry per cascade, and add
 *  an empty entry for every cascade switched off. */
function groupExitAcl(
  rows: Pick<GroupCascadeExit, 'cascadeId' | 'exitNodeId'>[],
  off: Pick<GroupCascadeOff, 'cascadeId'>[],
): SquadExitAclEntry[] {
  const byCascade = new Map<string, string[]>();
  for (const r of rows) {
    const list = byCascade.get(r.cascadeId);
    if (list) list.push(r.exitNodeId);
    else byCascade.set(r.cascadeId, [r.exitNodeId]);
  }
  // Written together and replaced together, so a cascade cannot be in both;
  // were it ever, "off" wins here as it does in the subscription: less access.
  for (const o of off) byCascade.set(o.cascadeId, []);
  return [...byCascade.entries()].map(([cascadeId, exitNodeIds]) => ({ cascadeId, exitNodeIds }));
}

export function mapSquadToPublic(squad: SquadWithRelations): PublicSquadDto {
  return {
    id: squad.id,
    name: squad.name,
    description: squad.description,
    profileIds: squad.groupProfiles.map((gp) => gp.profileId),
    hostIds: (squad.groupHosts ?? []).map((gh) => gh.hostId),
    exitAcl: groupExitAcl(squad.cascadeExits ?? [], squad.cascadesOff ?? []),
    policyIds: (squad.routePolicies ?? []).map((rp) => rp.policyId),
    routingPreset: squad.routingPreset,
    hwidDeviceLimit: squad.hwidDeviceLimit,
    memberCount: squad._count?.members ?? 0,
    createdAt: squad.createdAt.toISOString(),
    updatedAt: squad.updatedAt.toISOString(),
  };
}
