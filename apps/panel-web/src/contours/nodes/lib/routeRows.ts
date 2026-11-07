import type { NodePolicy, PolicyActionKind, PolicyDrawing } from '@/lib/old/nodePolicies';
import type { RoutePolicy } from '@/lib/old/routePolicies';
import { loadView } from '@/lib/old/loadView';

/**
 * The Routes tab of a node, as the rows the core reads top to bottom (A-263).
 *
 * The order is the agent's, not a guess: apps/node/internal/core/xray/
 * config.go:907-941 puts the protection rules first, then the cascade rules
 * that name a destination (the A4 grants of a balancer entry, the QUIC block;
 * cutCascadeRulesAtTheFirstDoor, :673), then the NODE'S POLICY, then the
 * cascade doors (the link, vlessRoute) and the catch-all. The node's policy
 * used to be missing here altogether, so «everything else goes to SE» was
 * printed over a rule that sends ifconfig.me nowhere.
 *
 * A policy rule the push leaves out, or the agent reports it did not draw
 * (policy_drawn), stays in its place marked «not drawn»: not hidden, and not
 * shown as working.
 */

export interface PolicyRuleRow {
  ruleId: string;
  /** Domains, IPs, port, protocols, network; empty: the rule matches anything. */
  match: string[];
  action: PolicyActionKind;
  /** Cascade rules: the way out, by the label the policy was loaded with. */
  direction: string | null;
  /** `null`: whether it reached the node is not known (drawing not read). */
  notDrawn: boolean | null;
  /** Why the panel left it out, when it did (notDrawn[].reason); null otherwise. */
  notDrawnReason: string | null;
  /** A-277: drawn for every user of the entry (hysteria, AmneziaWG cannot tell them apart). */
  ungated: boolean;
}

/** The node's policy as a band over its rows: present, absent or not known. */
export type PolicyBand =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'failed'; message: string; onRetry: () => void }
  /** The node names a policy the list does not hold. */
  | { kind: 'missing' }
  | { kind: 'ready'; name: string; drawingKnown: boolean };

export type RouteRow =
  | { kind: 'quic' }
  | { kind: 'squadBlock'; domains: string[]; source: { policy: string; squads: string[] } }
  | { kind: 'squadDirect'; domains: string[]; source: { policy: string; squads: string[] } }
  | { kind: 'squadDead'; domains: string[] }
  | { kind: 'policyBand'; band: PolicyBand }
  | { kind: 'policyRule'; rule: PolicyRuleRow }
  | { kind: 'fromLink'; role: string }
  /** The catch-all: out of the node's door, on to the cascade, or nothing. */
  | { kind: 'catchAll'; to: 'egress' | 'direction' | 'exits' | 'nothing' };

type Q = { data: unknown; isError: boolean; error: unknown; refetch: () => unknown };

/**
 * The node's policy, read with every input checked: no policy is a band «-»,
 * a list on its way or failed is said, a drawing not read leaves the rules
 * unmarked (`notDrawn: null`) rather than «drawn».
 */
export function nodePolicyBand(
  policyId: string | null | undefined,
  policies: Q,
  drawing: PolicyDrawing | null,
  say: (err: unknown) => string,
): { band: PolicyBand; rules: PolicyRuleRow[] } {
  if (!policyId) return { band: { kind: 'none' }, rules: [] };
  const view = loadView(policies);
  if (view === 'loading') return { band: { kind: 'loading' }, rules: [] };
  if (view === 'failed') {
    return { band: { kind: 'failed', message: say(policies.error), onRetry: () => void policies.refetch() }, rules: [] };
  }
  const list = (policies.data as { policies?: unknown } | null)?.policies;
  const policy = Array.isArray(list) ? (list as NodePolicy[]).find((p) => p && p.id === policyId) : undefined;
  if (!policy || !Array.isArray(policy.rules)) return { band: { kind: 'missing' }, rules: [] };
  // The drawing is about THIS policy only; one for another (just switched) says nothing.
  const known = drawing !== null && drawing.policyId === policyId;
  const notDrawn = new Set(
    known ? [...drawing.notDrawn.map((n) => n.ruleId), ...(drawing.agent?.notDrawn ?? []).flatMap((n) => n.ruleIds)] : [],
  );
  const reasonOf = new Map(known ? drawing.notDrawn.map((n) => [n.ruleId, n.reason] as const) : []);
  const ungated = new Set(known ? (drawing.ungated ?? []) : []);
  const rules = [...policy.rules]
    // The push carries enabled rules only (node-policies.service, `where: { enabled: true }`).
    .filter((r) => r.enabled)
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      ruleId: r.id,
      match: [
        ...r.match.domain,
        ...r.match.ip,
        ...(r.match.port ? [`port:${r.match.port}`] : []),
        ...r.match.protocol,
        ...(r.match.network ? [r.match.network] : []),
      ],
      action: r.action.kind,
      direction: r.action.kind === 'cascade' ? (r.action.directionLabel ?? null) : null,
      notDrawn: known ? notDrawn.has(r.id) : null,
      notDrawnReason: reasonOf.get(r.id) ?? null,
      ungated: ungated.has(r.id),
    }));
  return { band: { kind: 'ready', name: policy.name, drawingKnown: known }, rules };
}

export function routeRows(input: {
  /** null: outside every cascade. */
  role: string | null;
  isBalancerEntry: boolean;
  /** Balancer entry only: the squad policy on the picked tag. */
  squadPolicy: { policy: RoutePolicy; squads: string[] } | null;
  nodePolicy: { band: PolicyBand; rules: PolicyRuleRow[] };
}): RouteRow[] {
  const { role, isBalancerEntry, squadPolicy, nodePolicy } = input;
  const policy: RouteRow[] = [
    { kind: 'policyBand', band: nodePolicy.band },
    ...nodePolicy.rules.map((rule) => ({ kind: 'policyRule' as const, rule })),
  ];
  if (role === null) return [...policy, { kind: 'catchAll', to: 'egress' }];
  if (!isBalancerEntry && role !== 'entry') {
    return [...policy, { kind: 'fromLink', role }, { kind: 'catchAll', to: 'nothing' }];
  }
  if (!isBalancerEntry) return [{ kind: 'quic' }, ...policy, { kind: 'catchAll', to: 'direction' }];

  // Block is emitted above direct, so a domain in both never reaches direct.
  const squad: RouteRow[] = [];
  if (squadPolicy) {
    const source = { policy: squadPolicy.policy.name, squads: squadPolicy.squads };
    const blocked = new Set(squadPolicy.policy.blockDomains);
    const live = squadPolicy.policy.directDomains.filter((d) => !blocked.has(d));
    const dead = squadPolicy.policy.directDomains.filter((d) => blocked.has(d));
    if (squadPolicy.policy.blockDomains.length > 0) squad.push({ kind: 'squadBlock', domains: squadPolicy.policy.blockDomains, source });
    if (live.length > 0) squad.push({ kind: 'squadDirect', domains: live, source });
    if (dead.length > 0) squad.push({ kind: 'squadDead', domains: dead });
  }
  return [{ kind: 'quic' }, ...squad, ...policy, { kind: 'catchAll', to: 'exits' }];
}
