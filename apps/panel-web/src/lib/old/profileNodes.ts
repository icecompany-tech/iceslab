/**
 * profileId -> the number of distinct nodes its bindings stand on (A-259).
 *
 * A profile stands on a node once per port, so its bindings are not its nodes:
 * a screen that says «N nodes» counts nodes here, not bindings.
 */
export function nodesByProfile(bindings: readonly { profileId: string; nodeId: string }[]): Map<string, number> {
  const nodes = new Map<string, Set<string>>();
  for (const b of bindings) {
    const set = nodes.get(b.profileId) ?? new Set<string>();
    set.add(b.nodeId);
    nodes.set(b.profileId, set);
  }
  return new Map([...nodes].map(([id, set]) => [id, set.size] as const));
}
