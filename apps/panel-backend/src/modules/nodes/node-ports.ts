import { LINK_CELL_TRANSPORT, type ChainStatus, type LinkCell, type NodeCores, type Transport } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { LINK_PORT_BASE } from '../cascades/cascade.config.js';

/**
 * Who holds a port on a node.
 *
 * A node's ports are claimed from two places that never meet in the database:
 * the BINDINGS deployed on it, and the cascade LINKS that terminate on it. The
 * uniqueness key added in the migration before this one guards the first
 * against itself and can do nothing about the second, because no index spans
 * two tables. So the refusal lives here, and both saves ask it: a binding save
 * asks about links, a cascade save asks about bindings.
 *
 * Until this existed the second case was silent. A profile bound to port 24000
 * saved fine, the node then failed to bind one of the two listeners, and the
 * only trace was a line in the agent's journal hours after the save that caused
 * it.
 *
 * ⚠ INCOMPLETE ON PURPOSE, and the incompleteness has a direction. A node also
 * holds ports that neither table knows: the hysteria auth callback, the
 * sing-box api socket, whatever else its cores opened. Those arrive from the
 * agent and are not read here yet. So this answer can say "taken, by that" and
 * must never be read as "everything else is free". The caller that needs to
 * promise free is the port check of piece 2.3, and it carries a certainty flag
 * for exactly this reason.
 */
interface PortOwnerBase {
  port: number;
  /**
   * A binding says what it is, a core service says what the agent reported, and
   * a cascade leg says what its CELL is.
   *
   * ⚠ That last one used to be the constant `tcp`, which was true while the
   * only cells were vless and SS2022 inside the node's xray. Phase 5 made two
   * of the four QUIC, so the constant became a claim that a tuic leg holds
   * 24000/TCP: it would have refused a TCP profile that can legally take that
   * port and, worse, promised a UDP one the port the leg actually holds.
   */
  transport: Transport;
}

/**
 * On the wire this is `{ kind, name?, ownerKey?, port, transport }`. A UNION
 * here rather than one object with two optional labels, so a caller that reads
 * `name` off a core service does not compile: those two fields are not
 * alternatives, they are different KINDS of identity.
 *
 * A profile and a cascade have a name the operator chose. A core service has
 * none: it has a KEY (`hysteria-auth`, `singbox-api`) that the panel turns into
 * words. The agent never sends a sentence, because the screen is bilingual and
 * English prose from a node could not be translated.
 *
 * The key set is OPEN: a panel meeting an unknown key shows the key itself.
 */
export type PortOwner =
  | (PortOwnerBase & { kind: 'profile'; name: string })
  | (PortOwnerBase & { kind: 'cascade'; name: string })
  | (PortOwnerBase & { kind: 'core-service'; ownerKey: string });

/**
 * How complete the answer is.
 *
 * `full` means all three sources spoke: bindings and cascade links always do
 * (they are ours), and the node reported its cores. `partial` means the node
 * has never reported, or reported cores of an agent too old to list reserved
 * ports, so ports its services hold are invisible here.
 *
 * The distinction is the whole reason this is not a boolean. A partial answer
 * is enough to REFUSE a port it names, and never enough to promise a port it
 * does not: the same rule the engine gate is built on, learned there twice.
 */
export type PortCertainty = 'full' | 'partial';

/**
 * Every claim on `ports` at `nodeId`, from both tables.
 *
 * `exceptBindingId` skips the row being edited, or an unchanged save would
 * report the binding colliding with itself.
 */
export async function portOwnersOnNode(
  nodeId: string,
  ports: number[],
  opts: { exceptBindingId?: string } = {},
): Promise<PortOwner[]> {
  return (await portClaimsOnNode(nodeId, ports, opts)).owners;
}

/**
 * The same question, with the answer's completeness attached.
 *
 * Two functions rather than one with an ignored field: a caller that only wants
 * to REFUSE does not need the certainty and should not have to carry it, while
 * a caller that wants to say "free" cannot be allowed to forget it.
 */
