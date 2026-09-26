import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type Cascade } from '@/lib/domain/cascades';
import { listBindings } from '@/lib/domain/profiles';
import { listRoutePolicies } from '@/lib/domain/routePolicies';
import { listSquads } from '@/lib/domain/squads';
import { type Node } from '@/lib/domain/nodes';
import { useOverview } from '@/lib/domain/dashboard';
import { listNamedOutbounds, outboundAddress } from '@/lib/domain/namedOutbounds';

/**
 * Что сказать на месте нод направления (E57): выход с адресом, пул, или
 * «ноды пока нет» только когда нет ни нод, ни выхода. `outboundGone`: выход
 * назван, но в списке его нет (удалён или список не пришёл).
 */
export type DirectionWhere =
  | { kind: 'outbound'; name: string; address: string }
  | { kind: 'outboundGone' }
  | { kind: 'pool' }
  | { kind: 'empty' };

export function directionWhere(d: Pick<DirectionView, 'outbound' | 'nodeName'>): DirectionWhere {
  if (d.outbound) {
    return d.outbound.name ? { kind: 'outbound', name: d.outbound.name, address: d.outbound.address } : { kind: 'outboundGone' };
  }
  return d.nodeName ? { kind: 'pool' } : { kind: 'empty' };
}

/**
 * Каскад, собранный вместе со всем, что его объясняет.
 *
 * Живёт в `lib/` контура, а не рядом с разметкой: хук в файле с компонентами
 * лишает их hot-reload, а типы, которые он возвращает, нужны обеим плотностям
 * отрисовки. Направление зависимостей при этом единственно верное: разметка
 * импортирует отсюда, не наоборот.
 */

/** Everything a cascade row or card needs, assembled once per cascade. */
export interface CascadeRow {
  cascade: Cascade;
  entry: HopView | null;
  /** Positions between the entry and the way out, in order. */
  transits: HopView[];
  /** The ways out. The tag identifies the direction, not the node under it. */
  directions: DirectionView[];
  /** Traffic that entered the cascade today: the entry pool's own. */
  todayBytes: number | null;
  squads: { name: string; members: number }[];
  policies: { name: string; ordinal: number }[];
  users: number;
}

/** One machine of a step's pool, as the dashboard poll sees it. */
export interface StepNode {
  id: string;
  name: string;
  node: Node | null;
  status: string;
  todayBytes: number | null;
}

/**
 * One step of the path: the entry (position 0) or a transit.
 *
 * A step is a POOL since v4: several interchangeable nodes. The tile names the
 * first and counts the rest; `nodes` has them all. The leg this step dials is
 * its own: `outCell` from the position's `linkProtocol`, `outUnderlay` from its
 * `linkParams`.
 */
export interface HopView {
  key: string;
  position: number;
  nodes: StepNode[];
  /** The first node of the pool, the one the tile names. */
  node: Node | null;
  nodeName: string;
  status: string;
  /** Summed over the pool; null while no node of it has a number. */
  todayBytes: number | null;
  entryProtocol: string | null;
  outCell: string | null;
  outUnderlay?: string;
}

/**
 * One way out of the cascade.
 *
 * Since v4 the tag and the country are the direction's own fields, read from
 * the API rather than derived from the node under it. That matters after a
 * delete: tags are never renumbered, so a row index would start naming the
 * wrong country while the link in a client still points at the old tag.
 *
 * `nodeName` is null when the pool is empty, which is a state the model can
 * hold on purpose: the tag exists, no node stands behind it yet.
 *
 * The leg INTO the direction: its own cell and underlay, else the last
 * position's, the same inheritance the server applies (and cascadeUnderlays).
 */
