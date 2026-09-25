import { ENGINE_NAMES, type EngineName } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { nativeEngineFor } from './node-engines.js';

/** One core a node must keep because a cascade runs on it, and which ones. */
export interface CascadeEngineNeed {
  engine: EngineName;
  cascades: { id: string; name: string; enabled: boolean }[];
}

/**
 * Which cores each node must keep for the cascades it stands in, one of the two
 * reasons a core cannot be removed (core-lifecycle.md section 8; the other is
 * `neededBy` on the core row; a node may end with no core, 25.09).
 *
 * By the fact of the code, what a cascade asks of a node:
 *   - singbox: any node of a v4 cascade (positions or directions), because the
 *     chain process that carries the legs is sing-box on every role;
 *   - the entry core, from the position's entryProtocol, on the nodes of
 *     position 0: that core takes the users in and hands them to the chain;
 *   - amneziawg: both ends of a leg that rides an AWG tunnel (cascade_tunnels);
 *   - xray: every hop of a cascade written before the topology tables, whose
 *     legs the node's xray dials itself.
 *
 * Disabled cascades count too, marked `enabled: false`: removing the core
 * breaks the cascade the day it is switched back on, and the screen decides
 * how to say that. One query for any number of nodes; nodes in no cascade are
 * absent from the map.
 */
export async function cascadeNeedsByNode(nodeIds: string[]): Promise<Map<string, CascadeEngineNeed[]>> {
  const out = new Map<string, CascadeEngineNeed[]>();
  if (nodeIds.length === 0) return out;
  const cascades = await prisma.cascade.findMany({
    where: {
      OR: [
        { hops: { some: { nodeId: { in: nodeIds } } } },
        { positions: { some: { nodes: { some: { nodeId: { in: nodeIds } } } } } },
        { directions: { some: { nodes: { some: { nodeId: { in: nodeIds } } } } } },
        { tunnels: { some: { OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }] } } },
      ],
    },
    select: {
      id: true,
      name: true,
      enabled: true,
      hops: { select: { nodeId: true } },
      positions: { select: { position: true, entryProtocol: true, nodes: { select: { nodeId: true } } } },
      directions: { select: { nodes: { select: { nodeId: true } } } },
      tunnels: { select: { fromNodeId: true, toNodeId: true } },
    },
  });

  // node -> engine -> cascade id -> the cascade's reference
  const acc = new Map<string, Map<EngineName, Map<string, { id: string; name: string; enabled: boolean }>>>();
  const wanted = new Set(nodeIds);
  const need = (nodeId: string, engine: EngineName, c: { id: string; name: string; enabled: boolean }) => {
    if (!wanted.has(nodeId)) return;
    const engines = acc.get(nodeId) ?? new Map();
    const list = engines.get(engine) ?? new Map();
    list.set(c.id, { id: c.id, name: c.name, enabled: c.enabled });
    engines.set(engine, list);
    acc.set(nodeId, engines);
  };

  for (const c of cascades) {
    const v4 = c.positions.length > 0 || c.directions.length > 0;
    if (v4) {
      for (const p of c.positions) {
        for (const n of p.nodes) {
          need(n.nodeId, 'singbox', c);
          if (p.position === 0) need(n.nodeId, nativeEngineFor(p.entryProtocol ?? 'xray'), c);
        }
      }
      for (const d of c.directions) for (const n of d.nodes) need(n.nodeId, 'singbox', c);
    } else {
      for (const h of c.hops) need(h.nodeId, 'xray', c);
    }
    for (const t of c.tunnels) {
      need(t.fromNodeId, 'amneziawg', c);
      need(t.toNodeId, 'amneziawg', c);
    }
  }

  for (const [nodeId, engines] of acc) {
    out.set(
      nodeId,
      ENGINE_NAMES.filter((e) => engines.has(e)).map((engine) => ({
        engine,
        cascades: [...engines.get(engine)!.values()].sort((a, b) => a.name.localeCompare(b.name)),
      })),
    );
  }
  return out;
}
