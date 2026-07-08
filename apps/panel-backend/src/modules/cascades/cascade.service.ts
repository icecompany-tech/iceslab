import type { XrayCascadeFragments } from '@iceslab/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { eventBus } from '../../lib/event-bus.js';
import { validateCascadeHops } from './cascade.validation.js';
import {
  buildCascadeConfigs,
  buildBalancerCascadeConfigs,
  generateLinkCreds,
  normalizeLinkProtocol,
  parseLinkCred,
  serializeLinkCred,
  type CascadeConfigHopInput,
  type LinkCred,
} from './cascade.config.js';
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

// ───── Subscription exposure (cascade leak fix) ─────
//
// A node that is a NON-ENTRY hop (position > 0) of an ENABLED cascade is
// chain-internal: users reach the cascade through the ENTRY node only, so a
// transit/exit node must never be a directly-connectable subscription endpoint
// - otherwise the client bypasses the chain and connects straight to the exit
// (the leak we hit in the field: Happ connecting directly to the DE exit).
// generateSubscription drops these node ids from a user's endpoint list. A node
// that is ALSO an entry of some enabled cascade stays exposed (entries are the
// reachable surface; v1 keeps a node in <=1 cascade, the subtraction is
// defensive). Cached in-process (cascades change rarely) + busted on every
// cascade write.
let hiddenNodesCache: { value: Set<string>; expiresAt: number } | null = null;
const HIDDEN_NODES_TTL_MS = 60_000;

export function invalidateHiddenCascadeNodeCache(): void {
  hiddenNodesCache = null;
}

export async function getHiddenCascadeNodeIds(): Promise<Set<string>> {
  if (hiddenNodesCache && Date.now() < hiddenNodesCache.expiresAt) {
    return hiddenNodesCache.value;
  }
  const hops = await prisma.cascadeHop.findMany({
    where: { cascade: { enabled: true } },
    select: { nodeId: true, position: true },
  });
  const entry = new Set<string>();
  const nonEntry = new Set<string>();
  for (const h of hops) {
    if (h.position === 0) entry.add(h.nodeId);
    else nonEntry.add(h.nodeId);
  }
  for (const id of entry) nonEntry.delete(id);
  hiddenNodesCache = { value: nonEntry, expiresAt: Date.now() + HIDDEN_NODES_TTL_MS };
  return nonEntry;
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

export interface CascadeStatusDto {
  done: boolean;
  nodes: { id: string; name: string; applied: boolean; online: boolean }[];
}

/**
 * Best-effort provisioning status for a cascade. Saving a cascade pushes new
 * inbound config to each hop node asynchronously (cascade.changed ->
 * inbound-sync), so the UI otherwise can't tell when it landed. For each hop we
 * report whether the node has re-reported its status since the cascade was last
 * saved (lastStatusChange > cascade.updatedAt = the node-agent applied the push)
 * and whether it is currently online. Lets the UI resolve a "provisioning..." ->
 * "done / node X not responding" toast after a save.
 */
export async function getCascadeStatus(id: string): Promise<CascadeStatusDto> {
  const c = await prisma.cascade.findUnique({
    where: { id },
    include: {
      hops: {
        orderBy: { position: 'asc' },
        include: { node: { select: { id: true, name: true, status: true, lastStatusChange: true } } },
      },
    },
  });
  if (!c) throw new CascadeNotFoundError(id);
  const since = c.updatedAt;
  const nodes = c.hops.map((h) => ({
    id: h.node.id,
    name: h.node.name,
    applied: !!h.node.lastStatusChange && h.node.lastStatusChange > since,
    online: h.node.status === 'online' || h.node.status === 'connected',
  }));
  return { done: nodes.length > 0 && nodes.every((n) => n.applied), nodes };
}

export async function createCascade(input: CreateCascadeInput): Promise<CascadeDto> {
  const mode = input.mode ?? 'chain';
  const isBalancer = mode === 'balancer';
  // Validate the topology in the effective mode (balancer exits carry no
  // linkProtocol, which the chain rules would wrongly reject).
  const hops = validateCascadeHops(input.hops, mode);
  await assertNodesExist(hops.map((h) => h.nodeId));
  // Pre-generate inter-hop link creds.
  //   chain:    one cred per link, stored on each non-exit (originating) hop.
  //   balancer: one cred per exit link (entry->exit), stored on each EXIT hop;
  //             every link uses the entry hop's linkProtocol (uniform DC-to-DC).
  const creds = generateLinkCreds(
    isBalancer
      ? hops.slice(1).map(() => normalizeLinkProtocol(hops[0]!.linkProtocol))
      : hops.slice(0, hops.length - 1).map((h) => normalizeLinkProtocol(h.linkProtocol)),
  );
  // Cred index for hop `idx`, or -1 if it carries no link cred.
  const credIdx = (idx: number): number =>
    isBalancer ? (idx >= 1 ? idx - 1 : -1) : idx < hops.length - 1 ? idx : -1;
  try {
    const c = await prisma.cascade.create({
      data: {
        name: input.name,
        enabled: input.enabled,
        mode,
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
            ...(credIdx(idx) >= 0
              ? { linkConfig: serializeLinkCred(creds[credIdx(idx)]!) }
              : {}),
          })),
        },
      },
      include: hopInclude,
    });
    // Push the chaining fragments to every hop now, not on some later unrelated
    // edit. inbounds.events re-syncs each node's inbound set, where
    // getCascadeFragmentsForNode injects the link-in/out + routing.
    eventBus.emit('cascade.changed', { nodeIds: hops.map((h) => h.nodeId) });
    invalidateHiddenCascadeNodeCache();
    return mapCascade(c);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CascadeNameTakenError(input.name);
    }
    throw err;
  }
}