export interface DirectionView {
  key: string;
  nodes: StepNode[];
  nodeName: string | null;
  node: Node | null;
  status: string;
  todayBytes: number | null;
  tag: number;
  countryCode: string | null;
  inCell: string | null;
  inUnderlay?: string;
  /**
   * Фаза 10 (E57): направление стоит на именованном выходе, нод у него нет по
   * построению. `null` у направления на пуле. Выход не найден в списке (удалён
   * или список ещё не пришёл): `name` null, строка говорит «выход не найден».
   */
  outbound: { id: string; name: string | null; address: string; countryCode: string | null } | null;
}

/** Что выход направления несёт для строки каскада: имя, адрес, страна. */
export type OutboundLookup = ReadonlyMap<string, { name: string; address: string; countryCode: string | null }>;

type Overview = ReadonlyMap<string, { status?: string; todayBytes?: number | null }>;

function stepNode(id: string, fallbackName: string, nodeById: ReadonlyMap<string, Node>, overview: Overview): StepNode {
  const node = nodeById.get(id) ?? null;
  const ov = overview.get(id);
  return {
    id,
    name: node?.name ?? fallbackName,
    node,
    status: ov?.status ?? node?.status ?? 'unknown',
    todayBytes: ov?.todayBytes ?? null,
  };
}

function sumBytes(nodes: StepNode[]): number | null {
  return nodes.reduce<number | null>((s, n) => (n.todayBytes === null ? s : (s ?? 0) + n.todayBytes), null);
}

/**
 * The path of a cascade, drawn from what the API answers today.
 *
 * v4 answers with `positions` and `directions` and sends `hops: []`, so the
 * path is read from those: position 0 is the entry pool, positions 1..n the
 * transits, the directions the ways out with their own pools. `hops` is read
 * only when `positions` is empty: a cascade that predates the move, where the
 * balancer's exits were the hops after the entry.
 */
export function cascadePath(
  cascade: Pick<Cascade, 'mode' | 'hops' | 'positions' | 'directions'>,
  nodeById: ReadonlyMap<string, Node>,
  overview: Overview,
  outbounds: OutboundLookup = new Map(),
): { entry: HopView | null; transits: HopView[]; directions: DirectionView[] } {
  if (cascade.positions.length > 0) {
    const positions = [...cascade.positions].sort((a, b) => a.position - b.position);
    const steps: HopView[] = positions.map((p) => {
      const nodes = p.nodeIds.filter(Boolean).map((id) => stepNode(id, id, nodeById, overview));
      const first = nodes[0];
      return {
        key: `p${p.position}`,
        position: p.position,
        nodes,
        node: first?.node ?? null,
        nodeName: first?.name ?? '',
        status: first?.status ?? 'unknown',
        todayBytes: sumBytes(nodes),
        entryProtocol: p.entryProtocol,
        outCell: p.linkProtocol,
        ...(p.linkParams?.underlay ? { outUnderlay: p.linkParams.underlay } : {}),
      };
    });
    const last = steps[steps.length - 1];
    const directions: DirectionView[] = cascade.directions.map((d) => {
      const nodes = d.nodeIds.filter(Boolean).map((id) => stepNode(id, id, nodeById, overview));
      const first = nodes[0];
      const inUnderlay = d.linkParams?.underlay ?? last?.outUnderlay;
      const o = d.outboundId ? outbounds.get(d.outboundId) : undefined;
      return {
        key: d.id,
        nodes,
        nodeName: first?.name ?? null,
        node: first?.node ?? null,
        status: first?.status ?? 'unknown',
        todayBytes: sumBytes(nodes),
        tag: d.tag,
        countryCode: d.countryCode || first?.node?.countryCode || o?.countryCode || null,
        inCell: d.linkProtocol ?? last?.outCell ?? null,
        ...(inUnderlay ? { inUnderlay } : {}),
        outbound: d.outboundId
          ? { id: d.outboundId, name: o?.name ?? null, address: o?.address ?? '', countryCode: o?.countryCode ?? null }
          : null,
      };
    });
    return { entry: steps[0] ?? null, transits: steps.slice(1), directions };
  }

  // Before v4: a flat hop list, one node per hop.
  const hops = [...cascade.hops].sort((a, b) => a.position - b.position);
  const asStep = (h: (typeof hops)[number]): HopView => {
    const n = stepNode(h.nodeId, h.nodeName, nodeById, overview);
    return {
      key: h.id,
      position: h.position,
      nodes: [n],
      node: n.node,
      nodeName: n.name,
      status: n.status,
      todayBytes: n.todayBytes,
      entryProtocol: h.entryProtocol,
      outCell: h.linkProtocol,
    };
  };
  const entry = hops[0] ? asStep(hops[0]) : null;
  const rest = hops.slice(1).map(asStep);
  // A balancer's parallel exits are all directions; a chain has exactly one,
  // and everything before it is a transit position.
  const exits = cascade.mode === 'balancer' ? rest : rest.slice(-1);
  const transits = cascade.mode === 'balancer' ? [] : rest.slice(0, -1);
  const feeder = transits[transits.length - 1] ?? entry;
  const directions: DirectionView[] = exits.map((h, i) => ({
    key: h.key,
    nodes: h.nodes,
    nodeName: h.nodeName,
    node: h.node,
    status: h.status,
    todayBytes: h.todayBytes,
    tag: i + 1,
    countryCode: h.node?.countryCode ?? null,
    inCell: feeder?.outCell ?? null,
    outbound: null,
  }));
  return { entry, transits, directions };
}

