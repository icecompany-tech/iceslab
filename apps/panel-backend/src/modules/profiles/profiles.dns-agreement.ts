import { prisma } from '../../prisma.js';

/**
 * Two profiles on one node cannot ask for different resolvers.
 *
 * The `dns` section is per PROCESS in every core we render to, while the
 * setting sits on a PROFILE, so a node serving two profiles has one resolver
 * and two opinions about it. The node already refuses such a config rather than
 * picking a winner, which keeps it from silently answering one profile's users
 * through the other's resolver. But that refusal arrives as a failed push, in a
 * worker log, minutes after the save.
 *
 * This is the same rule enforced where the operator can see it: at the save
 * that would create the disagreement.
 */
export class DnsResolverConflictError extends Error {
  constructor(
    public nodeName: string,
    public otherProfile: string,
  ) {
    super(
      `Node "${nodeName}" already serves profile "${otherProfile}" with a different DNS resolver. ` +
        `A node has one resolver for all of its profiles, so either give both the same one or ` +
        `put this profile on another node.`,
    );
    this.name = 'DnsResolverConflictError';
  }
}

/** Canonical form for comparison. The setting carries arrays, so `===` will not
 *  do, and two spellings of the same intent must not read as a conflict. */
function fingerprint(config: unknown): string | null {
  const dns = (config as { dns?: unknown } | null)?.dns;
  if (!dns) return null;
  return JSON.stringify(dns);
}

/**
 * Check the resolver this profile would bring against the ones already on the
 * node. `excludeProfileId` leaves the profile being edited out of its own
 * comparison; otherwise an edit would always find itself.
 */
export async function assertDnsAgreesOnNode(opts: {
  nodeId: string;
  profileId: string;
  config: unknown;
}): Promise<void> {
  const mine = fingerprint(opts.config);
  if (mine === null) return; // no opinion, nothing to disagree with

  const node = await prisma.node.findFirst({
    where: { id: opts.nodeId, deletedAt: null },
    select: { name: true },
  });
  if (!node) return; // the caller raises its own not-found

  const siblings = await prisma.profileNodeBinding.findMany({
    where: {
      nodeId: opts.nodeId,
      enabled: true,
      profileId: { not: opts.profileId },
      profile: { enabled: true, protocol: 'xray' },
    },
    select: { profile: { select: { name: true, config: true } } },
  });

  for (const s of siblings) {
    const theirs = fingerprint(s.profile.config);
    if (theirs === null) continue; // no opinion is not a disagreement
    if (theirs !== mine) {
      throw new DnsResolverConflictError(node.name, s.profile.name);
    }
  }
}

/** Every node this profile is deployed to, for the edit path: changing a
 *  profile's resolver has to be checked against each of them. */
export async function nodeIdsForProfile(profileId: string): Promise<string[]> {
  const rows = await prisma.profileNodeBinding.findMany({
    where: { profileId, enabled: true, node: { deletedAt: null } },
    select: { nodeId: true },
  });
  return [...new Set(rows.map((r) => r.nodeId))];
}