export async function portClaimsOnNode(
  nodeId: string,
  ports: number[],
  opts: { exceptBindingId?: string } = {},
): Promise<{ owners: PortOwner[]; certainty: PortCertainty }> {
  if (ports.length === 0) return { owners: [], certainty: 'full' };
  const wanted = [...new Set(ports)];

  const [bindings, links, tunnels, legacy, node] = await Promise.all([
    prisma.profileNodeBinding.findMany({
      where: {
        nodeId,
        port: { in: wanted },
        ...(opts.exceptBindingId ? { id: { not: opts.exceptBindingId } } : {}),
      },
      select: { port: true, transport: true, profile: { select: { name: true } } },
    }),
    prisma.cascadeLink.findMany({
      where: { toNodeId: nodeId, port: { in: wanted } },
      // The cred comes with it since phase 5: the cell inside it is what says
      // whether this leg holds a TCP or a UDP socket.
      select: { port: true, config: true, cascade: { select: { name: true } } },
    }),
    // Phase 8: the UDP port a leg's AWG tunnel listens on at its receiving end.
    prisma.cascadeTunnel.findMany({
      where: { toNodeId: nodeId, port: { in: wanted } },
      select: { port: true, cascade: { select: { name: true } } },
    }),
    legacyHopLinkPorts(nodeId, wanted),
    prisma.node.findUnique({ where: { id: nodeId }, select: { cores: true, chainStatus: true } }),
  ]);

  const owners: PortOwner[] = bindings.map((b) => ({
    kind: 'profile' as const,
    name: b.profile.name,
    port: b.port,
    transport: b.transport as Transport,
  }));

  // One cascade terminating N directions on one node holds ONE port, and the
  // two cascade sources overlap by design, so both are deduplicated into the
  // same set.
  //
  // ⚠ The TRANSPORT is part of the key, not decoration. Since phase 5 two
  // directions reaching the same node can be reached over different cells, and
  // a tuic leg and a vless leg on one step share the port NUMBER while holding
  // two different sockets. Keyed without it, whichever arrived first would
  // silence the other, and the answer would name one of the two claims on 24000
  // as though it were the only one.
  const seen = new Set<string>();
  for (const l of [
    ...links.map((l) => ({
      port: l.port,
      name: l.cascade.name,
      transport: legTransport(l.config),
    })),
    // Always UDP: AmneziaWG is.
    ...tunnels.map((t) => ({ port: t.port, name: t.cascade.name, transport: 'udp' as Transport })),
    ...legacy,
  ]) {
    const key = `${l.name}:${l.port}:${l.transport}`;
    if (seen.has(key)) continue;
    seen.add(key);
    owners.push({ kind: 'cascade', name: l.name, port: l.port, transport: l.transport });
  }

  // The third source, and the only one that can be missing. A node that never
  // reported, or reported through an agent older than the field, holds ports
  // nothing here can see.
  const inventory = (node?.cores as NodeCores | null) ?? null;
  const chain = (node?.chainStatus as ChainStatus | null) ?? null;
  // ONE set out of two lists. The chain process is not a core and reports its
  // loopback socks ports in its own block, which is what keeps the answer from
  // saying "xray holds 26000" about a port the chain holds. Here that
  // distinction has already done its work: what a caller needs is who holds the
  // port, and the owner KEY says that, whichever list it arrived in.
  const reserved = [
    ...(inventory?.cores ?? []).flatMap((c) => c.reservedPorts ?? []),
    ...(chain?.reservedPorts ?? []),
  ];
  for (const rp of reserved) {
    if (!wanted.includes(rp.port)) continue;
    owners.push({
      kind: 'core-service',
      ownerKey: rp.owner,
      port: rp.port,
      transport: rp.transport,
    });
  }

  return { owners, certainty: certaintyOf(inventory) };
}

