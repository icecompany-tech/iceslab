import type { NodePolicy, NodePolicyRule } from '../../generated/prisma/client.js';

export interface PolicyRuleDto {
  id: string;
  position: number;
  enabled: boolean;
  match: {
    domain: string[];
    ip: string[];
    port: string | null;
    protocol: string[];
    network: string | null;
  };
  action: {
    kind: string;
    /** Cascade only. The id, never the outbound name: the name is derived at
     *  push time, see the model comment. */
    directionId: string | null;
    /** Filled in for display when the direction was loaded with the rule. */
    directionLabel?: string | null;
  };
  /**
   * This rule can never fire, because an earlier one already matches
   * everything it matches. Names the rule that eats it.
   *
   * The whole reason it is computed: a list is evaluated top to bottom and an
   * operator writing the specific rule under the general one gets a screen that
   * looks right and traffic that goes somewhere else. Nothing errors, nothing
   * logs, and the rule is visibly there.
   */
  shadowedBy?: { id: string; position: number } | null;
}

export interface NodePolicyDto {
  id: string;
  name: string;
  description: string | null;
  rules: PolicyRuleDto[];
  /** How many nodes run this policy. Present on the list and on a single read,
   *  because deleting a policy detaches every one of them. */
  nodeCount?: number;
  createdAt: string;
  updatedAt: string;
}

type RuleRow = NodePolicyRule & {
  direction?: { id: string; tag: number; countryCode: string | null } | null;
};

export function mapRule(r: RuleRow): PolicyRuleDto {
  return {
    id: r.id,
    position: r.position,
    enabled: r.enabled,
    match: {
      domain: r.matchDomain,
      ip: r.matchIp,
      port: r.matchPort,
      protocol: r.matchProtocol,
      network: r.matchNetwork,
    },
    action: {
      kind: r.actionKind,
      directionId: r.actionDirectionId,
      ...(r.direction
        ? {
            directionLabel:
              r.direction.countryCode?.toUpperCase() ?? `direction ${r.direction.tag}`,
          }
        : {}),
    },
  };
}

export function mapPolicy(
  p: NodePolicy & { rules: RuleRow[] },
  nodeCount?: number,
): NodePolicyDto {
  const rules = p.rules.map(mapRule);
  markShadowed(rules);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    rules,
    ...(nodeCount !== undefined ? { nodeCount } : {}),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * Mark every rule an earlier one has already swallowed.
 *
 * SOUND, NOT COMPLETE, and deliberately so. It only claims a rule is dead when
 * the earlier rule is provably at least as broad on every axis: unconstrained
 * there, or a superset of what this rule lists. It therefore misses overlaps it
 * cannot see (two geosite categories that happen to intersect, a CIDR that
 * contains another), and it never accuses a rule that can still fire.
 *
 * That direction of error is the point. A false "this never runs" is worse than
 * silence: the operator deletes a rule that was doing its job.
 */
export function markShadowed(rules: PolicyRuleDto[]): void {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    rule.shadowedBy = null;
    if (!rule.enabled) continue;
    for (let j = 0; j < i; j++) {
      const earlier = rules[j]!;
      if (!earlier.enabled) continue;
      if (covers(earlier.match, rule.match)) {
        rule.shadowedBy = { id: earlier.id, position: earlier.position };
        break;
      }
    }
  }
}

type Match = PolicyRuleDto['match'];

/** Does `a` match everything `b` matches? */
function covers(a: Match, b: Match): boolean {
  return (
    coversList(a.domain, b.domain) &&
    coversList(a.ip, b.ip) &&
    coversScalar(a.port, b.port) &&
    coversList(a.protocol, b.protocol) &&
    coversNetwork(a.network, b.network)
  );
}

/**
 * An EMPTY list on `a` means "any", so it covers anything. A non-empty `a`
 * covers only a non-empty `b` whose entries it all contains: if `b` is empty it
 * is the broader of the two and nothing is shadowed.
 */
function coversList(a: string[], b: string[]): boolean {
  if (a.length === 0) return true;
  if (b.length === 0) return false;
  const set = new Set(a);
  return b.every((v) => set.has(v));
}

function coversScalar(a: string | null, b: string | null): boolean {
  if (!a) return true;
  return a === b;
}

/** `tcp,udp` covers each half; anything else has to match exactly. */
function coversNetwork(a: string | null, b: string | null): boolean {
  if (!a) return true;
  if (a === b) return true;
  return a === 'tcp,udp' && (b === 'tcp' || b === 'udp');
}
