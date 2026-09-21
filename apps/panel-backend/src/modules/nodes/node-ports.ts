import type { Transport } from '@iceslab/shared';
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
export interface PortOwner {
  kind: 'profile' | 'cascade';
  /** Profile name or cascade name, whichever holds it. Shown to the operator. */
  name: string;
  port: number;
  /**
   * Cascade links are always tcp: both link cells, vless and SS2022, ride the
   * node's xray over TCP. A binding says what it is.
   */
  transport: Transport;
}

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
  if (ports.length === 0) return [];
  const wanted = [...new Set(ports)];

  const [bindings, links, legacy] = await Promise.all([
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
      select: { port: true, cascade: { select: { name: true } } },
    }),
    legacyHopLinkPorts(nodeId, wanted),
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
  const seen = new Set<string>();
  for (const l of [
    ...links.map((l) => ({ port: l.port, name: l.cascade.name })),
    ...legacy,
  ]) {
    const key = `${l.name}:${l.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    owners.push({ kind: 'cascade', name: l.name, port: l.port, transport: 'tcp' });
  }
  return owners;
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
): Promise<{ port: number; name: string }[]> {
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

  const out: { port: number; name: string }[] = [];
  for (const c of cascades) {
    for (let i = 0; i < c.hops.length - 1; i++) {
      const receiver = c.hops[i + 1]!;
      if (receiver.nodeId !== nodeId) continue;
      const cred = c.hops[i]!.linkConfig as { port?: unknown } | null;
      const port = cred && typeof cred.port === 'number' ? cred.port : null;
      if (port !== null && ports.includes(port)) out.push({ port, name: c.name });
    }
    // The balancer case: the cred sits on the exit that listens on it, so the
    // pairing above (cred on the hop BEFORE) misses it.
    for (let i = 1; i < c.hops.length; i++) {
      const hop = c.hops[i]!;
      if (hop.nodeId !== nodeId) continue;
      const cred = hop.linkConfig as { port?: unknown } | null;
      const port = cred && typeof cred.port === 'number' ? cred.port : null;
      if (port !== null && ports.includes(port)) out.push({ port, name: c.name });
    }
  }
  return out;
}
