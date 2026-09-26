import {
  LINK_CELL_ENGINES,
  LINK_CELL_TRANSPORT,
  type ChainStatus,
  type ChainTunnel,
  type ChainUserCore,
  type LinkCongestion,
  type NodeChain,
  type NodeCores,
  type Transport,
  type XrayCascadeFragments,
} from '@iceslab/shared';
import { cascadeAutoProfileLabel, cascadeProfileLabel } from '../../lib/util/country-flag.js';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { xrayGeoEntry } from '../geo-sets/geo-refs.js';
import { chainPoliciesOf } from './chain-policy.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { getLogger } from '../../lib/infra/logger.js';
import {
  CascadeValidationError,
  entryReachesCascadeOnlyThroughChain,
  foldPositionsIntoHops,
  validateCascadeHops,
  validateCascadeTopology,
} from './cascade.validation.js';
import {
  autoRouteTag,
  buildCascadeConfigs,
  buildBalancerCascadeConfigs,
  buildTopologyFragmentsForNode,
  generateLinkCreds,
  LINK_PORT_BASE,
  generateTopologyLinks,
  normalizeLinkProtocol,
  parseLinkCred,
  routeTag,
  serializeLinkCred,
  topologyLinkKey,
  topologyReceivingCells,
  topologyReceivingPorts,
  type CascadeConfigHopInput,
  type CascadePolicy,
  type HopConfig,
  type LinkCred,
  type TopologyInput,
  type TopologyLinkRow,
} from './cascade.config.js';
import type {
  CascadeDirectionInput,
  CascadeHopInput,
  CascadePositionInput,
  CreateCascadeInput,
  UpdateCascadeInput,
} from './cascade.schemas.js';
import { mapCascade, type CascadeDto } from './cascade.mapper.js';
import { renderChainConfig, type ChainRenderInput, type ChainRole } from './chain.config.js';
import { CHAIN_TPROXY_PORT, chainSocksPort, chainSocksUser, chainTProxyMark } from './chain.ports.js';
import { chainSecretFor } from '../nodes/chain-secret.js';
import { canRunChainAtSave, carriesCellAtSave, chainEngineOf } from './cell-carriage.js';
import {
  matchStoredDirections,
  resolveDirections,
  storedLinkParams,
  type LegParams,
  type ResolvedDirection,
} from './direction-merge.js';
import { isConfigApplied } from '../nodes/nodes.sync-status.js';
import {
  freeTunnelIndexes,
  legUnderlay,
  linkInListen,
  newTunnelCred,
  parseTunnelCred,
  renderTunnelConf,
  topologyTunnelPairs,
  tunnelAddresses,
  tunnelIface,
  tunnelPort,
  type TopologyTunnel,
} from './cascade-tunnel.js';
import { portOwnersOnNode } from '../nodes/node-ports.js';

export class CascadeNotFoundError extends Error {
  constructor(id: string) {
    super(`Cascade ${id} not found`);
    this.name = 'CascadeNotFoundError';
  }
}

/**
 * A way out cannot be removed while a node policy still routes through it.
 *
 * Refused at the save, where the operator is looking at the cascade, rather
 * than silently dropping the rule: a rule vanishing as a side effect of editing
 * something else changes what a node does with traffic, and nothing would say
 * so. Names the policies so the next step is obvious.
 */
export class DirectionInUseByPolicyError extends Error {
  constructor(public policyNames: string[]) {
    super(
      `This way out is used by a node policy (${policyNames.join(', ')}). ` +
        `Remove the rule there first, or the nodes running it would lose the route.`,
    );
    this.name = 'DirectionInUseByPolicyError';
  }
}
export class CascadeNameTakenError extends Error {
  constructor(name: string) {
    super(`Cascade name "${name}" is already in use`);
    this.name = 'CascadeNameTakenError';
  }
}
/** Phase 9.3: the entry policy names a route policy that is not there (never
 *  was, or was deleted since the screen loaded). 400 ENTRY_POLICY_NOT_FOUND. */
export class CascadeEntryPolicyNotFoundError extends Error {
  readonly code = 'ENTRY_POLICY_NOT_FOUND';
  constructor(public policyId: string) {
    super(`Route policy ${policyId} does not exist, so it cannot be this cascade's entry policy`);
    this.name = 'CascadeEntryPolicyNotFoundError';
  }
}

/** A given entry policy must exist; absent and null need no check. */
async function assertEntryPolicyExists(policyId: string | null | undefined): Promise<void> {
  if (!policyId) return;
  const found = await prisma.routePolicy.findUnique({ where: { id: policyId }, select: { id: true } });
  if (!found) throw new CascadeEntryPolicyNotFoundError(policyId);
}
export class CascadeNodeMissingError extends Error {
  constructor(
    public nodeId: string,
    /** Where in the payload it was named, e.g. `direction "NL"`. Empty when
     *  the caller had no place to attach it to. */
    public where = '',
  ) {
    super(
      where
        ? `${where} points at node ${nodeId}, which does not exist (deleted?). ` +
            `Remove it there and save again: a cascade that names a node the panel cannot ` +
            `find stops receiving config on every one of its nodes, not just this one.`
        : `Node ${nodeId} does not exist`,
    );
    this.name = 'CascadeNodeMissingError';
  }
}

/**
 * A leg of this cascade would land on a port a profile already listens on.
 *
 * The mirror image of PortHeldByCascadeError, and both halves are needed: the
 * pair that collides lives in two tables, no index spans them, so whichever
 * save happens second has to ask about the other. A cascade picks its ports
 * automatically, so the operator cannot fix this from the cascade screen, and
 * the message says which profile to move instead.
 */
export class CascadeLinkPortInUseError extends Error {
  constructor(
    public conflicts: { nodeName: string; port: number; transport: Transport; profileName: string }[],
  ) {
    super(
      `The inter-hop link ports this cascade needs are already taken: ` +
        conflicts
          .map(
            (c) =>
              // The transport is reported, not assumed: since phase 5 a leg can
              // be QUIC, and "24000/TCP" about a tuic leg would send the
              // operator looking at the wrong listener.
              `node "${c.nodeName}" port ${c.port}/${c.transport.toUpperCase()} ` +
              `(profile "${c.profileName}")`,
          )
          .join('; ') +
        `. Link ports are assigned automatically from 24000 up; move those profiles to ` +
        `another port and save again.`,
    );
    this.name = 'CascadeLinkPortInUseError';
  }
}

/**
 * Which node listens on which link port, for the legacy hop storage.
 *
 * The cred on hop[i] is DIALLED by hop[i] and LISTENED ON by hop[i+1], and a
 * balancer's cred sits on the exit that listens on it: in position order both
 * come out as "the hop after the one that holds the cred", because a
 * balancer's exits are exactly hops[1..]. One mapping, not two.
 */
function receivingLinkPorts(
  hops: { nodeId: string }[],
  creds: LinkCred[],
): { nodeId: string; port: number; transport: Transport }[] {
  return hops
    .slice(1)
    .map((h, i) =>
      creds[i]
        ? {
            nodeId: h.nodeId,
            port: creds[i]!.port,
            // From the cred's own cell. The legacy storage only ever holds
            // vless and SS2022, so this is tcp today and reads it rather than
            // saying it: the day a QUIC cell folds into hops, a constant here
            // would be a silent lie about which socket is taken.
            transport: LINK_CELL_TRANSPORT[creds[i]!.protocol],
          }
        : null,
    )
    .filter((x): x is { nodeId: string; port: number; transport: Transport } => x !== null);
}

/**
 * Refuse before writing, and ask about EVERY leg rather than the first.
 *
 * A cascade is saved whole: refusing one leg at a time would walk an operator
 * through as many saves as it has hops, each one looking like a new problem.
 *
 * Both storages are asked, because a cascade is saved into both: the legacy
 * hops carry their ports in creds computed by the caller, the v4 topology
 * computes them from the shape (positions and directions) without minting
 * creds for a save that may be about to be refused.
 */
async function assertLinkPortsFree(
  fromHops: { nodeId: string; port: number; transport: Transport }[],
  positions?: { nodeIds: string[]; linkProtocol?: string | null }[],
  directions?: { nodeIds: string[]; linkProtocol?: string | null }[],
): Promise<void> {
  const wanted = [
    ...fromHops,
    ...(positions && directions ? topologyReceivingPorts(positions, directions) : []),
  ];
  if (wanted.length === 0) return;

  // Keyed by node AND transport since phase 5: a QUIC leg and a TCP leg can
  // want the same port number on one node and take two different sockets, so
  // asking once per number would compare a udp leg against a tcp profile.
  const byNode = new Map<string, Map<Transport, Set<number>>>();
  for (const w of wanted) {
    const perTransport = byNode.get(w.nodeId) ?? new Map<Transport, Set<number>>();
    const set = perTransport.get(w.transport) ?? new Set<number>();
    set.add(w.port);
    perTransport.set(w.transport, set);
    byNode.set(w.nodeId, perTransport);
  }

  const conflicts: {
    nodeName: string;
    port: number;
    transport: Transport;
    profileName: string;
  }[] = [];
  for (const [nodeId, perTransport] of byNode) {
    for (const [transport, ports] of perTransport) {
    const owners = await portOwnersOnNode(nodeId, [...ports]);
    // Profiles only, and deliberately: a core service holding 24000 is not
    // something the operator can move, so refusing their cascade over it would
    // be a dead end. That case belongs to the port check, which says who holds
    // what, rather than to a refusal with no remedy.
    //
    // The transport is the LEG's, not a constant: a hysteria2 profile on
    // 24000/UDP and a vless leg on 24000/TCP are two listeners, and this check
    // used to refuse that pair.
    const taken = owners.filter((o) => o.kind === 'profile' && o.transport === transport);
    if (taken.length === 0) continue;
    const node = await prisma.node.findUnique({
      where: { id: nodeId },
      select: { name: true },
    });
    for (const t of taken) {
      // Narrowed by the filter above, and re-stated for the compiler: only a
      // profile owner carries a name, which is the whole point of the union.
      if (t.kind !== 'profile') continue;
      conflicts.push({
        nodeName: node?.name ?? nodeId,
        port: t.port,
        transport,
        profileName: t.name,
      });
    }
    }
  }
  if (conflicts.length > 0) throw new CascadeLinkPortInUseError(conflicts);
}

/**
 * A leg of this cascade would land on a node that cannot terminate its cell.
 *
 * Phase 5 let a direction choose the cell of the leg that reaches it, and two
 * of the four cells exist only inside the chain process. A node whose reported
 * engines are xray and nothing else ends a vless or a shadowsocks leg inside
 * that xray, as it always has, and has never ended a QUIC one: saving such a
 * pair would draw a config the node refuses, hours later, in a journal.
 *
 * Every blocked node is named, not the first, for the same reason the port
 * refusal names every conflict: a cascade is saved whole, and one refusal per
 * leg walks the operator through as many saves as it has exits.
 *
 * The engines are carried out with it because they are what the refusal rests
 * on. "This node cannot receive an hy2 leg" with nothing beside it is a rule
 * the operator can only obey; with the list, it is a fact they can check.
 */
export class CascadeCellNotCarriedError extends Error {
  readonly code = 'CELL_NOT_CARRIED';
  constructor(public conflicts: { nodeName: string; cell: string; engines: string[]; chainEngine?: string }[]) {
    super(
      `Some nodes of this cascade cannot terminate the link cell chosen for them: ` +
        conflicts
          .map((c) =>
            // E46: an agent that carries legs through its chain process alone
            // needs that engine whatever the cell; the cell is not the problem.
            c.chainEngine
              ? `node "${c.nodeName}" has no ${c.chainEngine === 'singbox' ? 'sing-box' : c.chainEngine}, ` +
                `and its agent carries every leg through the chain process, which runs it`
              : `node "${c.nodeName}" would receive a ${c.cell} leg but reports ` +
                (c.engines.length > 0 ? `only ${c.engines.join(', ')}` : 'no engines'),
          )
          .join('; ') +
        `. The chain process that carries the legs is sing-box: install sing-box on those ` +
        `nodes (bootstrap-singbox.sh from the node page), or, on a node with an older agent, ` +
        `choose vless or shadowsocks, which its xray can end.`,
    );
    this.name = 'CascadeCellNotCarriedError';
  }
}

/**
 * Refuse before writing, by FACT, and ask about every leg rather than the first.
 *
 * The three answers and what each is worth are in `carriesCellAtSave`. What
 * belongs here is the shape of the question: the walk is over RECEIVING sides,
 * because the cell is terminated where the leg lands, and the nodes are read in
 * one query because a cascade with a pool on every step asks about the same
 * handful of machines many times over.
 *
 * Silent on a fleet that reports nothing, which is most of it today. That is
 * the honest order, the same one the profile gate took: it can only refuse what
 * a node has actually said about itself.
 */
