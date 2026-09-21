import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type Cascade, type CascadeHop } from '@/lib/domain/cascades';
import { listBindings } from '@/lib/domain/profiles';
import { listRoutePolicies } from '@/lib/domain/routePolicies';
import { listSquads } from '@/lib/domain/squads';
import { type Node } from '@/lib/domain/nodes';
import { useOverview } from '@/lib/domain/dashboard';

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
  /** Positions between the entry and the way out. A cascade with one direction
   *  can still have them; a fan of directions cannot. */
  transits: HopView[];
  /** The ways out. The tag identifies the direction, not the node under it. */
  directions: DirectionView[];
  /** Traffic that entered the cascade today, i.e. the entry node's own. */
  todayBytes: number | null;
  squads: { name: string; members: number }[];
  policies: { name: string; ordinal: number }[];
  users: number;
}

export interface HopView {
  hop: CascadeHop;
  node: Node | null;
  status: string;
  todayBytes: number | null;
  /** The hop acknowledged the config pushed after the last save. */
  applied: boolean | null;
}

/**
 * One way out of the cascade.
 *
 * Since v4 the tag and the country are the direction's own fields, read from
 * the API rather than derived from the node under it. That matters after a
 * delete: tags are never renumbered, so a row index would start naming the
 * wrong country while the link in a client still points at the old tag.
 *
 * `hop` and `nodeName` are null when the pool is empty, which is a state the
 * new model can hold on purpose: the tag exists, no node stands behind it yet.
 */
export interface DirectionView {
  key: string;
  hop: CascadeHop | null;
  nodeName: string | null;
  node: Node | null;
  status: string;
  todayBytes: number | null;
  applied: boolean | null;
  tag: number;
  countryCode: string | null;
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

  return useMemo(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    const overviewById = new Map((overviewQuery.data?.nodes ?? []).map((n) => [n.id, n] as const));
    const bindings = bindingsQuery.data?.bindings ?? [];
    const squads = squadsQuery.data?.squads ?? [];
    const policies = policiesQuery.data?.policies ?? [];

    return cascades.map((cascade) => {
      const view = (hop: CascadeHop): HopView => {
        const node = nodeById.get(hop.nodeId) ?? null;
        const ov = overviewById.get(hop.nodeId);
        return {
          hop,
          node,
          status: ov?.status ?? node?.status ?? 'unknown',
          todayBytes: ov?.todayBytes ?? null,
          applied: null,
        };
      };
      const hops = [...cascade.hops].sort((a, b) => a.position - b.position);
      const entry = hops[0] ? view(hops[0]) : null;
      const rest = hops.slice(1).map(view);
      // A balancer's parallel exits are all directions; a chain has exactly one,
      // and everything before it is a transit position.
      const exits = cascade.mode === 'balancer' ? rest : rest.slice(-1);
      const transits = cascade.mode === 'balancer' ? [] : rest.slice(0, -1);

      // v4 answers with directions of their own, and those win: they carry the
      // real tag and the country the operator chose. A pre-v4 cascade has none,
      // and its exits are read from the hop list as before, where the tag can
      // only be guessed from the order.
      const directions: DirectionView[] = cascade.directions.length
        ? cascade.directions.map((d) => {
            const nodeId = d.nodeIds[0] ?? null;
            const node = nodeId ? nodeById.get(nodeId) ?? null : null;
            const ov = nodeId ? overviewById.get(nodeId) : undefined;
            const hop = nodeId ? hops.find((h) => h.nodeId === nodeId) ?? null : null;
            return {
              key: d.id,
              hop,
              nodeName: node?.name ?? hop?.nodeName ?? null,
              node,
              status: ov?.status ?? node?.status ?? 'unknown',
              todayBytes: ov?.todayBytes ?? null,
              applied: null,
              tag: d.tag,
              countryCode: d.countryCode || node?.countryCode || null,
            };
          })
        : exits.map((h, i) => ({
            key: h.hop.id,
            hop: h.hop,
            nodeName: h.hop.nodeName,
            node: h.node,
            status: h.status,
            todayBytes: h.todayBytes,
            applied: h.applied,
            tag: i + 1,
            countryCode: h.node?.countryCode ?? null,
          }));

      // Who can actually use this cascade: squads holding a profile that is
      // bound on the entry node, since that is the door clients dial.
      const entryProfiles = new Set(
        bindings.filter((b) => b.nodeId === entry?.hop.nodeId).map((b) => b.profileId),
      );
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
  }, [cascades, nodes, overviewQuery.data, squadsQuery.data, policiesQuery.data, bindingsQuery.data]);
}