export async function updateCascade(id: string, input: UpdateCascadeInput): Promise<CascadeDto> {
  const existing = await prisma.cascade.findUnique({
    where: { id },
    select: { id: true, mode: true, hops: { select: { nodeId: true } } },
  });
  if (!existing) throw new CascadeNotFoundError(id);
  // Capture the pre-update hop nodes: a node dropped from the cascade (or a
  // disable toggle) must also re-push so its now-stale fragments are removed.
  const oldNodeIds = existing.hops.map((h) => h.nodeId);

  // Effective mode: an explicit input.mode wins, else keep the stored one.
  const mode = (input.mode ?? existing.mode) as 'chain' | 'balancer';
  const isBalancer = mode === 'balancer';
  const hops = input.hops ? validateCascadeHops(input.hops, mode) : null;
  if (hops) await assertNodesExist(hops.map((h) => h.nodeId));
  const creds = hops
    ? generateLinkCreds(
        isBalancer
          ? hops.slice(1).map(() => normalizeLinkProtocol(hops[0]!.linkProtocol))
          : hops.slice(0, hops.length - 1).map((h) => normalizeLinkProtocol(h.linkProtocol)),
      )
    : [];
  // Cred index for hop `idx` (of `n` total), or -1 if it carries no link cred.
  const credIdx = (idx: number, n: number): number =>
    isBalancer ? (idx >= 1 ? idx - 1 : -1) : idx < n - 1 ? idx : -1;

  try {
    const c = await prisma.$transaction(async (tx) => {
      await tx.cascade.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.mode !== undefined ? { mode: input.mode } : {}),
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
            ...(credIdx(idx, hops.length) >= 0
              ? { linkConfig: serializeLinkCred(creds[credIdx(idx, hops.length)]!) }
              : {}),
          })),
        });
      }
      return tx.cascade.findUniqueOrThrow({ where: { id }, include: hopInclude });
    });
    // Re-push old + new hops (deduped): old-only nodes drop their fragments,
    // new/kept nodes get the refreshed chain. An enabled-only toggle has no
    // `hops` input, so newNodeIds is empty and we re-push the existing hops.
    const newNodeIds = hops ? hops.map((h) => h.nodeId) : [];
    eventBus.emit('cascade.changed', { nodeIds: [...new Set([...oldNodeIds, ...newNodeIds])] });
    invalidateHiddenCascadeNodeCache();
    return mapCascade(c);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CascadeNameTakenError(input.name ?? '');
    }
    throw err;
  }
}

/**
 * C3 - resolve the xray cascade fragments (link-in inbound, link-out outbound,
 * routing rules) for a node's hop, or null if the node is not part of any
 * enabled cascade. The inbound-sync push injects the result into the node's
 * XrayInboundCfg so the node-agent can chain entry->exit.
 *
 * Link creds are read from each originating hop's persisted linkConfig
 * (generated once at cascade create/update) so the chain stays stable across
 * pushes - regenerating uuids/ports per push would tear down every live link.
 *
 * The `direct` (freedom) outbound that buildCascadeConfigs emits is dropped
 * here: the node's base xray config already ships a `direct` outbound, and two
 * outbounds sharing a tag make xray reject the whole config.
 */
