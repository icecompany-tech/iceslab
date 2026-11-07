import type { NodeCoreInfo } from '@iceslab/shared';

/**
 * Two facts a core reports about itself (contract 49699f88), read for the
 * node page and the profile page.
 *
 * `countsUsers`: false means the core sees who is connected but counts no
 * bytes per user (sing-box built without the v2ray API, naive), so user limits
 * on it are not enforced. Only `false` is said; an absent field is an older
 * agent, unknown, and says nothing.
 *
 * `error`: why the core is not working right now, when it is a FAULT. Not
 * `reason`, which says a core does not run by design.
 */
export function coreUncounted(core: Pick<NodeCoreInfo, 'countsUsers'>): boolean {
  return core.countsUsers === false;
}

export function coreFault(core: Pick<NodeCoreInfo, 'error'>): string | null {
  const e = typeof core.error === 'string' ? core.error.trim() : '';
  return e === '' ? null : e;
}

/**
 * The nodes on which this engine counts no traffic per user: a core row of
 * that engine reports `countsUsers: false`. A row without `engine` (older
 * agent) is matched by its protocol name only when that IS the engine.
 */
export function uncountedNodes(
  nodes: readonly { id: string; name: string; cores?: { cores?: readonly NodeCoreInfo[] } | null }[],
  engine: string,
): { id: string; name: string }[] {
  return nodes
    .filter((n) => (n.cores?.cores ?? []).some((c) => (c.engine ?? c.name) === engine && coreUncounted(c)))
    .map((n) => ({ id: n.id, name: n.name }));
}