/**
 * Join cascades with everything that explains them: node status and traffic
 * from the dashboard poll, squads and policies from the ACL. Kept in one hook so
 * both densities render off the same numbers.
 */
export function useCascadeRows(cascades: Cascade[], nodes: Node[]): CascadeRow[] {
  const overviewQuery = useOverview();
  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads });
  const policiesQuery = useQuery({ queryKey: ['route-policies'], queryFn: listRoutePolicies });
  const bindingsQuery = useQuery({ queryKey: ['bindings'], queryFn: () => listBindings() });
  // Фаза 10 (E57): имя и адрес выхода направления. DTO каскада несёт только
  // outboundId; список выходов тот же, что у их экрана.
  const outboundsQuery = useQuery({ queryKey: ['named-outbounds'], queryFn: listNamedOutbounds });

  return useMemo(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    const outbounds: OutboundLookup = new Map(
      (outboundsQuery.data?.outbounds ?? []).map(
        (o) => [o.id, { name: o.name, address: outboundAddress(o), countryCode: o.countryCode }] as const,
      ),
    );
    const overviewById = new Map((overviewQuery.data?.nodes ?? []).map((n) => [n.id, n] as const));
    const bindings = bindingsQuery.data?.bindings ?? [];
    const squads = squadsQuery.data?.squads ?? [];
    const policies = policiesQuery.data?.policies ?? [];

    return cascades.map((cascade) => {
      const { entry, transits, directions } = cascadePath(cascade, nodeById, overviewById, outbounds);

      // Who can actually use this cascade: squads holding a profile that is
      // bound on a node of the entry pool, since that is the door clients dial.
      const entryIds = new Set((entry?.nodes ?? []).map((n) => n.id));
      const entryProfiles = new Set(bindings.filter((b) => entryIds.has(b.nodeId)).map((b) => b.profileId));
      const reaching = squads.filter((s) => s.profileIds.some((p) => entryProfiles.has(p)));
      const grantedIds = new Set(reaching.flatMap((s) => s.policyIds));

      return {
        cascade,
        entry,
        transits,
        directions,
        todayBytes: entry?.todayBytes ?? null,
        squads: reaching.map((s) => ({ name: s.name, members: s.memberCount })),
        policies: policies
          .filter((p) => grantedIds.has(p.id))
          .map((p) => ({ name: p.name, ordinal: p.ordinal })),
        users: reaching.reduce((sum, s) => sum + s.memberCount, 0),
      };
    });
  }, [cascades, nodes, overviewQuery.data, squadsQuery.data, policiesQuery.data, bindingsQuery.data, outboundsQuery.data]);
}