export async function getCascadeFragmentsForNode(
  nodeId: string,
): Promise<XrayCascadeFragments | null> {
  // A node belongs to at most one cascade in the v1 model; first enabled match.
  const member = await prisma.cascadeHop.findFirst({
    where: { nodeId, cascade: { enabled: true } },
    select: { cascadeId: true },
  });
  if (!member) return null;

  const cascade = await prisma.cascade.findUnique({
    where: { id: member.cascadeId },
    include: {
      hops: {
        orderBy: { position: 'asc' },
        include: { node: { select: { id: true, address: true } } },
      },
    },
  });
  // A single-hop "cascade" has no links to build - treat as not-a-cascade.
  if (!cascade || cascade.hops.length < 2) return null;

  const hopInputs: CascadeConfigHopInput[] = cascade.hops.map((h) => ({
    nodeId: h.nodeId,
    position: h.position,
    // Public host the previous hop dials. node.address is host[:agentPort];
    // the link binds its own port (cred.port), so strip any agent port.
    nodeHost: h.node.address.split(':')[0]!,
  }));

  // C3-auto: a `balancer` cascade fans one entry out to N parallel exits. The
  // link creds live on the EXIT hops (hops[1..]); the entry dials each. The
  // entry's fragments carry the observatory + balancer; each exit terminates its
  // own link. The `direct` outbound is dropped (the node ships its own).
  if (cascade.mode === 'balancer') {
    const exitCreds: LinkCred[] = [];
    for (const eh of cascade.hops.slice(1)) {
      const cred = parseLinkCred(eh.linkConfig);
      // Malformed/missing cred (data drift): ship nothing rather than a
      // half-wired auto node that blackholes user traffic.
      if (!cred) return null;
      exitCreds.push(cred);
    }
    const configs = buildBalancerCascadeConfigs(hopInputs[0]!, hopInputs.slice(1), exitCreds);
    const mine = configs.find((c) => c.nodeId === nodeId);
    if (!mine) return null;
    return {
      inbounds: mine.inbounds,
      outbounds: mine.outbounds.filter((o) => o.tag !== 'direct'),
      routingRules: mine.routingRules,
      linkIngressPort: mine.linkIngressPort,
      linkAllowFrom: mine.linkAllowFrom,
      observatory: mine.observatory,
      balancers: mine.balancers,
    };
  }

  // Rebuild link creds from each originating hop's persisted linkConfig.
  // Hops are position-sorted; hops[0..n-2] each carry one linkConfig.
  const linkCreds: LinkCred[] = [];
  for (let i = 0; i < cascade.hops.length - 1; i++) {
    const cred = parseLinkCred(cascade.hops[i]!.linkConfig);
    if (!cred) {
      // Malformed/missing cred (data drift) - safer to ship no cascade than a
      // half-wired chain that silently blackholes user traffic.
      return null;
    }
    linkCreds.push(cred);
  }

  const configs = buildCascadeConfigs(hopInputs, linkCreds);
  const mine = configs.find((c) => c.nodeId === nodeId);
  if (!mine) return null;

  return {
    inbounds: mine.inbounds,
    outbounds: mine.outbounds.filter((o) => o.tag !== 'direct'),
    routingRules: mine.routingRules,
    // Carry the link port + peer address so the node-agent can open UFW for the
    // inter-hop link itself (was a manual `ufw allow from <entry-ip>` step).
    linkIngressPort: mine.linkIngressPort,
    linkAllowFrom: mine.linkAllowFrom,
  };
}

export async function deleteCascade(id: string): Promise<void> {
  // Grab the hop nodes before deleting so we can re-push them afterwards to
  // strip the cascade fragments from their live xray config.
  const existing = await prisma.cascade.findUnique({
    where: { id },
    select: { hops: { select: { nodeId: true } } },
  });
  try {
    await prisma.cascade.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new CascadeNotFoundError(id);
    }
    throw err;
  }
  if (existing && existing.hops.length > 0) {
    eventBus.emit('cascade.changed', { nodeIds: existing.hops.map((h) => h.nodeId) });
  }
  invalidateHiddenCascadeNodeCache();
}
