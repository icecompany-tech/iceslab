import { editGate, type GateView } from '@/lib/old/loadView';

type Q = { data: unknown; isError: boolean };

/**
 * Whether every list a fact rests on has arrived (A-234, A-247). «No node»
 * needs the binding and node lists, «unbound» the binding and profile lists;
 * one function so the cards and the bar cannot read it two ways.
 */
export function listsArrived(...lists: readonly { data: unknown }[]): boolean {
  return lists.every((q) => q.data !== undefined);
}

/**
 * The three counts of the hosts bar (A-234). «Live» and «no node» are facts
 * only with the binding and node lists in hand: without them «live» is «-»
 * and an orphan is not counted, instead of every host reading as having no
 * node.
 */
export function hostsBarCounts(
  rows: readonly { host: { enabled: boolean }; nodes: readonly { status: string }[]; nodesKnown: boolean }[],
  nodesKnown: boolean,
): { live: number | '-'; degraded: number; orphaned: number } {
  const isDegraded = (r: (typeof rows)[number]) =>
    r.host.enabled && r.nodes.length > 0 && r.nodes.some((n) => n.status !== 'online');
  return {
    live: nodesKnown ? rows.filter((r) => r.host.enabled && r.nodes.length > 0 && !isDegraded(r)).length : '-',
    degraded: rows.filter(isDegraded).length,
    orphaned: rows.filter((r) => r.nodesKnown && r.nodes.length === 0).length,
  };
}

/**
 * The gate of the host page (A-141, A-234): an existing host waits for the
 * host list, and the binding, node and profile lists; a new one for the node
 * and profile lists. The form opens only when all of them answered. `failed`
 * names the list that failed, so the retry asks that one.
 */
export type HostGateList = 'hosts' | 'bindings' | 'nodes' | 'profiles';

export function hostEditGate(
  isNew: boolean,
  q: { hosts: Q; bindings: Q; nodes: Q; profiles: Q },
  hostFound: boolean,
): { view: GateView; failed: HostGateList | null } {
  const others: HostGateList[] = isNew ? ['nodes', 'profiles'] : ['bindings', 'nodes', 'profiles'];
  const view = isNew
    ? editGate({ data: true, isError: false }, true, others.map((k) => q[k]))
    : editGate(q.hosts, hostFound, others.map((k) => q[k]));
  const failed = view.kind === 'failed' ? (view.index === 0 ? 'hosts' : others[view.index - 1]!) : null;
  return { view, failed };
}
