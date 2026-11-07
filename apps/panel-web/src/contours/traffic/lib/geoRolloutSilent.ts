/**
 * The nodes of a rollout plan whose xray restart is «maybe», not a fact
 * (A-253): those that reported no cores. Without the node list the panel
 * knows nothing of anyone's cores, so every node of the plan is «maybe»; an
 * empty set there would have said «restarts xray» about all of them.
 */
export function rolloutSilent(
  planNodeIds: readonly string[],
  nodes: readonly { id: string; cores?: unknown }[] | undefined,
): ReadonlySet<string> {
  if (nodes === undefined) return new Set(planNodeIds);
  return new Set(nodes.filter((n) => !n.cores).map((n) => n.id));
}
