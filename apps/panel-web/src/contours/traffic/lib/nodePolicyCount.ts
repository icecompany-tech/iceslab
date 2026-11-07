type T = (key: string, vars?: Record<string, unknown>) => string;

/**
 * How many nodes carry a node policy (A-251). The field is optional
 * (`NodePolicy.nodeCount`): a server that did not send it has not said «0»,
 * so a missing or malformed count is `null`, unknown.
 */
export function nodeCountOf(policy: { nodeCount?: unknown }): number | null {
  const n = policy.nodeCount;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}

/** The chip beside the policy name and the delete dialog, each with an unknown of its own. */
export function nodeCountWords(count: number | null, t: T): { chip: string; deleteBody: string } {
  if (count === null) {
    return { chip: t('routes.nodeOnUnknown'), deleteBody: t('routes.nodeDeleteBodyUnknown') };
  }
  return {
    chip: count > 0 ? t('routes.nodeOnNodes', { count }) : t('routes.nodeOnNoNodes'),
    deleteBody: t('routes.nodeDeleteBody', { count }),
  };
}