/**
 * Can this answer promise a port is free?
 *
 * Only when the node has reported AND every core it listed answered about its
 * ports. One silent core is enough to make the list incomplete, and it is
 * exactly the core that might be holding the port being asked about.
 *
 * An EMPTY list is an answer, not a silence: the agent sends `[]` from an
 * adapter that reserves nothing and no key at all from one that cannot speak.
 * Without that distinction a node running only mieru or naive could never be
 * answered about with certainty, which is a permanent "we do not know" about a
 * machine that is in fact fully known.
 *
 * The CHAIN needs no seat in this judgement, and that is a property of its
 * shape rather than an omission: it either runs socks listeners or does not
 * exist, so the presence of its block IS the answer and its list can never be
 * the empty-or-silent pair the cores have to be read through.
 */
function certaintyOf(inventory: NodeCores | null): PortCertainty {
  if (!inventory || inventory.cores.length === 0) return 'partial';
  return inventory.cores.every((c) => c.reservedPorts !== undefined) ? 'full' : 'partial';
}

/**
 * Which socket a stored leg holds, read from the cred it was saved with.
 *
 * ⚠ TCP for anything unreadable, and that is the SAFE side rather than a
 * guess. This answer is used to refuse, so being wrong towards "taken" costs an
 * operator one port and being wrong towards "free" costs them a listener that
 * silently fails to bind on the node. A cred with no readable cell is a row
 * from before the cells existed, and every one of those was vless or SS2022,
 * both TCP.
 */
function legTransport(config: unknown): Transport {
  const cell = (config as { protocol?: unknown } | null)?.protocol;
  if (typeof cell !== 'string') return 'tcp';
  return LINK_CELL_TRANSPORT[cell as LinkCell] ?? 'tcp';
}

/**
 * The same claim, read out of the storage that predates `cascade_links`.
 *
 * Reading only the indexed column would be the tidy version and would also be
 * WRONG as a refusal: `cascade_links` is a shadow-write of the v4 topology, and
 * a cascade saved before it existed, or one whose shape does not fold into the
 * v4 tables, has its ports only inside `CascadeHop.linkConfig`. A partial list
 * is enough to say yes and useless for saying no, which is the rule this
 * codebase already learned twice on the engine gate.
 *
 * Who listens on the port a hop's cred names:
 *   chain:    the cred on hop[i] is dialled by hop[i] and LISTENED ON by
 *             hop[i+1].
 *   balancer: the cred on an exit hop is dialled by the entry and listened on
 *             by that exit itself.
 * Both come out as "the hop after the one holding the cred, in position
 * order", because a balancer's exits are exactly hops[1..].
 */
async function legacyHopLinkPorts(
  nodeId: string,
  ports: number[],
): Promise<{ port: number; name: string; transport: Transport }[]> {
  // Only cascades that reach this node at all, and only those whose ports can
  // possibly match: every link port is LINK_PORT_BASE + step.
  if (!ports.some((p) => p >= LINK_PORT_BASE)) return [];

  const cascades = await prisma.cascade.findMany({
    where: { hops: { some: { nodeId } } },
    select: {
      name: true,
      hops: {
        select: { nodeId: true, position: true, linkConfig: true },
        orderBy: { position: 'asc' },
      },
    },
  });

  const out: { port: number; name: string; transport: Transport }[] = [];
  for (const c of cascades) {
    for (let i = 0; i < c.hops.length - 1; i++) {
      const receiver = c.hops[i + 1]!;
      if (receiver.nodeId !== nodeId) continue;
      const cred = c.hops[i]!.linkConfig as { port?: unknown } | null;
      const port = cred && typeof cred.port === 'number' ? cred.port : null;
      if (port !== null && ports.includes(port)) {
        out.push({ port, name: c.name, transport: legTransport(cred) });
      }
    }
    // The balancer case: the cred sits on the exit that listens on it, so the
    // pairing above (cred on the hop BEFORE) misses it.
    for (let i = 1; i < c.hops.length; i++) {
      const hop = c.hops[i]!;
      if (hop.nodeId !== nodeId) continue;
      const cred = hop.linkConfig as { port?: unknown } | null;
      const port = cred && typeof cred.port === 'number' ? cred.port : null;
      if (port !== null && ports.includes(port)) {
        out.push({ port, name: c.name, transport: legTransport(cred) });
      }
    }
  }
  return out;
}
