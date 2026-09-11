import { prisma } from '../../prisma.js';

/**
 * What a new key pair on a profile would cost, counted rather than guessed.
 *
 * Regenerating a profile's key is not a field edit: the key is shared by every
 * host of every binding, so it is a fleet-wide event with no undo, and every
 * config already in a subscriber's client stops authenticating the moment the
 * nodes take the new one. The panel warns before the button is pressed, but the
 * one number that says how much it costs, how many client configs die, was left
 * empty with an honest note: the frontend can count hosts and nodes from lists
 * it already holds, and cannot reach the subscriber side at all.
 *
 * That number is a question about squad ACL, which is why it belongs here.
 */
export interface ProfileKeyImpactDto {
  /** Enabled hosts of enabled bindings: each one hands the key out. */
  hosts: number;
  /** Distinct nodes to rebuild and restart. One node can carry several
   *  bindings of the same profile on different ports, and it is one rebuild. */
  nodes: number;
  bindings: number;
  /** Subscribers currently holding at least one config from this profile. */
  users: number;
  /** Client configs that stop working. Not users x hosts: a squad may narrow
   *  its handout to some of the hosts (GroupHost), and a user in two squads
   *  sees the union of theirs, so the count is folded per user. */
  configs: number;
}

export async function getProfileKeyImpact(
  profileId: string,
): Promise<ProfileKeyImpactDto | null> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { id: true },
  });
  if (!profile) return null;

  // Only what actually serves: a disabled binding, a disabled host or a
  // soft-deleted node hands nothing out, so a key change costs them nothing.
  const bindings = await prisma.profileNodeBinding.findMany({
    where: { profileId, enabled: true, node: { deletedAt: null } },
    select: {
      nodeId: true,
      hosts: { where: { enabled: true }, select: { id: true } },
    },
  });

  const hostIds = new Set(bindings.flatMap((b) => b.hosts.map((h) => h.id)));
  const nodes = new Set(bindings.map((b) => b.nodeId));

  // Squads that grant this profile, with what each of them narrows to and who
  // is in it. A squad with no GroupHost rows hands out every host of its
  // profiles: that is the opt-in rule the whole ACL uses, "no rows" means no
  // restriction, not an empty set.
  const groups = await prisma.group.findMany({
    where: { groupProfiles: { some: { profileId } } },
    select: {
      groupHosts: { select: { hostId: true } },
      members: {
        where: { user: { deletedAt: null } },
        select: { userId: true },
      },
    },
  });

  const perUser = new Map<string, Set<string>>();
  for (const g of groups) {
    const narrowed = g.groupHosts.length > 0;
    const visible = narrowed
      ? g.groupHosts.map((h) => h.hostId).filter((id) => hostIds.has(id))
      : [...hostIds];
    if (visible.length === 0) continue;
    for (const m of g.members) {
      const acc = perUser.get(m.userId) ?? new Set<string>();
      for (const id of visible) acc.add(id);
      perUser.set(m.userId, acc);
    }
  }

  let configs = 0;
  for (const set of perUser.values()) configs += set.size;

  return {
    hosts: hostIds.size,
    nodes: nodes.size,
    bindings: bindings.length,
    users: perUser.size,
    configs,
  };
}