async function assertNodesCarryCells(
  positions?: { position?: number; nodeIds: string[]; linkProtocol?: string | null }[],
  directions?: { nodeIds: string[]; linkProtocol?: string | null }[],
): Promise<void> {
  if (!positions || !directions) return;
  const wanted = topologyReceivingCells(positions, directions);
  if (wanted.length === 0) return;
  // Every node of the cascade, not only the receiving ones: on an agent that
  // carries legs through its chain alone (E46), the entry DIALS its leg from
  // that process too, so it needs the same engine as the side that ends it.
  const everyNode = [...new Set([...positions.flatMap((p) => p.nodeIds), ...directions.flatMap((d) => d.nodeIds)])];
  const nodes = await prisma.node.findMany({
    where: { id: { in: [...new Set([...wanted.map((w) => w.nodeId), ...everyNode])] } },
    select: { id: true, name: true, cores: true, chainStatus: true },
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const conflicts: { nodeName: string; cell: string; engines: string[]; chainEngine?: string }[] = [];
  const named = new Set<string>();
  for (const w of wanted) {
    const node = byId.get(w.nodeId);
    // A node that is not there is not this gate's refusal to make:
    // assertNodesExistNamed has already said it by name, and saying it twice in
    // two vocabularies helps nobody.
    if (!node) continue;
    const carriage = carriesCellAtSave(node, w.cell);
    if (carriage.ok) continue;
    const chainEngine = chainEngineOf(node);
    // One sentence per node when the cell is not the reason (E46).
    if (chainEngine && named.has(node.id)) continue;
    named.add(node.id);
    conflicts.push({ nodeName: node.name, cell: w.cell, engines: carriage.engines, ...(chainEngine ? { chainEngine } : {}) });
  }
  for (const id of everyNode) {
    const node = byId.get(id);
    if (!node || named.has(id)) continue;
    const chainEngine = chainEngineOf(node);
    if (!chainEngine) continue;
    const verdict = canRunChainAtSave(node);
    if (verdict.ok) continue;
    named.add(id);
    conflicts.push({ nodeName: node.name, cell: 'any', engines: verdict.engines, chainEngine });
  }
  if (conflicts.length > 0) throw new CascadeCellNotCarriedError(conflicts);
}

/**
 * A hysteria or AmneziaWG entry on a node that cannot run the chain process.
 *
 * Refused by FACT only (see canRunChainAtSave): the node reported its engines
 * in full and sing-box is not among them. Every node is named, not the first,
 * like the port and the cell refusals.
 */
export class CascadeEntryCannotChainError extends Error {
  readonly code = 'ENTRY_CANNOT_CHAIN';
  constructor(
    public conflicts: { nodeName: string; engines: string[] }[],
    public protocol: string,
  ) {
    super(
      `A ${protocol} entry hands every user to the chain process on the same node, and these ` +
        `entry nodes cannot run one: ` +
        conflicts
          .map(
            (c) =>
              `node "${c.nodeName}" reports ` +
              (c.engines.length > 0 ? `only ${c.engines.join(', ')}` : 'no engines'),
          )
          .join('; ') +
        `. Install sing-box on them (bootstrap-singbox.sh) or keep the entry on xray.`,
    );
    this.name = 'CascadeEntryCannotChainError';
  }
}

/**
 * Switching the entry protocol takes people out of the cascade, phase 6.
 *
 * One protocol per entry, by decision. Moving it from xray to hysteria (or back)
 * means the users of the OLD protocol on the entry nodes stop being cascaded
 * and leave straight from the entry country. That is allowed, and it must be
 * SAID: the save refuses with the list of who leaves, and goes through only
 * when the same request is repeated with `confirmEntryChange: true`.
 */
export class CascadeEntryChangeDropsUsersError extends Error {
  readonly code = 'ENTRY_CHANGE_DROPS_USERS';
  constructor(
    public from: string,
    public to: string,
    public conflicts: { nodeName: string; profileName: string }[],
  ) {
    super(
      `Changing the entry from ${from} to ${to} takes these profiles out of the cascade, and ` +
        `their users will leave straight from the entry country: ` +
        conflicts.map((c) => `profile "${c.profileName}" on node "${c.nodeName}"`).join('; ') +
        `. Repeat the save with confirmEntryChange: true to go ahead.`,
    );
    this.name = 'CascadeEntryChangeDropsUsersError';
  }
}

/**
 * Nodes taken OUT of the entry, and somebody is standing on them, phase 6.7.
 *
 * The same silent loss as a protocol switch, along the other axis: a node that
 * stops being an entry stops cascading its users, whatever the protocol, and
 * they leave straight from that node's country. Same consent as the switch
 * (`confirmEntryChange`), because to the operator it is the same question:
 * "these people are about to leave the cascade, do you mean it".
 */
export class CascadeEntryNodesDroppedError extends Error {
  readonly code = 'ENTRY_NODES_DROPPED';
  constructor(public conflicts: { nodeName: string; profileName: string }[]) {
    super(
      `These nodes are leaving the cascade entry, and the users of these profiles on them will ` +
        `leave straight from the node's own country: ` +
        conflicts.map((c) => `profile "${c.profileName}" on node "${c.nodeName}"`).join('; ') +
        `. Repeat the save with confirmEntryChange: true to go ahead.`,
    );
    this.name = 'CascadeEntryNodesDroppedError';
  }
}

/**
 * The entry nodes this save removes, and who is on them.
 *
 * Only profiles served with the entry protocol are named: those are the users
 * the cascade carried from that node. A profile of another protocol on the same
 * node was never cascaded, and naming it would be an alarm about nothing.
 *
 * Asked AFTER the protocol switch, so a save that changes both is refused
 * about the switch first, and one confirmation covers both answers.
 */
async function assertEntryNodesDropConfirmed(
  cascadeId: string,
  positions: { position: number; nodeIds: string[]; entryProtocol?: string }[] | undefined,
  confirmed: boolean,
): Promise<void> {
  const next = positions?.find((p) => p.position === 0);
  if (!next || confirmed) return;
  const [storedV4, storedHop] = await Promise.all([
    prisma.cascadePosition.findFirst({
      where: { cascadeId, position: 0 },
      select: { entryProtocol: true, nodes: { select: { nodeId: true } } },
    }),
    prisma.cascadeHop.findFirst({
      where: { cascadeId, position: 0 },
      select: { entryProtocol: true, nodeId: true },
    }),
  ]);
  const storedNodes = storedV4
    ? storedV4.nodes.map((n) => n.nodeId)
    : storedHop
      ? [storedHop.nodeId]
      : [];
  const protocol = storedV4?.entryProtocol ?? storedHop?.entryProtocol ?? null;
  const keep = new Set(next.nodeIds);
  const dropped = storedNodes.filter((id) => !keep.has(id));
  if (!protocol || dropped.length === 0) return;

  const leaving = await prisma.profileNodeBinding.findMany({
    where: { nodeId: { in: dropped }, enabled: true, profile: { protocol } },
    select: { node: { select: { name: true } }, profile: { select: { name: true } } },
    orderBy: [{ node: { name: 'asc' } }, { profile: { name: 'asc' } }],
  });
  if (leaving.length === 0) return;
  throw new CascadeEntryNodesDroppedError(
    leaving.map((b) => ({ nodeName: b.node.name, profileName: b.profile.name })),
  );
}

/**
 * The entry nodes of a hysteria or AmneziaWG entry must be able to run the
 * chain.
 *
 * Only the ENTRY: such an entry's users reach the cascade through the chain
 * process on that machine and through nothing else, so a node with no sing-box
 * is a cascade that exists on the screen and carries nobody. Refused by fact
 * only (canRunChainAtSave): a node that has not reported its engines is not a
 * "no".
 */
async function assertEntryCanChain(
  positions?: { position: number; nodeIds: string[]; entryProtocol?: string }[],
): Promise<void> {
  const entry = positions?.find((p) => p.position === 0);
  if (!entryReachesCascadeOnlyThroughChain(entry?.entryProtocol) || !entry || entry.nodeIds.length === 0) return;
  const nodes = await prisma.node.findMany({
    where: { id: { in: entry.nodeIds } },
    select: { name: true, cores: true, chainStatus: true },
  });
  const conflicts = nodes
    .map((n) => ({ node: n, verdict: canRunChainAtSave(n) }))
    .filter((x) => !x.verdict.ok)
    .map((x) => ({ nodeName: x.node.name, engines: x.verdict.engines }));
  if (conflicts.length > 0) throw new CascadeEntryCannotChainError(conflicts, entry.entryProtocol!);
}

/**
 * The entry protocol moved, and somebody is standing on the old one.
 *
 * `from` is what is stored (the v4 entry, or the legacy entry hop for a cascade
 * written before the topology tables); `to` is what this save asks for. Who
 * leaves is every enabled binding of a profile served with the OLD protocol on
 * the NEW entry nodes: those nodes stay entries, and their users of the old
 * protocol stop being cascaded. A node dropped from the entry at the same time
 * loses its cascade whatever the protocol, and that is a different change.
 */
async function assertEntryChangeConfirmed(
  cascadeId: string,
  positions: { position: number; nodeIds: string[]; entryProtocol?: string }[] | undefined,
  confirmed: boolean,
): Promise<void> {
  const next = positions?.find((p) => p.position === 0);
  if (!next?.entryProtocol || confirmed) return;
  const [storedV4, storedHop] = await Promise.all([
    prisma.cascadePosition.findFirst({
      where: { cascadeId, position: 0 },
      select: { entryProtocol: true },
    }),
    prisma.cascadeHop.findFirst({
      where: { cascadeId, position: 0 },
      select: { entryProtocol: true },
    }),
  ]);
  const from = storedV4?.entryProtocol ?? storedHop?.entryProtocol ?? null;
  if (!from || from === next.entryProtocol) return;

  const leaving = await prisma.profileNodeBinding.findMany({
    where: { nodeId: { in: next.nodeIds }, enabled: true, profile: { protocol: from } },
    select: { node: { select: { name: true } }, profile: { select: { name: true } } },
    orderBy: [{ node: { name: 'asc' } }, { profile: { name: 'asc' } }],
  });
  // Nobody on the old protocol, nobody to warn: the switch goes through as an
  // ordinary edit.
  if (leaving.length === 0) return;
  throw new CascadeEntryChangeDropsUsersError(
    from,
    next.entryProtocol,
    leaving.map((b) => ({ nodeName: b.node.name, profileName: b.profile.name })),
  );
}

export class CascadeEntryCoreTooOldError extends Error {
  constructor(
    public readonly nodeName: string,
    public readonly coreVersion: string,
    public readonly minVersion: string,
  ) {
    super(
      `Entry node "${nodeName}" runs xray ${coreVersion}; enabling a balancer cascade needs xray >= ${minVersion} so exit selection (vlessRoute) works. Upgrade the entry node's xray, or keep the cascade disabled.`,
    );
    this.name = 'CascadeEntryCoreTooOldError';
  }
}

// T7: minimum xray-core version on a balancer ENTRY. Below this, xray doesn't
// understand vlessRoute and rejects the exit-selection UUID at auth (silent
// connect failure), so the panel blocks enabling such a cascade.
export const MIN_XRAY_VLESSROUTE = '25.9.5';

/** Numeric dotted-version compare: is `v` >= `min`? Non-numeric / missing parts
 *  count as 0. Exported for tests. */
export function versionAtLeast(v: string, min: string): boolean {
  const parts = (s: string): number[] => s.split('.').map((n) => parseInt(n, 10) || 0);
  const a = parts(v);
  const b = parts(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * The version of the core that will actually render this, or undefined.
 *
 * `Node.coreVersion` is ONE field on a node that runs several engines, so it
 * cannot answer "which core". The poller fills it from the first core whose
 * NAME is 'xray' (nodes.cron.ts), and the agent registers the sing-box adapter
 * under that same protocol name (main.go:306), so on a node with both engines
 * the field can hold the sing-box version: 1.13.14 where the real xray is
 * 26.3.27. A gate reading it then refuses a cascade that works.
 *
 * The inventory answers properly, because a core there carries its engine
 * beside its name. Undefined means we do not know, and the three ways to not
 * know are one answer: no inventory at all, no xray core in it, or an xray
 * core that reported no version.
 */
function xrayCoreVersion(cores: unknown): string | undefined {
  const inv = (cores as NodeCores | null) ?? null;
  if (!inv) return undefined;
  const xray = inv.cores.find((c) => c.engine === 'xray' || (c.engine === undefined && c.name === 'xray'));
  return xray?.version || undefined;
}

/** T7 gate: an ENABLED balancer entry hands every user vlessRoute-tagged exit
 *  configs, which a pre-25.9.5 xray rejects at auth. Block only when the entry's
 *  xray core is KNOWN-old. Unknown stays allowed: we cannot prove it is old, and
 *  an unprovable refusal wedges an operator for no reason. */
async function assertBalancerEntrySupportsVlessRoute(entryNodeId: string): Promise<void> {
  const node = await prisma.node.findUnique({
    where: { id: entryNodeId },
    select: { name: true, cores: true },
  });
  if (!node) return;
  const version = xrayCoreVersion(node.cores);
  if (!version) return; // unknown -> allow
  if (!versionAtLeast(version, MIN_XRAY_VLESSROUTE)) {
    throw new CascadeEntryCoreTooOldError(node.name, version, MIN_XRAY_VLESSROUTE);
  }
}

const hopInclude = {
  hops: {
    orderBy: { position: 'asc' as const },
    include: { node: { select: { id: true, name: true } } },
  },
  // v4 shape, served alongside hops. The panel needs `directions[].id` back on
  // save to keep a direction's tag: without it every edit looks like a new
  // direction and the tag (which lives in clients' UUIDs) would move.
  positions: {
    orderBy: { position: 'asc' as const },
    include: { nodes: { select: { nodeId: true } } },
  },
  directions: {
    orderBy: { tag: 'asc' as const },
    include: { nodes: { select: { nodeId: true } } },
  },
  // Phase 8: the tunnels and the legs they carry, for the DTO's tunnel list and
  // its open-port answer. Narrow selects: no credential leaves the table here.
  tunnels: { select: { fromNodeId: true, toNodeId: true, index: true, port: true } },
  links: { select: { fromNodeId: true, toNodeId: true, directionTag: true } },
  // Phase 9.3: named in the DTO, so a card and a selector need no second call.
  entryPolicy: { select: { id: true, name: true, ordinal: true } },
};

async function assertNodesExist(nodeIds: string[]): Promise<void> {
  await assertNodesExistNamed(nodeIds.map((id) => ({ id, where: '' })));
}

/**
 * The same check, able to say WHERE the dangling id sits.
 *
 * A bare uuid in a 400 is a puzzle: the operator is looking at a screen of
 * named directions and positions, and the panel hands them a string that
 * appears nowhere on it. Worse, the id belongs to a node that no longer
 * exists, so they cannot look it up either.
 *
 * ⚠ This is the check for rows ALREADY STORED. Deleting a node that a live
 * cascade uses is refused now (NodeInUseByCascadeError), which closes the road
 * forward; a cascade saved before that guard can still carry a dead id, and it
 * arrives at the panel as a nodeId with no row in the node list, which "Save
 * and push" happily sent back. That is how the 2026-09-22 incident's cascade
 * got into the state it was in.
 */
async function assertNodesExistNamed(
  refs: { id: string; where: string }[],
): Promise<void> {
  if (refs.length === 0) return;
  const found = await prisma.node.findMany({
    where: { id: { in: refs.map((r) => r.id) }, deletedAt: null },
    select: { id: true },
  });
  const ok = new Set(found.map((n) => n.id));
  for (const ref of refs) {
    if (!ok.has(ref.id)) throw new CascadeNodeMissingError(ref.id, ref.where);
  }
}

/**
 * Every node id a v4 payload names, with the place it was named in.
 *
 * Directions carry a country code and a tag, which is what the screen shows,
 * so that is what the refusal says back.
 */
function nodeRefsOfTopology(
  positions: { position: number; nodeIds: string[] }[] | undefined,
  directions: { tag?: number; countryCode?: string | null; nodeIds: string[] }[] | undefined,
): { id: string; where: string }[] {
  const refs: { id: string; where: string }[] = [];
  for (const p of positions ?? []) {
    for (const id of p.nodeIds) refs.push({ id, where: `position ${p.position}` });
  }
  for (const d of directions ?? []) {
    const name = d.countryCode ? `"${d.countryCode}"` : `tag ${d.tag ?? '?'}`;
    for (const id of d.nodeIds) refs.push({ id, where: `direction ${name}` });
  }
  return refs;
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
/** The cascade that keeps a node out of subscriptions. */
export interface HidingCascade {
  cascadeId: string;
  cascadeName: string;
}

let hiddenNodesCache: {
  ids: Set<string>;
  byNode: Map<string, HidingCascade>;
  expiresAt: number;
} | null = null;
const HIDDEN_NODES_TTL_MS = 60_000;

export function invalidateHiddenCascadeNodeCache(): void {
  hiddenNodesCache = null;
}

export async function getHiddenCascadeNodeIds(): Promise<Set<string>> {
  return (await readHiddenCascadeNodes()).ids;
}

/**
 * The same set, with the cascade that hides each node.
 *
 * ONE computation for both: the subscription filters by the ids, and the hosts
 * screen says why a host will never be handed out. Two readings of "hidden"
 * would let the screen say "visible" about a node the subscription drops, which
 * is the silence this exists to end (POST /api/hosts on an exit answered 201
 * and nobody ever got the host). Where a node is a non-entry hop of more than
 * one cascade, the first by name is named: one is enough to explain it.
 */
export async function getHiddenCascadeNodes(): Promise<Map<string, HidingCascade>> {
  return (await readHiddenCascadeNodes()).byNode;
}

async function readHiddenCascadeNodes(): Promise<{ ids: Set<string>; byNode: Map<string, HidingCascade> }> {
  if (hiddenNodesCache && Date.now() < hiddenNodesCache.expiresAt) {
    return hiddenNodesCache;
  }
  // Only cascades that opt INTO hiding (the default) suppress their non-entry
  // hops. An operator who unchecks `hideHopsFromSub` keeps the exits visible as
  // direct subscription picks (they still work standalone; the cascade just
  // additionally offers them behind its "Auto" entry).
  const cascade = { select: { id: true, name: true } } as const;
  const [hops, positions, directionNodes] = await Promise.all([
    prisma.cascadeHop.findMany({
      where: { cascade: { enabled: true, hideHopsFromSub: true } },
      select: { nodeId: true, position: true, cascade },
    }),
    // v4: the same rule, read from the topology tables. Without this a v4-only
    // cascade would leak its transits and exits into subscriptions as direct
    // endpoints, which is exactly the bypass this function exists to stop.
    prisma.cascadePosition.findMany({
      where: { cascade: { enabled: true, hideHopsFromSub: true } },
      select: { position: true, nodes: { select: { nodeId: true } }, cascade },
    }),
    prisma.cascadeDirectionNode.findMany({
      where: { direction: { cascade: { enabled: true, hideHopsFromSub: true } } },
      select: { nodeId: true, direction: { select: { cascade } } },
    }),
  ]);
  const entry = new Set<string>();
  const nonEntry = new Map<string, HidingCascade>();
  const hide = (nodeId: string, c: { id: string; name: string }) => {
    const seen = nonEntry.get(nodeId);
    if (!seen || c.name < seen.cascadeName) nonEntry.set(nodeId, { cascadeId: c.id, cascadeName: c.name });
  };
  for (const p of positions) {
    for (const n of p.nodes) {
      if (p.position === 0) entry.add(n.nodeId);
      else hide(n.nodeId, p.cascade);
    }
  }
  // A direction is never an entry: it is the way OUT.
  for (const d of directionNodes) hide(d.nodeId, d.direction.cascade);
  for (const h of hops) {
    if (h.position === 0) entry.add(h.nodeId);
    else hide(h.nodeId, h.cascade);
  }
  for (const id of entry) nonEntry.delete(id);
  hiddenNodesCache = {
    ids: new Set(nonEntry.keys()),
    byNode: nonEntry,
    expiresAt: Date.now() + HIDDEN_NODES_TTL_MS,
  };
  return hiddenNodesCache;
}

/** One line a subscriber can pick at a cascade entry: what it is called, the tag
 *  its UUID must encode, and which cascade it belongs to.
 *
 *  `cascadeId` exists because every entry of a pool offers the same profiles, so
 *  the subscription has to recognise "these lines are the same cascade seen from
 *  two ways in" to collapse them. Grouping by label would work until an operator
 *  named two cascades alike. */
export interface CascadeRouteProfile {
  label: string;
  tag: number;
  cascadeId: string;
}

/** A4: map each given node id that is the ENTRY (position 0) of an enabled
 *  cascade to the route-PROFILES a user in `groupIds` can pick there. A profile
 *  = (allowed exit) x (plain OR a granted ad-split policy), carrying a `label`
 *  (client-facing name) and the `tag` its UUID must encode (routeTag).
 *  Two ACL axes: exits are opt-in RESTRICTION (no rows = all exits), policies are
 *  opt-in GRANT (plain always; extra policy only if a squad granted it). Nodes
 *  that aren't entries, and cascades with no allowed exit, are absent. The
 *  subscription builder expands one entry endpoint into one config per profile.
 *
 *  Chains used to be excluded here by a `mode: 'balancer'` filter, on the
 *  reasoning that a fixed path offers no choice. True for the EXIT, false for
 *  the policy: an operator could define an ad-split policy, grant it to a squad,
 *  and get nothing at all on a chain. Chains now take part, with one guard below
 *  so an untouched chain keeps handing out exactly the links it does today. */
/**
 * E48: the name a hysteria host on the entry of a cascade entered through
 * hysteria goes out under, per entry node.
 *
 * Such an entry takes its users in over hysteria and hands every one of them to
 * the chain, which routes with the policy: the user picks no way out (a user is
 * a password, there is no route tag). So the host is not a direct server any
 * more, it IS the cascade, and it is named like one: the exit's flag and
 * country when there is one direction, the Auto line when there are several.
 * A squad that switched the cascade off keeps the host under its own name.
 *
 * `protocol` since t07-wire: an AmneziaWG entry's awg host is the cascade in
 * the same way, its users are keys and pick no way out either.
 */
export async function getHysteriaEntryLabels(
  nodeIds: string[],
  groupIds: string[] = [],
  entryReach?: Map<string, Set<string>>,
  protocol: 'hysteria' | 'amneziawg' = 'hysteria',
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (nodeIds.length === 0) return out;
  const cascades = await prisma.cascade.findMany({
    where: {
      enabled: true,
      positions: {
        some: { position: 0, entryProtocol: protocol, nodes: { some: { nodeId: { in: nodeIds } } } },
      },
    },
    select: {
      id: true,
      name: true,
      positions: { where: { position: 0 }, select: { nodes: { select: { nodeId: true } } } },
      directions: {
        orderBy: { tag: 'asc' },
        select: { countryCode: true, nodes: { select: { node: { select: { name: true, countryCode: true } } } } },
      },
    },
  });
  if (cascades.length === 0) return out;
  const offRows =
    groupIds.length > 0
      ? await prisma.groupCascadeOff.findMany({
          where: { groupId: { in: groupIds }, cascadeId: { in: cascades.map((c) => c.id) } },
          select: { groupId: true, cascadeId: true },
        })
      : [];
  const offByCascade = new Map<string, Set<string>>();
  for (const r of offRows) offByCascade.set(r.cascadeId, (offByCascade.get(r.cascadeId) ?? new Set()).add(r.groupId));

  for (const c of [...cascades].sort((a, b) => a.name.localeCompare(b.name))) {
    const usable = c.directions.filter((d) => d.nodes.length > 0);
    if (usable.length === 0) continue;
    let label: string;
    if (usable.length === 1) {
      const d = usable[0]!;
      const exit = d.nodes[0]!.node;
      label = cascadeProfileLabel(c.name, d.countryCode ?? exit.countryCode, exit.name);
    } else {
      label = cascadeAutoProfileLabel(c.name);
    }
    for (const n of c.positions[0]?.nodes ?? []) {
      if (!nodeIds.includes(n.nodeId) || out.has(n.nodeId)) continue;
      if (cascadeIsOffAt({ groupIds, entryNodeId: n.nodeId, entryReach, offGroups: offByCascade.get(c.id) })) continue;
      out.set(n.nodeId, label);
    }
  }
  return out;
}

export async function getRouteProfilesByEntryNode(
  nodeIds: string[],
  groupIds: string[] = [],
  entryReach?: Map<string, Set<string>>,
): Promise<Map<string, CascadeRouteProfile[]>> {
  const out = new Map<string, CascadeRouteProfile[]>();
  if (nodeIds.length === 0) return out;
  const cascades = await prisma.cascade.findMany({
    where: {
      enabled: true,
      OR: [
        { hops: { some: { nodeId: { in: nodeIds }, position: 0 } } },
        { positions: { some: { position: 0, nodes: { some: { nodeId: { in: nodeIds } } } } } },
      ],
    },
    include: {
      hops: {
        orderBy: { position: 'asc' },
        // countryCode drives the flag and the label of a route profile: what a
        // client picks here is a COUNTRY to leave from, not a machine.
        include: { node: { select: { id: true, name: true, countryCode: true } } },
      },
      positions: {
        orderBy: { position: 'asc' },
        include: { nodes: { select: { nodeId: true } } },
      },
      directions: {
        orderBy: { tag: 'asc' },
        include: {
          nodes: { select: { node: { select: { id: true, name: true, countryCode: true } } } },
        },
      },
    },
  });
  if (cascades.length === 0) return out;

  // A4 increment 2: per-squad exit allow-list. Union the user's allow rows per
  // cascade. OPT-IN restriction: a cascade absent from this map is unrestricted
  // (no rows => all exits); present => keep only the allowed exit nodes.
  const allowByCascade = new Map<string, Set<string>>();
  // Per-SQUAD views of the same two facts, so a policy can be attributed to the
  // squad that granted it (see policiesForDirection).
  const allowByGroupCascade = new Map<string, Set<string>>(); // `${groupId}|${cascadeId}`
  const policiesByGroup = new Map<string, { ordinal: number; name: string }[]>();
  // cascadeId -> squads that switched it OFF (an exitAcl entry with no exits).
  const offByCascade = new Map<string, Set<string>>();
  if (groupIds.length > 0) {
    const [allExitRows, grants, offRows] = await Promise.all([
      prisma.groupCascadeExit.findMany({
        where: { groupId: { in: groupIds }, cascadeId: { in: cascades.map((c) => c.id) } },
        select: { groupId: true, cascadeId: true, exitNodeId: true },
      }),
      prisma.groupRoutePolicy.findMany({
        where: { groupId: { in: groupIds } },
        select: { groupId: true, policy: { select: { ordinal: true, name: true } } },
      }),
      prisma.groupCascadeOff.findMany({
        where: { groupId: { in: groupIds }, cascadeId: { in: cascades.map((c) => c.id) } },
        select: { groupId: true, cascadeId: true },
      }),
    ]);
    for (const r of offRows) {
      const s = offByCascade.get(r.cascadeId) ?? new Set<string>();
      s.add(r.groupId);
      offByCascade.set(r.cascadeId, s);
    }
    // A squad that switched a cascade off grants none of its exits, whatever
    // else is stored: off wins, it is the smaller access.
    const exitRows = allExitRows.filter((r) => !offByCascade.get(r.cascadeId)?.has(r.groupId));
    for (const r of exitRows) {
      const k = `${r.groupId}|${r.cascadeId}`;
      const s = allowByGroupCascade.get(k) ?? new Set<string>();
      s.add(r.exitNodeId);
      allowByGroupCascade.set(k, s);
    }
    for (const g of grants) {
      const list = policiesByGroup.get(g.groupId) ?? [];
      if (!list.some((p) => p.ordinal === g.policy.ordinal)) list.push(g.policy);
      policiesByGroup.set(g.groupId, list);
    }
    for (const r of exitRows) {
      let set = allowByCascade.get(r.cascadeId);
      if (!set) {
        set = new Set();
        allowByCascade.set(r.cascadeId, set);
      }
      set.add(r.exitNodeId);
    }
  }

  for (const c of cascades) {
    // v4 path: profiles come from DIRECTIONS, and the tag is the direction's
    // own frozen tag rather than its ordinal in a list. This has to match how
    // the node routes (buildTopologyFragmentsForNode uses the same tag): with
    // ordinals, a cascade whose tag 2 was burned by a deletion would hand
    // clients a tag that resolves to a different country.
    if (c.directions.length > 0) {
      const entryPos = c.positions.find((p) => p.position === 0);
      /**
       * EVERY entry of the pool, not just the first one that matched.
       *
       * A position holds interchangeable nodes, so each of them is a way into
       * the same cascade and each must expand into the same per-direction
       * configs. Taking only the first left the others without cascade
       * profiles, and an endpoint with no profiles is emitted as an ordinary
       * direct server: the subscriber saw the second entry as a plain node,
       * picked it, and egressed from the ENTRY country instead of the exit they
       * were choosing. Found 2026-08-15 on a two-node entry pool, where the
       * second entry showed up as its own line next to the cascade's.
       */
      const entryNodeIds = (entryPos?.nodes.map((n) => n.nodeId) ?? []).filter((id) =>
        nodeIds.includes(id),
      );
      if (entryNodeIds.length === 0) continue;
      // E48, stand 26.09: a cascade entered through hysteria hands its users
      // to the chain from hysteria (userCoreFor), and the entry's xray gets no
      // drawing. vless profiles here would be ways in the cascade does not
      // carry. The entry's hy2 host stands for the cascade instead
      // (getHysteriaEntryLabels).
      // An amneziawg entry the same, t07-wire: its awg host stands for it.
      if (entryReachesCascadeOnlyThroughChain(entryPos?.entryProtocol)) continue;
      const allowed = allowByCascade.get(c.id);
      /**
       * Policies that apply to THIS direction: only the ones granted by squads
       * that also let the user reach it.
       *
       * Before this, grants were pooled across every squad and sprayed onto
       * every direction of every cascade, so a squad handing out "no ads" for
       * the Dutch exit also produced a "no ads" profile on the Swedish one -
       * which the operator never configured and cannot switch off. A grant is
       * meaningful only inside the squad that made it, because the squad is
       * also what decides which exits the user sees.
       *
       * A squad with no allow-rows for a cascade is unrestricted there (the
       * existing opt-in convention), so its policies apply to all of that
       * cascade's directions.
       */
      const exitAllowByGroup = new Map<string, Set<string>>();
      for (const groupId of groupIds) {
        const allows = allowByGroupCascade.get(`${groupId}|${c.id}`);
        if (allows) exitAllowByGroup.set(groupId, allows);
      }
      // Per entry, because the granted policies depend on which squads hand out
      // THAT entry: two entries of one pool can legitimately differ.
      const offGroups = offByCascade.get(c.id);
      for (const entryNodeId of entryNodeIds) {
        // Switched off by every squad that hands this entry out: no line of the
        // cascade here, and the entry stays whatever else it is to the user.
        if (cascadeIsOffAt({ groupIds, entryNodeId, entryReach, offGroups })) continue;
        const policiesForDirection = (directionNodeIds: string[]): RoutePolicyRef[] =>
          policiesForEntry({
            groupIds,
            entryNodeId,
            policiesByGroup,
            entryReach,
            directionNodeIds,
            exitAllowByGroup,
            offGroups,
          });
        const profiles: CascadeRouteProfile[] = [];
        /**
         * AUTO first, when the operator turned it on and the user is free to
         * use every exit.
         *
         * The restriction check is the load-bearing half. A squad's exit
         * allow-list is enforced by which TAGS a user is handed, and Auto names
         * no exit at all: the entry's balancer spans every direction, because a
         * node config is one config for everybody and cannot be narrowed per
         * user. Handing Auto to a restricted user would walk straight past the
         * allow-list their operator set. So they simply do not get the row; a
         * per-subset balancer is the shape that would let them, and that is a
         * separate piece of work.
         *
         * Two directions minimum, matching the node side exactly: with one, Auto
         * resolves to the same single destination as the row above it.
         */
        const usable = c.directions.filter((d) => d.nodes.length > 0);
        if (c.autoProfile && !allowed && usable.length > 1) {
          const autoLabel = cascadeAutoProfileLabel(c.name);
          profiles.push({ label: autoLabel, tag: autoRouteTag(0), cascadeId: c.id });
          // Policy variants of Auto are gated by the direction they can reach,
          // so a policy granted only for one direction does not become an Auto
          // row that can egress through another.
          for (const p of policiesForDirection(usable.flatMap((d) => d.nodes.map((n) => n.node.id)))) {
            profiles.push({
              label: `${autoLabel} · ${p.name}`,
              tag: autoRouteTag(p.ordinal),
              cascadeId: c.id,
            });
          }
        }
        for (const d of c.directions) {
          // A direction with no node serves nobody; offering it would hand out a
          // config that cannot connect.
          if (d.nodes.length === 0) continue;
          // Squad ACL is keyed on exit NODES, so a direction survives if any of
          // its pool is allowed.
          if (allowed && !d.nodes.some((n) => allowed.has(n.node.id))) continue;
          const first = d.nodes[0]!.node;
          const label = cascadeProfileLabel(c.name, d.countryCode ?? first.countryCode, first.name);
          profiles.push({ label, tag: routeTag(0, d.tag - 1), cascadeId: c.id });
          for (const p of policiesForDirection(d.nodes.map((n) => n.node.id))) {
            profiles.push({
              label: `${label} · ${p.name}`,
              tag: routeTag(p.ordinal, d.tag - 1),
              cascadeId: c.id,
            });
          }
        }
        if (profiles.length > 0) out.set(entryNodeId, profiles);
      }
      continue;
    }

    const entry = c.hops.find((h) => h.position === 0);
    if (!entry || !nodeIds.includes(entry.nodeId)) continue;
    const offGroups = offByCascade.get(c.id);
    if (cascadeIsOffAt({ groupIds, entryNodeId: entry.nodeId, entryReach, offGroups })) continue;
    const isBalancer = c.mode === 'balancer';
    // Same entry gate as the v4 path above: only squads that hand out THIS
    // entry add their policy variants to it. Exits are filtered separately here
    // (applyExitAcl below), so the direction gate is not used on this path.
    const grantedPolicies = policiesForEntry({
      groupIds,
      entryNodeId: entry.nodeId,
      policiesByGroup,
      entryReach,
      offGroups,
    });
    // A chain with no granted policy emits NOTHING, deliberately. Its only
    // profile would be the plain one, which resolves to the same single exit an
    // untagged UUID already reaches, so tagging would rewrite every user's UUID
    // for zero behavioural gain. Balancers always emit: there the tag is what
    // pins the exit, and that is existing shipped behaviour.
    if (!isBalancer && grantedPolicies.length === 0) continue;
    // index = position in the FULL exit list (position-asc), matching the node's
    // cascade-link-out-<index>; computed BEFORE the squad filter so a kept subset
    // still tags each exit with the right link-out.
    //
    // A chain has exactly one exit, its last hop, and it carries index 0: the
    // chain entry emits a single unindexed link-out, so every tag routed there
    // must use exitIndex 0.
    const exitHops = isBalancer ? c.hops.filter((h) => h.position !== 0) : c.hops.slice(-1);
    const fullExits = exitHops.map((h, i) => ({
      name: cascadeProfileLabel(c.name, h.node.countryCode, h.node.name),
      index: i,
      nodeId: h.node.id,
    }));
    const exits = applyExitAcl(fullExits, allowByCascade.get(c.id));
    if (exits.length === 0) continue;
    // Cartesian: each exit x (plain + granted policies). Plain first per exit so
    // the client list reads CH, CH-no-ads, TR, TR-no-ads.
    const profiles: CascadeRouteProfile[] = [];
    // AUTO on the legacy balancer shape. No node change is needed here: that
    // entry ends its rules with a catch-all into the same balancer, so a tag it
    // does not recognise already means "let the balancer choose". Same two gates
    // as the v4 path: the operator asked for it, and the user is unrestricted,
    // since Auto can reach any exit.
    if (c.autoProfile && isBalancer && !allowByCascade.get(c.id) && fullExits.length > 1) {
      const autoLabel = cascadeAutoProfileLabel(c.name);
      profiles.push({ label: autoLabel, tag: autoRouteTag(0), cascadeId: c.id });
      for (const p of grantedPolicies) {
        profiles.push({
          label: `${autoLabel} · ${p.name}`,
          tag: autoRouteTag(p.ordinal),
          cascadeId: c.id,
        });
      }
    }
    for (const ex of exits) {
      profiles.push({ label: ex.name, tag: routeTag(0, ex.index), cascadeId: c.id });
      for (const p of grantedPolicies) {
        profiles.push({
          label: `${ex.name} · ${p.name}`,
          tag: routeTag(p.ordinal, ex.index),
          cascadeId: c.id,
        });
      }
    }
    out.set(entry.nodeId, profiles);
  }
  return out;
}

export interface RoutePolicyRef {
  ordinal: number;
  name: string;
}

/**
 * Which ad-split policies add a variant at ONE entry (and optionally on one
 * direction out of it). Two independent gates, both opt-in restrictions:
 *
 *  - `entryReach`: squads that hand this ENTRY out. A grant lives inside the
 *    squad that made it, and a squad only speaks where it hands something out.
 *    Missing map = no gate (other callers keep their old behaviour); a node
 *    absent FROM the map is reached by nobody, since the caller builds it from
 *    the very bindings the user is being served.
 *  - `exitAllowByGroup`: that squad's exit allow-list for this cascade. A squad
 *    with no rows is unrestricted, the existing convention.
 *
 * Both were needed to fix the field report of 2026-08-08: a squad handing out
 * the Dutch entry with "no ads" granted also stamped a "no ads" variant onto a
 * Swedish entry belonging to a different squad, which the operator never
 * configured, could not switch off, and which the squad screen's own preview
 * did not show. Exit-list scoping alone could not catch it, because neither
 * squad had restricted its exits at all.
 *
 * Pure and exported so the semantics can be tested without a database.
 */
export function policiesForEntry(args: {
  groupIds: string[];
  entryNodeId: string;
  policiesByGroup: Map<string, RoutePolicyRef[]>;
  entryReach?: Map<string, Set<string>>;
  /** Exit nodes of the direction being offered. Omit to skip the exit gate. */
  directionNodeIds?: string[];
  /** groupId -> allowed exit nodes for THIS cascade. */
  exitAllowByGroup?: Map<string, Set<string>>;
  /** Squads that switched THIS cascade off: they grant nothing on it. */
  offGroups?: Set<string>;
}): RoutePolicyRef[] {
  const { groupIds, entryNodeId, policiesByGroup, entryReach, directionNodeIds } = args;
  const reach = entryReach?.get(entryNodeId);
  const seen = new Set<number>();
  const out: RoutePolicyRef[] = [];
  for (const groupId of groupIds) {
    if (entryReach && !reach?.has(groupId)) continue;
    if (args.offGroups?.has(groupId)) continue;
    if (directionNodeIds) {
      const allows = args.exitAllowByGroup?.get(groupId);
      if (allows && !directionNodeIds.some((id) => allows.has(id))) continue;
    }
    for (const p of policiesByGroup.get(groupId) ?? []) {
      if (seen.has(p.ordinal)) continue;
      seen.add(p.ordinal);
      out.push(p);
    }
  }
  return out;
}

/**
 * Whether a cascade is switched OFF at one entry for this user: every squad of
 * theirs that hands the entry out has an exitAcl entry with no exits for it.
 *
 * Only the squads that SPEAK at the entry count, the same gate the policies
 * use: a squad that does not hand the entry out has no say about what is built
 * there, neither to switch the cascade off nor to keep it on. One speaking squad
 * without the switch is enough to keep it, because squads grant, they do not
 * take away from each other.
 *
 * No squad speaking means no squad said "off", and the cascade is built as it
 * was before the switch existed.
 */
export function cascadeIsOffAt(args: {
  groupIds: string[];
  entryNodeId: string;
  entryReach?: Map<string, Set<string>>;
  offGroups?: Set<string>;
}): boolean {
  const { groupIds, entryNodeId, entryReach, offGroups } = args;
  if (!offGroups || offGroups.size === 0) return false;
  const reach = entryReach?.get(entryNodeId);
  const speaking = groupIds.filter((g) => !entryReach || reach?.has(g));
  return speaking.length > 0 && speaking.every((g) => offGroups.has(g));
}

/** A4 increment 2: apply a squad exit allow-set to a cascade's full exit list.
 *  `allowed` undefined => opt-in default, keep ALL exits. A present set (union of
 *  the user's squads' grants) => keep only those exit nodes. The `index` (link-out
 *  position) is preserved so a filtered subset still selects the right link-out.
 *  Exported for unit testing the semantics without a DB. */
export function applyExitAcl(
  fullExits: { name: string; index: number; nodeId: string }[],
  allowed: Set<string> | undefined,
): { name: string; index: number }[] {
  return fullExits
    .filter((e) => !allowed || allowed.has(e.nodeId))
    .map((e) => ({ name: e.name, index: e.index }));
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

export interface CascadeHopStatus {
  nodeId: string;
  name: string;
  /** The node acknowledged an inbound push made after this cascade was saved. */
  applied: boolean;
  online: boolean;
  /**
   * Why this hop does not carry the cascade, in the agent's words, or null
   * (E46). The chain process the node reported as not running, with its
   * reason ("no singbox binary on this node, so the chain cannot be drawn"),
   * or a push refused since the save. A hop with a reason is never done,
   * whatever `applied` says.
   */
  broken: string | null;
}

export interface CascadeStatusDto {
  /** Every hop has acknowledged the push and none is broken. */
  done: boolean;
  /** The first broken hop as one sentence, "<node>: <reason>", or null. */
  broken: string | null;
  hops: CascadeHopStatus[];
}

/**
 * Provisioning status of a cascade's hops. Saving a cascade pushes new inbound
 * config to each hop asynchronously (cascade.changed -> inbound-sync), so the
 * UI otherwise cannot tell whether the save actually landed.
 *
 * `applied` compares the node's `lastInboundSyncAt`, stamped only when
 * applyInbounds returned ok, against the cascade's `updatedAt`. That is a
 * truthful "this node took the config we sent after you saved". Note it is
 * deliberately NOT `lastStatusChange`: that field only moves on an
 * online/offline transition, so a node that stays healthy would never satisfy
 * it and every successful save would look like it was still pending.
 *
 * A node that is offline reports applied=false and online=false, which is the
 * honest answer: the push is queued and the cron re-pushes when it returns.
 */
export async function getCascadeStatus(id: string): Promise<CascadeStatusDto> {
  const c = await prisma.cascade.findUnique({
    where: { id },
    include: {
      hops: {
        orderBy: { position: 'asc' },
        include: {
          node: {
            select: {
              id: true,
              name: true,
              status: true,
              lastInboundSyncAt: true,
              lastInboundSyncError: true,
              chainStatus: true,
            },
          },
        },
      },
    },
  });
  if (!c) throw new CascadeNotFoundError(id);

  const savedAt = c.updatedAt;
  const hops = c.hops.map((h) => ({
    nodeId: h.node.id,
    name: h.node.name,
    // Same predicate the node card uses, from one place: two readings of
    // "applied" that could disagree is exactly the confusion this answers.
    applied: isConfigApplied(h.node.lastInboundSyncAt, savedAt),
    online: h.node.status === 'online',
    broken: hopBrokenReason(h.node, savedAt),
  }));
  const firstBroken = hops.find((h) => h.broken !== null);
  return {
    done: hops.length > 0 && hops.every((h) => h.applied && h.broken === null),
    broken: firstBroken ? `${firstBroken.name}: ${firstBroken.broken}` : null,
    hops,
  };
}

/**
 * Why a hop does not carry the cascade, from what the panel already knows
 * (E46, stand 26.09: three nodes without sing-box logged "no singbox binary on
 * this node" six times each while the cascade page read "done").
 *
 *   - the chain process the node REPORTS and reports down: the agent holds a
 *     chain only while a push carried one, so a reported chain that does not
 *     run is this cascade's, and its error is the agent's own sentence;
 *   - a push refused after the save and not followed by a success: the
 *     refusal text the worker kept (lastInboundSyncError).
 *
 * Exported for the tests.
 */
export function hopBrokenReason(
  node: { chainStatus: unknown; lastInboundSyncAt: Date | null; lastInboundSyncError: unknown },
  savedAt: Date,
): string | null {
  const chain = (node.chainStatus as ChainStatus | null) ?? null;
  if (chain && chain.running === false) {
    return `chain process not running: ${chain.error || 'no reason given'}`;
  }
  const err = (node.lastInboundSyncError as { at?: string; message?: string } | null) ?? null;
  if (err?.at && err.message) {
    const at = Date.parse(err.at);
    const okAt = node.lastInboundSyncAt?.getTime() ?? 0;
    if (Number.isFinite(at) && at >= savedAt.getTime() && at > okAt) return err.message;
  }
  return null;
}

/**
 * The directions this save will actually write, with nothing left unsaid.
 *
 * ⚠ Called BEFORE validation and before every gate, and that is the point
 * rather than housekeeping. The gates read a cell to decide whether a node can
 * end it and a port to decide whether it is free; if the merge happened later,
 * inside the writer, they would judge a leg the save is not going to build. One
 * shape is checked and stored, or the checks are theatre.
 *
 * The rule itself (absent is not null) lives in direction-merge.ts with the
 * measurement that produced it.
 */
async function directionsForSave(
  cascadeId: string | null,
  incoming: CascadeDirectionInput[] | undefined,
): Promise<ResolvedDirection[] | undefined> {
  if (!incoming) return undefined;
  const stored = cascadeId
    ? await prisma.cascadeDirection.findMany({
        where: { cascadeId },
        select: {
          id: true,
          countryCode: true,
          linkProtocol: true,
          linkParams: true,
          nodes: { select: { nodeId: true } },
        },
      })
    : [];
  return resolveDirections(stored, incoming, (s) => ({
    countryCode: s.countryCode,
    linkProtocol: s.linkProtocol,
    linkParams: storedLinkParams(s.linkParams),
  }));
}

/**
 * The positions this save will write, with the knobs it did not mention.
 *
 * The same rule as the directions and for the same reason, one step simpler:
 * a position has no id and no pool matching, it IS its index. What it does NOT
 * do is carry the pool or the cell forward, and that is deliberate: those two
 * are what every screen sends on every save (a position with no nodes is
 * refused, a position with no cell is refused), so an absent one is a malformed
 * payload rather than "leave it alone". The knob is the only field a client can
 * legitimately stay silent about.
 */
async function positionsForSave(
  cascadeId: string | null,
  incoming: CascadePositionInput[] | undefined,
): Promise<CascadePositionInput[] | undefined> {
  if (!incoming) return undefined;
  if (!cascadeId) return incoming;
  const stored = await prisma.cascadePosition.findMany({
    where: { cascadeId },
    select: { position: true, linkParams: true },
  });
  const byIndex = new Map(stored.map((p) => [p.position, p]));
  return incoming.map((p) =>
    'linkParams' in p
      ? p
      : { ...p, linkParams: storedLinkParams(byIndex.get(p.position)?.linkParams) },
  );
}

/**
 * Fold a v4 payload into hops, or return null when the shape cannot be held by
 * the old model (a pool, or transits with several directions).
 *
 * Returning null rather than throwing is the point: v4 is the storage that
 * matters now, and the legacy hop rows are a convenience for rollback. A
 * topology that only v4 can express must still save.
 */
function tryFoldPositions(
  positions: CascadePositionInput[],
  directions: ResolvedDirection[],
): { mode: 'chain' | 'balancer'; hops: CascadeHopInput[] } | null {
  try {
    return foldPositionsIntoHops(positions, directions);
  } catch (err) {
    if (err instanceof CascadeValidationError) return null;
    throw err;
  }
}

/**
 * Write a cascade's v4 topology (positions, directions, links) inside `tx`.
 *
 * Runs ALONGSIDE the legacy hop write for now: storage moves first, readers
 * (fragment rendering, route profiles) follow in the next step. Until they do,
 * hops remain the source of truth and this is a shadow copy - which is exactly
 * what makes the switchover boring instead of a big-bang rewrite.
 *
 * Tag preservation is the whole point of the model, so it is spelled out here:
 *   - a direction the client identified by `id` keeps its tag;
 *   - one the client did not identify, but whose node pool matches a stored
 *     direction, is treated as that same direction (the panel does not send ids
 *     yet; without this fallback every save would burn new tags and silently
 *     reroute users);
 *   - anything else is new and draws the next tag from the cascade's counter;
 *   - a stored direction absent from the payload is deleted, and its tag is
 *     never handed out again.
 */
async function writeTopologyV4(
  tx: Prisma.TransactionClient,
  cascadeId: string,
  positions: {
    nodeIds: string[];
    position: number;
    entryProtocol?: string;
    linkProtocol?: string;
    linkParams?: LegParams | null;
  }[],
  directions: {
    id?: string;
    nodeIds: string[];
    countryCode?: string | null;
    /** Phase 5: the last leg's cell and knobs. Null means the entry's cell. */
    linkProtocol?: string | null;
    linkParams?: LegParams | null;
  }[],
): Promise<void> {
  const stored = await tx.cascadeDirection.findMany({
    where: { cascadeId },
    select: { id: true, tag: true, nodes: { select: { nodeId: true } } },
  });
  // Resolve each incoming direction to a tag before writing anything. The
  // matching rule itself is shared with the merge that filled these directions
  // in (direction-merge.ts): two copies of "which stored row is this" is two
  // chances to write a leg onto a row the merge read a different one from.
  const cascade = await tx.cascade.findUniqueOrThrow({
    where: { id: cascadeId },
    select: { nextDirectionTag: true },
  });
  let nextTag = cascade.nextDirectionTag;
  const matches = matchStoredDirections(stored, directions);
  const unclaimed = new Set(stored.map((d) => d.id));
  const resolved = directions.map((d, i) => {
    const match = matches[i];
    if (match) {
      unclaimed.delete(match.id);
      return { ...d, tag: match.tag, keepId: match.id };
    }
    return { ...d, tag: nextTag++, keepId: undefined as string | undefined };
  });

  /**
   * What the legs are configured with TODAY, read before they are dropped.
   *
   * The rows are replaced wholesale on every save (a leg has no identity of its
   * own in the table), so without this read every save would mint every secret
   * again. That is what it used to do: renaming a direction rotated the keys of
   * a leg carrying live traffic, and since the two ends are pushed one after
   * the other, the chain spent the gap as a pair that no longer agreed.
   *
   * A malformed row reads as absent and the leg is minted fresh, which is the
   * only safe answer: a cred nobody can parse cannot be the one the other end
   * is holding either.
   */
  const storedLinks = new Map<string, LinkCred>();
  for (const l of await tx.cascadeLink.findMany({
    where: { cascadeId },
    select: { fromNodeId: true, toNodeId: true, directionTag: true, config: true },
  })) {
    const cred = parseLinkCred(l.config);
    if (cred) storedLinks.set(topologyLinkKey(l.fromNodeId, l.toNodeId, l.directionTag), cred);
  }

  await tx.cascadeLink.deleteMany({ where: { cascadeId } });
  await tx.cascadePosition.deleteMany({ where: { cascadeId } });
  // Only the directions that actually WENT AWAY. This used to drop every row
  // and recreate all of them, which was invisible while nothing referenced a
  // direction: the tag survived, and the tag was the identity everything used.
  //
  // Э3 made the row id an identity too (a node-policy rule routes out through
  // a direction and stores its id), and delete-all would have broken that twice
  // over: every cascade edit would orphan every rule pointing at it, and the
  // RESTRICT that exists to protect those rules would refuse the edit outright.
  // A direction that survives an edit now survives as the same row.
  if (unclaimed.size > 0) {
    // Refused HERE, naming the policy, rather than left to the foreign key.
    // RESTRICT would also stop it, but with a message about a constraint on a
    // table the operator has never heard of, in the middle of saving a cascade.
    const blocking = await tx.nodePolicyRule.findMany({
      where: { actionDirectionId: { in: [...unclaimed] } },
      select: { policy: { select: { name: true } } },
    });
    if (blocking.length > 0) {
      const names = [...new Set(blocking.map((r) => r.policy.name))];
      throw new DirectionInUseByPolicyError(names);
    }
    await tx.cascadeDirection.deleteMany({
      where: { cascadeId, id: { in: [...unclaimed] } },
    });
  }

  for (const p of positions) {
    await tx.cascadePosition.create({
      data: {
        cascadeId,
        position: p.position,
        entryProtocol: p.entryProtocol ?? null,
        linkProtocol: p.linkProtocol ?? null,
        // Absence never reaches here: positionsForSave already carried the
        // stored knob forward, so `?? DbNull` writes a choice rather than
        // reading a silence as one. Same shape as the direction below.
        linkParams: p.linkParams ? (p.linkParams as Prisma.InputJsonValue) : Prisma.DbNull,
        nodes: { create: p.nodeIds.map((nodeId) => ({ nodeId })) },
      },
    });
  }
  /**
   * The port the last leg lands on, written HERE and never read from a request.
   *
   * It follows from the shape of the cascade: LINK_PORT_BASE + the number of
   * the last step, the same number `generateTopologyLinks` gives that leg's
   * credential. A client that could set it could point a leg at a port the node
   * already serves users on, and the panel would refuse the binding afterwards
   * rather than the leg.
   *
   * One value for every direction, because they all terminate on the step after
   * the last position: a direction is not a step of its own.
   */
  const directionLinkPort = LINK_PORT_BASE + Math.max(0, positions.length - 1);

  for (const d of resolved) {
    // Phase 5. Null is a VALUE here, not an absence: it means "the entry's
    // cell", which is what every direction did before the field existed.
    //
    // ⚠ Absence never reaches this point any more, and that is why `?? null` is
    // honest here rather than the bug it was. What a client did not mention was
    // filled in from storage before validation (directionsForSave), so by now
    // every field carries a value somebody chose: either this save's, or the
    // one already stored. Reading a missing key as null HERE is what dropped a
    // neighbouring direction's leg on 2026-09-22.
    const leg = {
      linkProtocol: d.linkProtocol ?? null,
      linkParams: d.linkParams ? (d.linkParams as Prisma.InputJsonValue) : Prisma.DbNull,
      linkPort: directionLinkPort,
    };
    if (d.keepId) {
      // The pool is rewritten, the row is not: its id is what policy rules hold.
      await tx.cascadeDirectionNode.deleteMany({ where: { directionId: d.keepId } });
      await tx.cascadeDirection.update({
        where: { id: d.keepId },
        data: {
          countryCode: d.countryCode ?? null,
          ...leg,
          nodes: { create: d.nodeIds.map((nodeId) => ({ nodeId })) },
        },
      });
      continue;
    }
    await tx.cascadeDirection.create({
      data: {
        cascadeId,
        tag: d.tag,
        countryCode: d.countryCode ?? null,
        ...leg,
        nodes: { create: d.nodeIds.map((nodeId) => ({ nodeId })) },
      },
    });
  }

  const links = await generateTopologyLinks(positions, resolved, storedLinks);
  if (links.length > 0) {
    await tx.cascadeLink.createMany({
      data: links.map((l) => ({
        cascadeId,
        fromNodeId: l.fromNodeId,
        toNodeId: l.toNodeId,
        directionTag: l.directionTag,
        protocol: l.protocol,
        config: serializeLinkCred(l.cred),
        // The same value as config.port, lifted out so a binding save can see
        // it. Written from one source here, so the two cannot disagree.
        port: l.cred.port,
      })),
    });
  }

  await writeTunnels(tx, cascadeId, positions, resolved);

  // Advance the counter past every tag handed out. Never `max(tag) + 1`: a
  // direction deleted later must not pass its tag to the next one.
  if (nextTag !== cascade.nextDirectionTag) {
    await tx.cascade.update({ where: { id: cascadeId }, data: { nextDirectionTag: nextTag } });
  }
}

/**
 * The AWG tunnels this topology's `awg` legs ride in, phase 8, written inside
 * the save's transaction.
 *
 * A pair still wanted keeps its row, keys, index and port: rotating a tunnel
 * under live traffic is an explicit act, never a side effect of an unrelated
 * edit (the lesson of the leg credentials, phase 5). A pair no longer wanted
 * loses its row, and its index goes back to the pool. A new pair takes the
 * smallest free index, panel-wide.
 *
 * The UDP port follows from the index, so it is known only here, after the
 * allocation, and the port check against profiles is asked here too: a
 * refusal throws and the transaction takes the whole save back.
 */
async function writeTunnels(
  tx: Prisma.TransactionClient,
  cascadeId: string,
  positions: { position?: number; nodeIds: string[]; linkParams?: LegParams | null }[],
  directions: { nodeIds: string[]; linkParams?: LegParams | null }[],
): Promise<void> {
  const wanted = topologyTunnelPairs(positions, directions);
  const key = (from: string, to: string) => `${from}|${to}`;
  const wantedKeys = new Set(wanted.map((p) => key(p.fromNodeId, p.toNodeId)));
  const stored = await tx.cascadeTunnel.findMany({ where: { cascadeId } });
  const kept = stored.filter(
    (t) => wantedKeys.has(key(t.fromNodeId, t.toNodeId)) && parseTunnelCred(t.config) !== null,
  );
  const dropped = stored.filter((t) => !kept.includes(t));
  if (dropped.length > 0) {
    await tx.cascadeTunnel.deleteMany({ where: { id: { in: dropped.map((t) => t.id) } } });
    getLogger().info(
      { cascadeId, tunnels: dropped.map((t) => tunnelIface(t.index)) },
      '[cascade] leg tunnels no longer wanted are taken down with this save',
    );
  }
  const have = new Set(kept.map((t) => key(t.fromNodeId, t.toNodeId)));
  const missing = wanted.filter((p) => !have.has(key(p.fromNodeId, p.toNodeId)));
  if (missing.length === 0) return;

  const used = new Set((await tx.cascadeTunnel.findMany({ select: { index: true } })).map((t) => t.index));
  const indexes = freeTunnelIndexes(used, missing.length);
  const created = missing.map((p, i) => ({
    cascadeId,
    fromNodeId: p.fromNodeId,
    toNodeId: p.toNodeId,
    index: indexes[i]!,
    port: tunnelPort(indexes[i]!),
    config: newTunnelCred() as unknown as Prisma.InputJsonValue,
  }));

  // The receiving end's UDP port against the profiles on it, the same refusal
  // the legs get (LINK_PORT_IN_USE): a profile holding the port is something
  // the operator can move, and it has to be moved before the tunnel can bind.
  const conflicts: { nodeName: string; port: number; transport: Transport; profileName: string }[] = [];
  for (const t of created) {
    const owners = await portOwnersOnNode(t.toNodeId, [t.port]);
    for (const o of owners) {
      if (o.kind !== 'profile' || o.transport !== 'udp') continue;
      const node = await tx.node.findUnique({ where: { id: t.toNodeId }, select: { name: true } });
      conflicts.push({ nodeName: node?.name ?? t.toNodeId, port: t.port, transport: 'udp', profileName: o.name });
    }
  }
  if (conflicts.length > 0) throw new CascadeLinkPortInUseError(conflicts);

  await tx.cascadeTunnel.createMany({ data: created });
}

/**
 * A leg with an `awg` underlay would end on a node without AmneziaWG, phase 8.
 *
 * Both ends of such a leg raise the tunnel, so both need the module. By FACT
 * only, the rule every gate here follows: the node reported an `amneziawg`
 * core and every such row says `installed: false`. A node that reported no
 * amneziawg row at all, or never reported, is let through.
 */
export class LinkUnderlayNotOnNodeError extends Error {
  readonly code = 'LINK_UNDERLAY_NOT_ON_NODE';
  constructor(public nodeNames: string[]) {
    super(
      `These nodes would raise an AmneziaWG tunnel under a cascade leg and report AmneziaWG as ` +
        `not installed: ${nodeNames.join(', ')}. Install it on them (bootstrap-amneziawg.sh) or ` +
        `keep those legs direct.`,
    );
    this.name = 'LinkUnderlayNotOnNodeError';
  }
}

async function assertUnderlayOnNodes(
  positions?: { position?: number; nodeIds: string[]; linkParams?: LegParams | null }[],
  directions?: { nodeIds: string[]; linkParams?: LegParams | null }[],
): Promise<void> {
  if (!positions || !directions) return;
  const pairs = topologyTunnelPairs(positions, directions);
  if (pairs.length === 0) return;
  const ids = [...new Set(pairs.flatMap((p) => [p.fromNodeId, p.toNodeId]))];
  const nodes = await prisma.node.findMany({ where: { id: { in: ids } }, select: { name: true, cores: true } });
  const missing = nodes
    .filter((n) => {
      const rows = ((n.cores as NodeCores | null)?.cores ?? []).filter((c) => c.engine === 'amneziawg');
      return rows.length > 0 && rows.every((c) => c.installed === false);
    })
    .map((n) => n.name);
  if (missing.length > 0) throw new LinkUnderlayNotOnNodeError(missing);
}

export async function createCascade(input: CreateCascadeInput): Promise<CascadeDto> {
  // The redesigned screens send positions + directions; storage still holds
  // single-node hops. Fold when that is what arrived, and let the fold decide
  // the mode from the shape rather than trusting a field the new UI no longer
  // has. See foldPositionsIntoHops for what cannot be folded and why.
  // The fold is now BEST-EFFORT. v4 accepts shapes the hop model cannot hold (a
  // pool on a step, transits combined with several directions), and the panel
  // offers them, so refusing here would block the very topologies the rewrite
  // exists for. When a shape does not fold we store v4 only; rendering already
  // prefers it, and hops stay behind purely as the rollback path for shapes
  // that still fit.
  // Nothing stored to carry forward on a create, so this only fills in the
  // pool a payload left out. Run through the same function as the edit so the
  // two paths cannot grow apart: every rule about absent keys is in one place.
  const directions = await directionsForSave(null, input.directions);
  const positions = await positionsForSave(null, input.positions);
  const folded = positions && directions ? tryFoldPositions(positions, directions) : null;
  const mode = folded ? folded.mode : (input.mode ?? 'chain');
  const isBalancer = mode === 'balancer';
  // Validate the topology in the effective mode (balancer exits carry no
  // linkProtocol, which the chain rules would wrongly reject). Empty when the
  // shape is v4-only: there are no hops to write, and everything below that
  // touches them is skipped.
  const legacyInput = folded ? folded.hops : input.hops;
  const hops = legacyInput ? validateCascadeHops(legacyInput, mode) : [];
  // Node existence is checked against whatever shape actually arrived.
  const allNodeIds = legacyInput
    ? hops.map((h) => h.nodeId)
    : [
        ...new Set([
          ...(positions ?? []).flatMap((p) => p.nodeIds),
          ...(directions ?? []).flatMap((d) => d.nodeIds),
        ]),
      ];
  // Named where they were named, and asked FIRST: a v4 payload usually folds
  // into hops as well, so checking the folded list first would answer with a
  // bare uuid about a screen full of named directions. The hop check stays for
  // a payload that carries hops and nothing else.
  await assertNodesExistNamed(nodeRefsOfTopology(positions, directions));
  await assertNodesExist(allNodeIds);
  // T7: an enabled balancer entry serves vlessRoute-tagged exit configs; gate
  // it on the entry's xray version. Disabled cascades don't expand in subs.
  // A v4-only shape gates on its entry position instead.
  const entryNodeId = hops[0]?.nodeId ?? positions?.find((p) => p.position === 0)?.nodeIds[0];
  if (input.enabled && entryNodeId && (isBalancer || !folded)) {
    await assertBalancerEntrySupportsVlessRoute(entryNodeId);
  }
  // Pre-generate inter-hop link creds.
  //   chain:    one cred per link, stored on each non-exit (originating) hop.
  //   balancer: one cred per exit link (entry->exit), stored on each EXIT hop;
  //             every link uses the entry hop's linkProtocol (uniform DC-to-DC).
  const creds = await generateLinkCreds(
    isBalancer
      ? hops.slice(1).map(() => normalizeLinkProtocol(hops[0]!.linkProtocol))
      : hops.slice(0, hops.length - 1).map((h) => normalizeLinkProtocol(h.linkProtocol)),
  );
  // Cred index for hop `idx`, or -1 if it carries no link cred.
  const credIdx = (idx: number): number =>
    isBalancer ? (idx >= 1 ? idx - 1 : -1) : idx < hops.length - 1 ? idx : -1;
  await assertLinkPortsFree(receivingLinkPorts(hops, creds), positions, directions);
  // Phase 5: and can the receiving side end the cell at all. After the ports
  // and before the write, because both answer the same question ("may this be
  // saved") about the same walk, and an operator fixing one wants to hear about
  // the other in the same breath.
  await assertNodesCarryCells(positions, directions);
  // Phase 8: a leg riding AWG needs AmneziaWG on both of its ends.
  await assertUnderlayOnNodes(positions, directions);
  // Phase 6: a hysteria entry reaches the cascade only through the chain
  // process, so its nodes must be able to run one.
  await assertEntryCanChain(positions);
  await assertEntryPolicyExists(input.entryPolicyId);
  // v4 topology, validated separately from the fold: the fold answers "can the
  // old storage hold this", these rules answer "is this a sane cascade at all".
  const topology =
    positions && directions ? validateCascadeTopology(positions, directions) : null;
  try {
    const c = await prisma.$transaction(async (tx) => {
      const created = await tx.cascade.create({
        data: {
          name: input.name,
          enabled: input.enabled,
          mode,
          hideHopsFromSub: input.hideHopsFromSub,
          autoProfile: input.autoProfile,
          ...(input.entryPolicyId ? { entryPolicy: { connect: { id: input.entryPolicyId } } } : {}),
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
      if (topology) {
        await writeTopologyV4(tx, created.id, topology.positions, topology.directions);
      }
      // Re-read, as the update path already does: `created` was captured BEFORE
      // the topology was written, so answering with it reports a cascade whose
      // positions and directions are empty, every time. The shape is stored
      // correctly and the next GET shows it, which is why this survived: what
      // the create ANSWERS has never carried the v4 topology at all.
      return tx.cascade.findUniqueOrThrow({ where: { id: created.id }, include: hopInclude });
    });
    // Push the chaining fragments to every hop now, not on some later unrelated
    // edit. inbounds.events re-syncs each node's inbound set, where
    // getCascadeFragmentsForNode injects the link-in/out + routing.
    emitCascadeChanged(c.id, allNodeIds, 'create');
    invalidateHiddenCascadeNodeCache();
    return mapCascade(c);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CascadeNameTakenError(input.name);
    }
    throw err;
  }
}

/**
 * Every node a cascade touches, whichever shape it is stored in.
 *
 * A cascade lives in two storages at once: the legacy `hops` chain and the v4
 * `positions`/`directions` topology. The fold that keeps `hops` in step
 * deliberately refuses two v4 shapes it cannot express, and a pool on a
 * position is one of them, so a perfectly ordinary cascade can have ZERO hop
 * rows. Read the membership from hops alone and such a cascade reports no
 * members at all.
 *
 * That is not cosmetic: this list is who gets the config pushed to them. On
 * 2026-08-15 a live cascade with a two-node entry pool had `hops = 0`, so every
 * save emitted `cascade.changed` with an empty list, no node was ever told
 * anything, and the panel said "Saving pushes the config to all 5 nodes" while
 * pushing to none. The entry cores sat with a config their xray had already
 * rejected and no way to ever receive a fixed one.
 */
/**
 * Announce a cascade change to the nodes it touches.
 *
 * Pushing to nobody is a bug, never a success. The panel tells the operator
 * "saving pushes the config to all N nodes"; when the member list came out
 * empty it pushed to none and said nothing, which is how a cascade with a
 * pooled entry stayed broken for hours on 2026-08-15 while every save looked
 * like it worked. An empty list means the cascade is stored in a shape nobody
 * can read, so it goes in the log at error level with the cascade named.
 */
function emitCascadeChanged(cascadeId: string, nodeIds: string[], action: string): void {
  if (nodeIds.length === 0) {
    getLogger().error(
      { cascadeId, action },
      '[cascades] nothing to push: this cascade has no member nodes in either shape, ' +
        'so no node was told about the change',
    );
    return;
  }
  eventBus.emit('cascade.changed', { nodeIds });
}

export function cascadeMemberNodeIds(c: {
  hops?: { nodeId: string }[];
  positions?: { nodes: { nodeId: string }[] }[];
  directions?: { nodes: { nodeId: string }[] }[];
}): string[] {
  return [
    ...new Set([
      ...(c.hops ?? []).map((h) => h.nodeId),
      ...(c.positions ?? []).flatMap((p) => p.nodes.map((n) => n.nodeId)),
      ...(c.directions ?? []).flatMap((d) => d.nodes.map((n) => n.nodeId)),
    ]),
  ];
}

export async function updateCascade(id: string, input: UpdateCascadeInput): Promise<CascadeDto> {
  const existing = await prisma.cascade.findUnique({
    where: { id },
    select: {
      id: true,
      mode: true,
      enabled: true,
      hops: { select: { nodeId: true, position: true } },
      // Read the v4 side too, or a cascade with no hop rows looks memberless.
      positions: { select: { nodes: { select: { nodeId: true } } } },
      directions: { select: { nodes: { select: { nodeId: true } } } },
    },
  });
  if (!existing) throw new CascadeNotFoundError(id);
  // Capture the pre-update members: a node dropped from the cascade (or a
  // disable toggle) must also re-push so its now-stale fragments are removed.
  const oldNodeIds = cascadeMemberNodeIds(existing);

  // ⚠ FIRST, before the fold and before every gate: what the payload did not
  // mention is filled in from what is stored. Everything below reads
  // `directions` and not `input.directions`, because a check run on the payload
  // would judge a leg this save is not going to build. See direction-merge.ts.
  const directions = await directionsForSave(id, input.directions);
  const positions = await positionsForSave(id, input.positions);

  // Same fold as create. A v4 payload also decides the mode, since the shape
  // now says it: one direction is a chain, several are a balancer.
  // Best-effort, same as create: a v4-only shape saves without hops.
  const folded = positions && directions ? tryFoldPositions(positions, directions) : null;
  const mode = (folded?.mode ?? input.mode ?? existing.mode) as 'chain' | 'balancer';
  const isBalancer = mode === 'balancer';
  const incomingHops = folded ? folded.hops : input.hops;
  const hops = incomingHops ? validateCascadeHops(incomingHops, mode) : null;
  /**
   * Every node this save names, checked, not only the folded hops.
   *
   * The hop list was the only thing asked about, and a v4-only payload folds
   * to nothing, so a save that carried positions and directions was never
   * checked at all. That is the hole the 2026-09-22 cascade came through: a
   * direction held a node that had been deleted, the panel sent the id back
   * unchanged because its node list simply had no row for it, and "Save and
   * push" went through. Afterwards the renderer refused to build anything for
   * the cascade's entries, and they stopped receiving config for a day.
   *
   * Both shapes are asked about, because both can be sent.
   */
  await assertNodesExistNamed(nodeRefsOfTopology(positions, directions));
  if (hops) await assertNodesExist(hops.map((h) => h.nodeId));
  // T7: gate an effectively-enabled balancer on the entry node's xray version
  // (covers both enabling an existing cascade and swapping in a new entry hop).
  const willBeEnabled = input.enabled ?? existing.enabled;
  if (isBalancer && willBeEnabled) {
    const entryNodeId = hops
      ? hops[0]!.nodeId
      : existing.hops.find((h) => h.position === 0)?.nodeId;
    if (entryNodeId) await assertBalancerEntrySupportsVlessRoute(entryNodeId);
  }
  const creds = hops
    ? await generateLinkCreds(
        isBalancer
          ? hops.slice(1).map(() => normalizeLinkProtocol(hops[0]!.linkProtocol))
          : hops.slice(0, hops.length - 1).map((h) => normalizeLinkProtocol(h.linkProtocol)),
      )
    : [];
  // Cred index for hop `idx` (of `n` total), or -1 if it carries no link cred.
  const credIdx = (idx: number, n: number): number =>
    isBalancer ? (idx >= 1 ? idx - 1 : -1) : idx < n - 1 ? idx : -1;

  // An edit re-picks the legs, so it can walk onto a port that was free when
  // the cascade was created. Asked here for the same reason as on create, and
  // before the transaction: a refusal must not leave half a cascade behind.
  await assertLinkPortsFree(hops ? receivingLinkPorts(hops, creds) : [], positions, directions);
  // An edit re-picks the cells too, and this is the edit that matters: choosing
  // a QUIC cell for a direction that has been served over vless since C3 is one
  // dropdown, and the node it lands on may be an xray-only machine nobody has
  // touched since.
  await assertNodesCarryCells(positions, directions);
  // Phase 8: a leg riding AWG needs AmneziaWG on both of its ends.
  await assertUnderlayOnNodes(positions, directions);
  // Phase 6, in this order. First whether the entry CAN chain, because that is
  // a refusal no confirmation lifts; asking the operator to confirm a switch
  // that is then refused anyway would be a question with no useful answer.
  await assertEntryCanChain(positions);
  await assertEntryChangeConfirmed(id, positions, input.confirmEntryChange === true);
  await assertEntryNodesDropConfirmed(id, positions, input.confirmEntryChange === true);
  await assertEntryPolicyExists(input.entryPolicyId);

  try {
    const c = await prisma.$transaction(async (tx) => {
      await tx.cascade.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.mode !== undefined ? { mode: input.mode } : {}),
          ...(input.hideHopsFromSub !== undefined
            ? { hideHopsFromSub: input.hideHopsFromSub }
            : {}),
          ...(input.autoProfile !== undefined ? { autoProfile: input.autoProfile } : {}),
          // Three values: absent leaves it, null clears it, an id sets it.
          ...('entryPolicyId' in input && input.entryPolicyId !== undefined
            ? { entryPolicyId: input.entryPolicyId }
            : {}),
        },
      });
      if (!hops && positions && directions) {
        // v4-only shape replacing a foldable one: the stale hop rows would
        // otherwise keep describing a topology that no longer exists.
        await tx.cascadeHop.deleteMany({ where: { cascadeId: id } });
      }
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
      // Shadow-write the v4 topology alongside the hops. Only when the payload
      // actually carried one: an enabled-only toggle must not wipe positions.
      if (positions && directions) {
        const topology = validateCascadeTopology(positions, directions);
        await writeTopologyV4(tx, id, topology.positions, topology.directions);
      }
      return tx.cascade.findUniqueOrThrow({ where: { id }, include: hopInclude });
    });
    // Re-push old + new members (deduped): old-only nodes drop their fragments,
    // new/kept nodes get the refreshed chain. An enabled-only toggle carries
    // neither shape, so newNodeIds is empty and we re-push the existing members.
    //
    // Both shapes are read, because either can be the only one present: a v4
    // payload whose entry carries a pool writes no hops at all.
    const newNodeIds = [
      ...(hops ?? []).map((h) => h.nodeId),
      ...(positions ?? []).flatMap((p) => p.nodeIds),
      ...(directions ?? []).flatMap((d) => d.nodeIds),
    ];
    emitCascadeChanged(id, [...new Set([...oldNodeIds, ...newNodeIds])], 'update');
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
/**
 * The wire shape a node receives, from a built hop config. Every path goes
 * through here.
 *
 * It exists because the three paths (v4 topology, legacy balancer, legacy
 * chain) each hand-copied the same field list, and the v4 one copied all of
 * them except `observatory`. A node then got a `leastPing` balancer with nobody
 * to measure the pings, and xray answers that by refusing the ENTIRE config
 * with "not all dependencies are resolved": no inbound, no cascade, core never
 * starts. The entry of a live cascade sat dead for hours behind a green node
 * card (2026-08-15).
 *
 * What makes it worth a helper rather than a fixed line: the builder was
 * correct and its config-validity test passed, because that test feeds xray the
 * BUILDER's output. The field was lost afterwards, in the copy. A shared mapper
 * is the only version of this that a future field cannot fall out of.
 */
export function toWireFragments(mine: HopConfig): XrayCascadeFragments {
  return {
    inbounds: mine.inbounds,
    // The node ships its own `direct` outbound; two with one tag make xray
    // reject the whole config.
    outbounds: mine.outbounds.filter((o) => o.tag !== 'direct'),
    routingRules: mine.routingRules,
    // Carry the link port + peer address so the node-agent can open UFW for the
    // inter-hop link itself (was a manual `ufw allow from <entry-ip>` step).
    linkIngressPort: mine.linkIngressPort,
    linkAllowFrom: mine.linkAllowFrom,
    // These two travel together or not at all: a balancer without its
    // observatory is a config xray rejects outright.
    balancers: mine.balancers,
    observatory: mine.observatory,
  };
}

/**
 * The fragments for this node, and a word in the log when there are none but
 * there should have been.
 *
 * A cascade can be enabled, drawn on the screen, and carry nothing at all: a
 * hop whose stored cred is missing or malformed makes the builders return null,
 * which is the right call (shipping half a chain blackholes user traffic) and
 * says nothing anywhere. The panel then shows an enabled cascade, the
 * subscription keeps handing out its entry, and the traffic goes nowhere.
 *
 * Found on live data: the only cascade in the local database is enabled, has
 * two hops and NULL `link_config` on both, so it has been shipping nothing
 * since it was written.
 *
 * A log line rather than a status or a refusal, deliberately: nobody has
 * measured how often this happens on a real fleet, and a red badge built on a
 * guess is worse than a line that tells us. The line names the cascade and the
 * node, which is what a search needs.
 */
export async function getCascadeFragmentsForNode(
  nodeId: string,
): Promise<XrayCascadeFragments | null> {
  const fragments = await buildCascadeFragmentsForNode(nodeId);
  // Nothing to draw by design, and nothing to warn about either.
  if (fragments === NO_LEGACY_DRAWING) return null;
  if (fragments) return fragments;
  // Only on the null path, so a node in no cascade at all pays nothing on the
  // way through, and the ordinary case stays one query lighter.
  const empty = await enabledCascadesTouching(nodeId);
  for (const name of empty) {
    getLogger().warn(
      `[cascade] cascade "${name}" is enabled but builds no fragments for node ${nodeId}: ` +
        `the chain carries nothing for it. Usually a hop with a missing or malformed link cred; ` +
        `re-save the cascade to regenerate them.`,
    );
  }
  return null;
}

/**
 * The chain block for one node: the config its own chain process runs, plus
 * what its user core must render while that process holds the chain.
 *
 * Phase 4, К6. Returns null for a node with no v4 topology, which is both "not
 * in a cascade" and "in a cascade written before the topology tables". The
 * second is deliberate: the chain renderer only knows the v4 shape, and a
 * legacy cascade keeps being drawn the way it always was rather than being
 * half-moved to a process that cannot express it.
 *
 * ⚠ THE PUSH SENDS THIS AND `cascade` TOGETHER for one release. They are two
 * drawings of one cascade for two kinds of agent, and they are NOT
 * interchangeable: `cascade` stays the legacy leg-dialling version because an
 * agent that cannot see this block applies it, and this block carries the
 * handover version because an agent that can see it ignores the other one.
 * Sending the handover drawing as `cascade` would point an old agent's xray at
 * a loopback port nothing on that machine is listening on.
 */
export async function getChainForNode(nodeId: string): Promise<NodeChain | null> {
  const topology = await readTopologyForNode(nodeId);
  if (!topology) return null;
  // Same read for both drawings, so the pair cannot disagree about the shape of
  // the cascade they describe.
  const role = chainRoleOf(nodeId, topology);
  if (!role) return null;

  const secret = await chainSecretFor(nodeId);
  const input = chainInputFor(nodeId, topology, role, secret);
  if (!input) return null;
  // t07-wire: an AmneziaWG entry's hand-off is minted from its interface's
  // listen port, so it is read here, where the database is.
  const awgPort =
    role === 'entry' && topology.entryProtocol === 'amneziawg' ? await awgInterfacePort(nodeId) : undefined;

  const config = renderChainConfig(input);
  // One listener per way out this node offers its user core. Only an entry has
  // any: a transit and an exit receive on a link and hand nothing over.
  const socks = (input.directionTags ?? []).map((tag) => ({ tag, port: chainSocksPort(tag) }));

  // Phase 8: this node's end of every tunnel under its legs, both directions.
  const tunnels: ChainTunnel[] = (topology.tunnels ?? [])
    .filter((x) => x.fromNodeId === nodeId || x.toNodeId === nodeId)
    .sort((a, b) => a.index - b.index)
    .map((x) =>
      x.fromNodeId === nodeId
        ? { iface: tunnelIface(x.index), conf: renderTunnelConf(x, 'from', topology.hosts.get(x.toNodeId)) }
        : { iface: tunnelIface(x.index), conf: renderTunnelConf(x, 'to'), listenPort: x.port },
    );

  return {
    engine: 'singbox',
    config: config as Record<string, unknown>,
    socks,
    socksPassword: secret,
    ...userCoreFor(nodeId, topology, role, secret, awgPort),
    ...(tunnels.length > 0 ? { tunnels } : {}),
  };
}

/**
 * The UDP port the AmneziaWG interface of this node listens on, or undefined
 * when the node serves no AmneziaWG binding (nothing to steer).
 *
 * The port of the enabled binding with the HIGHEST port, which is not a
 * preference but what the agent ends up with: fetchEnabledInbounds sends the
 * bindings in port order, the adapter carries one interface, and each AWG
 * inbound it applies replaces the last. The mark has to be that interface's.
 */
async function awgInterfacePort(nodeId: string): Promise<number | undefined> {
  const b = await prisma.profileNodeBinding.findFirst({
    where: { nodeId, enabled: true, profile: { enabled: true, protocol: 'amneziawg' } },
    orderBy: { port: 'desc' },
    select: { port: true },
  });
  return b?.port;
}

/**
 * What the entry's user core is told, one shape per entry protocol.
 *
 * ⚠ ONLY AN ENTRY HANDS ANYTHING OVER. A transit and an exit have their whole
 * side of the chain inside the process: their link-in listens on the link port,
 * and giving their user core the old fragments as well would put xray on that
 * same port, where one of the two loses the bind and the leg into this node
 * goes dark.
 *
 * And the engine is NAMED, which is the phase-6 part. The agent hands the
 * payload to the one core whose engine this says, and tells every other core
 * "not you". A hysteria entry that went out as xray fragments would leave its
 * hysteria users with no hand-off at all: out of the entry country, with a
 * working connection, while the panel shows a cascade.
 */
function userCoreFor(
  nodeId: string,
  topology: TopologyInput,
  role: ChainRole,
  secret: string,
  awgPort?: number,
): { userCore?: ChainUserCore } {
  if (role !== 'entry') return {};
  if (topology.entryProtocol === 'amneziawg') {
    // t07-wire: the agent steers the awg interface into the chain's tproxy
    // listener. No AWG binding on this entry, no interface to steer: then
    // nothing is handed over, and no xray drawing either (entersOnAnotherCore).
    if (awgPort === undefined) return {};
    return {
      userCore: {
        engine: 'amneziawg',
        tproxy: { port: CHAIN_TPROXY_PORT, mark: chainTProxyMark(awgPort) },
      },
    };
  }
  if (topology.entryProtocol === 'hysteria') {
    // One listener for the whole entry: Auto's, which chainInputFor always
    // renders for a hysteria entry. A port and not an address; the agent
    // writes 127.0.0.1 itself.
    //
    // Phase 9.3: every hysteria user is handed over as the user of the
    // cascade's ENTRY policy (the owner's decision of 24.09: they cannot pick
    // one), so the chain applies that policy's rules to all of them. None set
    // is the plain profile, p0, which the chain draws no rules for.
    const ordinal = topology.entryPolicyOrdinal ?? 0;
    return {
      userCore: {
        engine: 'hysteria',
        socks: { port: chainSocksPort(0), username: chainSocksUser(ordinal), password: secret },
      },
    };
  }
  const handover = buildTopologyFragmentsForNode(nodeId, { ...topology, chainSocksPassword: secret });
  return handover ? { userCore: { engine: 'xray', fragments: toWireFragments(handover) } } : {};
}

/** Which end of the chain this node is. Null when it is in the topology but
 *  carries no leg, which the fragment builder also refuses. */
function chainRoleOf(nodeId: string, t: TopologyInput): ChainRole | null {
  const incoming = t.links.some((l) => l.toNodeId === nodeId);
  const outgoing = t.links.some((l) => l.fromNodeId === nodeId);
  if (!incoming && !outgoing) return null;
  if (t.positions[0]?.nodeIds.includes(nodeId)) return 'entry';
  if (t.directions.some((d) => d.nodeIds.includes(nodeId))) return 'exit';
  return 'transit';
}

/**
 * The topology as the chain renderer wants it, from this node's point of view.
 *
 * The entry offers one way out per direction plus the Auto line when the
 * cascade has one; a transit receives on a link and forwards per direction; an
 * exit receives and stops.
 */
function chainInputFor(
  nodeId: string,
  t: TopologyInput,
  role: ChainRole,
  socksPassword: string,
): ChainRenderInput | null {
  // Phase 8: the tunnel under a pair, when its leg rides one.
  const tunnelUnder = (l: TopologyLinkRow): TopologyTunnel | undefined =>
    l.underlay === 'awg'
      ? t.tunnels?.find((x) => x.fromNodeId === l.fromNodeId && x.toNodeId === l.toNodeId)
      : undefined;
  const out = t.links
    .filter((l) => l.fromNodeId === nodeId)
    .map((l) => {
      const host = t.hosts.get(l.toNodeId);
      if (!host) return null;
      const tun = tunnelUnder(l);
      // Inside the tunnel the leg dials the far end's inner address, bound to
      // the interface, so it cannot leave any other way.
      return tun
        ? { tag: l.directionTag, host: tunnelAddresses(tun.index).to, cred: l.cred, via: tunnelIface(tun.index) }
        : { tag: l.directionTag, host, cred: l.cred };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  // A leg pointing at a node whose address we no longer have is the case the
  // fragment builder refuses out loud. Here the same answer, quietly: the push
  // that carries this block is already refused by that builder, and rendering
  // half a chain beside it would be worse than rendering none.
  if (out.length !== t.links.filter((l) => l.fromNodeId === nodeId).length) return null;

  const incoming = t.links.filter((l) => l.toNodeId === nodeId);
  /**
   * Where the listener binds, phase 8. Only when EVERY leg into this node rides
   * a tunnel does it bind the tunnels' inner addresses and nothing else, which
   * is what closes the leg's port to the internet. One leg over the internet
   * (a direction reaching this node directly beside one reaching it through a
   * tunnel) keeps the single 0.0.0.0 listener for all of them: a wildcard and
   * a specific address cannot share a port, and the tunnelled leg still
   * arrives through the tunnel, at the inner address the wildcard includes.
   */
  const listen = linkInListen(incoming, tunnelUnder);
  const inLeg = incoming[0]
    ? {
        ...(listen ? { listen } : {}),
        cred: incoming[0].cred,
        clients: incoming.map((l) => ({
          tag: l.directionTag,
          uuid: l.cred.protocol === 'vless' ? l.cred.uuid : undefined,
          // The short id of THAT leg. The listener takes a list of them beside
          // the node's one private key, so a leg left out here is a direction
          // whose dialler is refused at the handshake while both configs load.
          shortId: l.cred.protocol === 'vless' ? l.cred.reality?.shortId : undefined,
        })),
      }
    : undefined;

  if (role === 'entry') {
    // The tags the user core may ask for, Auto first when the cascade offers
    // it. Auto has no leg of its own: the chain renders it as a group over the
    // other ways out.
    const tags = [...new Set(out.map((l) => l.tag))].sort((a, b) => a - b);
    /**
     * ⚠ A hysteria entry gets Auto ALWAYS, phase 6.
     *
     * Its users cannot pick a way out (a hysteria user is a password, there is
     * no vlessRoute to carry a choice), so the whole entry hands to ONE socks
     * listener, and that listener is Auto's. Deriving it from `autoProfile`
     * the way the xray entry does would leave a cascade with one direction, or
     * with Auto switched off, with no listener on 26000 at all: every hysteria
     * user of the entry dialling a dead port. `autoProfile` stays what it is,
     * the switch for the Auto LINE in xray users' subscriptions.
     *
     * One direction becomes a group of one, which the engine accepts.
     */
    // And an amneziawg entry the same way, t07-wire: its user is a key, the
    // whole entry lands on the tproxy listener, and that routes to Auto.
    const handsWholeEntry = t.entryProtocol === 'hysteria' || t.entryProtocol === 'amneziawg';
    const directionTags = handsWholeEntry
      ? [0, ...tags]
      : t.auto && tags.length > 1
        ? [0, ...tags]
        : tags;
    // Phase 9.3: the route policies are carried out HERE, gated on the user
    // the entry's core hands each connection over as, and no longer on the
    // xray entry (buildTopologyFragmentsForNode draws none under handover).
    // Both halves travel in one push, so there is no moment with the policy
    // drawn twice or nowhere.
    const { policies, ruleSets } = chainPoliciesOf(t.policies ?? []);
    return {
      role,
      socksPassword,
      directionTags,
      out,
      ...(policies.length > 0 ? { policies, ruleSets: ruleSets.map((r) => ({ tag: r.tag, path: r.path })) } : {}),
      // The listener the agent's TPROXY rules steer to, with the entry policy
      // the whole entry carries (as a hysteria entry's socks user does).
      ...(t.entryProtocol === 'amneziawg' ? { tproxy: { ordinal: t.entryPolicyOrdinal ?? 0 } } : {}),
    };
  }
  if (!inLeg) return null;
  return role === 'exit' ? { role, socksPassword, in: inLeg } : { role, socksPassword, in: inLeg, out };
}

/**
 * Enabled cascades this node is a hop of, by name, in whichever storage.
 *
 * Both shapes are asked because a cascade lives in both: the legacy hops and
 * the v4 positions/directions. Reading one would call a cascade absent while
 * the other holds it.
 */
async function enabledCascadesTouching(nodeId: string): Promise<string[]> {
  const rows = await prisma.cascade.findMany({
    where: {
      enabled: true,
      OR: [
        { hops: { some: { nodeId } } },
        { positions: { some: { nodes: { some: { nodeId } } } } },
        { directions: { some: { nodes: { some: { nodeId } } } } },
      ],
    },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

/**
 * "This node's xray draws nothing of the cascade, and that is the design."
 *
 * Returned in three cases, all of them "the legacy block has nobody to serve":
 *   - the ENTRY of a cascade whose users enter on another core (hysteria,
 *     phase 6);
 *   - a node whose chain process is running by its last report: an agent that
 *     runs a chain ignores the legacy block entirely (E24);
 *   - a node with a leg in a cell xray cannot carry (hy2, tuic): there is no
 *     legacy drawing of it to send (E24).
 *
 * Distinct from null on purpose: null is logged as a cascade that builds no
 * fragments, and on these nodes that line would fire on every push until an
 * operator learned to ignore it, which is the one line that matters when
 * something is really missing.
 */
const NO_LEGACY_DRAWING = Symbol('no-legacy-drawing');

/**
 * Whether the legacy xray block of this node is moot, E24.
 *
 * On the stand, 2026-09-24: an operator switched a leg to hy2. The exit was
 * redrawn, and the push to the entry died building the LEGACY block, which has
 * no drawing of an hy2 leg and refused it. The whole push went with it, chain
 * block included, so the entry's chain kept dialling the old vless leg into a
 * port the exit no longer listened on: "connection refused", on a cascade whose
 * new shape was fine and whose chain block rendered without a fault.
 *
 * The legacy block exists for ONE reader, an agent too old to run the chain,
 * and a leg of a QUIC cell cannot reach such a node at all: the save refuses it
 * where the node reported its engines without sing-box (carriesCellAtSave). So
 * at push time there is nothing to refuse, only nothing to draw. Same for a
 * node whose chain is running: that agent does not read the block.
 */
async function legacyDrawingIsMoot(
  nodeId: string,
  links: { fromNodeId: string; toNodeId: string; cred: LinkCred }[],
): Promise<boolean> {
  const mine = links.filter((l) => l.fromNodeId === nodeId || l.toNodeId === nodeId);
  if (mine.some((l) => !LINK_CELL_ENGINES[l.cred.protocol].includes('xray'))) return true;
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { chainStatus: true } });
  return (node?.chainStatus as ChainStatus | null)?.running === true;
}

/**
 * Is this node the entry of a cascade whose users do NOT enter on xray?
 *
 * Hysteria (phase 6) and amneziawg (t07-wire): the entries that reach the
 * cascade only through the chain.
 *
 * ⚠ Such an entry must carry NO xray drawing at all, and this is what closes
 * it. The agent tells xray "not you" (ApplyCascade(nil)) when the chain block
 * names another engine, and nil there does not mean "no cascade": it means "read the
 * transitional copy on your inbound". If the panel still attached one, xray
 * would dial the legacy legs ITSELF beside the chain process, and its users
 * would stay cascaded: the opposite of what the operator confirmed when they
 * switched the entry, and a second process drawing one chain.
 */
function entersOnAnotherCore(nodeId: string, entryProtocol: string | null | undefined, entryNodeIds: string[]): boolean {
  return entryReachesCascadeOnlyThroughChain(entryProtocol) && entryNodeIds.includes(nodeId);
}

async function buildCascadeFragmentsForNode(
  nodeId: string,
): Promise<XrayCascadeFragments | null | typeof NO_LEGACY_DRAWING> {
  // v4 first. Falls through to the hop path for cascades written before the
  // topology tables existed, so a half-migrated fleet keeps serving.
  const v4 = await readTopologyForNode(nodeId);
  if (v4) {
    // Before the fall-through, not after it: the hop path would draw the same
    // entry from the legacy rows and put the xray drawing right back.
    if (entersOnAnotherCore(nodeId, v4.entryProtocol, v4.positions[0]?.nodeIds ?? [])) {
      return NO_LEGACY_DRAWING;
    }
    if (await legacyDrawingIsMoot(nodeId, v4.links)) return NO_LEGACY_DRAWING;
    const mine = buildTopologyFragmentsForNode(nodeId, v4);
    if (mine) return toWireFragments(mine);
  }

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
  // The same rule on the legacy rows, for a cascade that only has them.
  const entryHop = cascade.hops.find((h) => h.position === 0);
  if (entryHop && entersOnAnotherCore(nodeId, entryHop.entryProtocol, [entryHop.nodeId])) {
    return NO_LEGACY_DRAWING;
  }

  const hopInputs: CascadeConfigHopInput[] = cascade.hops.map((h) => ({
    nodeId: h.nodeId,
    position: h.position,
    // Public host the previous hop dials. node.address is host[:agentPort];
    // the link binds its own port (cred.port), so strip any agent port.
    nodeHost: h.node.address.split(':')[0]!,
  }));

  // A4 ad-split: emit EVERY defined policy's rules on the entry (policies are
  // global). The per-squad grant only gates which profiles the subscription
  // hands out; the node carries all so any granted tag resolves. Plain
  // (ordinal 0) is implicit in the builders.
  //
  // Read once for BOTH shapes. Until 2026-07-30 this lived inside the balancer
  // branch only, which is half of why ad-split silently did nothing on chains.
  const policies: CascadePolicy[] = (
    await prisma.routePolicy.findMany({
      select: { ordinal: true, directDomains: true, blockDomains: true },
    })
  ).map((p) => ({
    ordinal: p.ordinal,
    // Spelled for xray on the node: an operator's geo set is the file it was
    // laid out as (phase 9.2, xrayGeoEntry).
    directDomains: p.directDomains.map(xrayGeoEntry),
    blockDomains: p.blockDomains.map(xrayGeoEntry),
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
    const configs = buildBalancerCascadeConfigs(
      hopInputs[0]!,
      hopInputs.slice(1),
      exitCreds,
      policies,
    );
    const mine = configs.find((c) => c.nodeId === nodeId);
    if (!mine) return null;
    return toWireFragments(mine);
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

  const configs = buildCascadeConfigs(hopInputs, linkCreds, policies);
  const mine = configs.find((c) => c.nodeId === nodeId);
  if (!mine) return null;

  return toWireFragments(mine);
}

/**
 * The v4 topology around one node, as the renderers want it.
 *
 * One reader for both of them. The xray fragments and the chain config are two
 * drawings of the SAME cascade, and a node that got them from two reads could
 * be handed a leg in one and not in the other: the pair would be internally
 * consistent and wrong together, which is the hardest kind of wrong to see.
 */
async function readTopologyForNode(nodeId: string): Promise<TopologyInput | null> {
  const link = await prisma.cascadeLink.findFirst({
    where: {
      cascade: { enabled: true },
      OR: [{ fromNodeId: nodeId }, { toNodeId: nodeId }],
    },
    select: { cascadeId: true },
  });
  if (!link) return null;

  const [cascadeRow, positions, directions, links, policyRows, tunnelRows] = await Promise.all([
    prisma.cascade.findUnique({
      where: { id: link.cascadeId },
      select: { autoProfile: true, entryPolicy: { select: { ordinal: true } } },
    }),
    prisma.cascadePosition.findMany({
      where: { cascadeId: link.cascadeId },
      orderBy: { position: 'asc' },
      // entryProtocol since phase 6: it decides WHICH core of the entry is told
      // to hand its users to the chain, and the two answers are different
      // payloads (xray fragments, or one socks hand-off for hysteria).
      // linkParams since phase 8: the underlay of each leg is read off them.
      select: {
        position: true,
        entryProtocol: true,
        linkParams: true,
        nodes: { select: { nodeId: true } },
      },
    }),
    prisma.cascadeDirection.findMany({
      where: { cascadeId: link.cascadeId },
      orderBy: { tag: 'asc' },
      select: { tag: true, linkParams: true, nodes: { select: { nodeId: true } } },
    }),
    prisma.cascadeLink.findMany({
      where: { cascadeId: link.cascadeId },
      select: { fromNodeId: true, toNodeId: true, directionTag: true, config: true },
    }),
    prisma.routePolicy.findMany({
      select: { ordinal: true, directDomains: true, blockDomains: true },
    }),
    prisma.cascadeTunnel.findMany({
      where: { cascadeId: link.cascadeId },
      select: { fromNodeId: true, toNodeId: true, index: true, port: true, config: true },
    }),
  ]);
  const positionParams = positions.map((p) => ({
    position: p.position,
    nodeIds: p.nodes.map((n) => n.nodeId),
    linkParams: storedLinkParams(p.linkParams),
  }));
  const directionParams = directions.map((d) => ({
    tag: d.tag,
    nodeIds: d.nodes.map((n) => n.nodeId),
    linkParams: storedLinkParams(d.linkParams),
  }));
  const tunnels: TopologyTunnel[] = [];
  for (const t of tunnelRows) {
    const cred = parseTunnelCred(t.config);
    // A tunnel nobody can parse is no tunnel: the legs over its pair render
    // direct below (their underlay says awg and there is nothing under them),
    // which the agent's bind would otherwise turn into a leg that never dials.
    if (cred) tunnels.push({ fromNodeId: t.fromNodeId, toNodeId: t.toNodeId, index: t.index, port: t.port, cred });
  }

  // Public host per node, for dialling and for the firewall allow-list. The
  // stored address is host[:agentPort]; the link binds its own port.
  const nodeIds = new Set<string>();
  for (const l of links) {
    nodeIds.add(l.fromNodeId);
    nodeIds.add(l.toNodeId);
  }
  // `deletedAt: null` is load-bearing, not tidiness. A node is deleted SOFTLY,
  // and the v4 join rows survive it (they are RESTRICT, which a soft delete
  // never touches). Without the filter the row is still here, its address is
  // still known, and the render happily builds an outbound dialling a machine we
  // released. That is worse than losing the leg: the traffic goes to whoever
  // holds that address now. With the filter it becomes a missing host, and
  // buildTopologyFragmentsForNode refuses out loud.
  const nodeRows = await prisma.node.findMany({
    where: { id: { in: [...nodeIds] }, deletedAt: null },
    select: { id: true, address: true },
  });
  const hosts = new Map(nodeRows.map((n) => [n.id, n.address.split(':')[0]!]));

  const rows: TopologyLinkRow[] = [];
  for (const l of links) {
    const cred = parseLinkCred(l.config);
    // Malformed cred (data drift): ship nothing rather than a half-wired path
    // that blackholes user traffic.
    if (!cred) return null;
    rows.push({
      fromNodeId: l.fromNodeId,
      toNodeId: l.toNodeId,
      directionTag: l.directionTag,
      cred,
      underlay: legUnderlay(positionParams, directionParams, l.fromNodeId, l.toNodeId, l.directionTag),
    });
  }

  return {
    positions: positions.map((p) => ({
      position: p.position,
      nodeIds: p.nodes.map((n) => n.nodeId),
    })),
    directions: directions.map((d) => ({ tag: d.tag, nodeIds: d.nodes.map((n) => n.nodeId) })),
    links: rows,
    hosts,
    // As stored, the operator's spelling. Each renderer translates for its own
    // engine: the xray fragments in cascade.config.ts (xrayGeoEntry), the chain
    // in chain-policy.ts.
    policies: policyRows.map((p) => ({
      ordinal: p.ordinal,
      directDomains: p.directDomains,
      blockDomains: p.blockDomains,
    })),
    // The node has to know before the subscription hands the tag out: an Auto
    // profile whose rule is missing at the entry egresses from the entry
    // country instead of failing, which is the one outcome worth preventing.
    auto: cascadeRow?.autoProfile ?? false,
    ...(cascadeRow?.entryPolicy ? { entryPolicyOrdinal: cascadeRow.entryPolicy.ordinal } : {}),
    entryProtocol: positions.find((p) => p.position === 0)?.entryProtocol ?? undefined,
    tunnels,
  };
}

export class CascadeTunnelNotFoundError extends Error {
  constructor(public fromNodeId: string, public toNodeId: string) {
    super(`This cascade has no leg tunnel from node ${fromNodeId} to node ${toNodeId}`);
    this.name = 'CascadeTunnelNotFoundError';
  }
}

/**
 * Re-key the AWG tunnels under a cascade's legs, phase 8.3: all of them, or
 * the one of a node pair.
 *
 * The explicit act that a save never is. Keys and obfuscation are minted
 * afresh; index, interface, /30 and port stay, so nothing else on either node
 * moves. Both ends are pushed after, one after the other, and between the two
 * pushes the tunnel is a pair that no longer agrees: the legs inside it drop
 * until the second end lands. That is the price of a rotation, and it is paid
 * only when somebody asks for it.
 */
export async function rotateCascadeTunnels(
  id: string,
  pair?: { fromNodeId: string; toNodeId: string },
): Promise<CascadeDto> {
  const cascade = await prisma.cascade.findUnique({ where: { id }, select: { id: true } });
  if (!cascade) throw new CascadeNotFoundError(id);
  const tunnels = await prisma.cascadeTunnel.findMany({
    where: { cascadeId: id, ...(pair ? { fromNodeId: pair.fromNodeId, toNodeId: pair.toNodeId } : {}) },
    select: { id: true, index: true, fromNodeId: true, toNodeId: true },
  });
  if (pair && tunnels.length === 0) throw new CascadeTunnelNotFoundError(pair.fromNodeId, pair.toNodeId);
  await prisma.$transaction(
    tunnels.map((t) =>
      prisma.cascadeTunnel.update({
        where: { id: t.id },
        data: { config: newTunnelCred() as unknown as Prisma.InputJsonValue },
      }),
    ),
  );
  if (tunnels.length > 0) {
    getLogger().info(
      { cascadeId: id, tunnels: tunnels.map((t) => tunnelIface(t.index)) },
      '[cascade] leg tunnels re-keyed on request; the legs inside drop until both ends are pushed',
    );
    emitCascadeChanged(id, [...new Set(tunnels.flatMap((t) => [t.fromNodeId, t.toNodeId]))], 'rotate-tunnels');
  }
  return getCascade(id);
}

export async function deleteCascade(id: string): Promise<void> {
  // Grab the member nodes before deleting so we can re-push them afterwards to
  // strip the cascade fragments from their live xray config. Both shapes: a
  // v4-only cascade has no hop rows, and reading hops alone would leave its
  // nodes serving a cascade that no longer exists.
  const existing = await prisma.cascade.findUnique({
    where: { id },
    select: {
      hops: { select: { nodeId: true } },
      positions: { select: { nodes: { select: { nodeId: true } } } },
      directions: { select: { nodes: { select: { nodeId: true } } } },
    },
  });
  try {
    await prisma.cascade.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new CascadeNotFoundError(id);
    }
    throw err;
  }
  const members = existing ? cascadeMemberNodeIds(existing) : [];
  emitCascadeChanged(id, members, 'delete');
  invalidateHiddenCascadeNodeCache();
}
