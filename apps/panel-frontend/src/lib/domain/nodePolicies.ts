import { api } from '@/lib/net/client';

/**
 * Э3 layer B: what a NODE does with traffic that has already reached it.
 *
 * Deliberately NOT the same thing as `routePolicies.ts`, which is the older
 * squad-granted pair of domain lists. That one decides what a subscription
 * hands the client; this one decides which door a connection leaves the node
 * by. They are separate resources on the API and stay separate here.
 *
 * One policy can be attached to many nodes, and it stays ONE policy: a node
 * carries `policyId`, never a copy of the rules. Editing it changes every node
 * running it, which is why `nodeCount` travels with the policy.
 */

/**
 * What a rule does with what it matched.
 *
 * `direct` is the wire value and must never reach the screen: in layer A the
 * same word means "around the tunnel, from the user's own address", here it
 * means "out of the node's address". Opposite outcomes under one word, so the
 * interface names them apart. See nodePolicyActions.ts for the labels.
 */
export type PolicyActionKind = 'direct' | 'block' | 'warp' | 'cascade';

export interface PolicyMatch {
  domain: string[];
  ip: string[];
  port: string | null;
  protocol: string[];
  network: string | null;
}

export interface PolicyRule {
  id: string;
  position: number;
  enabled: boolean;
  match: PolicyMatch;
  action: {
    kind: PolicyActionKind;
    /** Cascade only: which way out. The id, never the outbound name. */
    directionId: string | null;
    /** Display-only, filled in when the direction was loaded with the rule. */
    directionLabel?: string | null;
  };
  /**
   * This rule can never fire: an earlier one already matches everything it
   * matches. Carries WHO eats it, because "shadowed" alone leaves the operator
   * hunting up the list for the culprit.
   *
   * The backend computes it sound but not complete: it only accuses a rule it
   * can prove is dead, so absence is not a guarantee of reachability.
   */
  shadowedBy?: { id: string; position: number } | null;
}

export interface NodePolicy {
  id: string;
  name: string;
  description: string | null;
  rules: PolicyRule[];
  /** How many nodes run this policy. Absent on some reads, never assume 0. */
  nodeCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** What a rule looks like on the way in. `id` kept so a save does not re-create
 *  rows and lose their identity; absent means a new rule. */
export interface PolicyRuleInput {
  id?: string;
  enabled: boolean;
  match: PolicyMatch;
  action: { kind: PolicyActionKind; directionId?: string | null };
}

export interface NodePolicyInput {
  name: string;
  description?: string | null;
  /**
   * The WHOLE ordered list. A policy is its order, so rules are written as a
   * set: a partial list would silently delete the rest. This is the one place
   * a set-replacing payload is right, and only because the screen edits the
   * entire list and nothing else writes it.
   */
  rules: PolicyRuleInput[];
}

export async function listNodePolicies(): Promise<{ policies: NodePolicy[] }> {
  const { data } = await api.get<{ policies: NodePolicy[] }>('/api/node-policies');
  return data;
}

export async function getNodePolicy(id: string): Promise<NodePolicy> {
  const { data } = await api.get<NodePolicy>(`/api/node-policies/${id}`);
  return data;
}

export async function createNodePolicy(input: NodePolicyInput): Promise<NodePolicy> {
  const { data } = await api.post<NodePolicy>('/api/node-policies', input);
  return data;
}

export async function updateNodePolicy(
  id: string,
  input: Partial<NodePolicyInput>,
): Promise<NodePolicy> {
  const { data } = await api.put<NodePolicy>(`/api/node-policies/${id}`, input);
  return data;
}

export async function deleteNodePolicy(id: string): Promise<void> {
  await api.delete(`/api/node-policies/${id}`);
}

/**
 * The refusals this API sends, kept in the shape the server sends them.
 *
 * Every one of these is already a sentence naming the node, the policy or the
 * reason. The screen shows that sentence, it does not summarise it into
 * "something went wrong": the whole value of the answer is the name in it.
 */
export interface PolicyRefusal {
  /** POLICY_DOES_NOT_FIT_NODE, DIRECTION_IN_USE_BY_POLICY, CONFLICT, ... */
  code: string;
  /** The server's own sentence. Shown verbatim. */
  message: string;
  /** DIRECTION_IN_USE_BY_POLICY only: the policies holding the direction. */
  policies?: string[];
}

export function policyRefusal(err: unknown): PolicyRefusal | null {
  const res = (err as {
    response?: { status?: number; data?: { error?: string; message?: string; policies?: string[] } };
  }).response;
  if (!res?.data?.message) return null;
  return {
    code: res.data.error ?? String(res.status ?? ''),
    message: res.data.message,
    ...(res.data.policies ? { policies: res.data.policies } : {}),
  };
}

/** A policy that exists only in the browser, until the first save. */
export function blankNodePolicy(): NodePolicy {
  return {
    id: 'draft',
    name: '',
    description: null,
    rules: [],
    nodeCount: 0,
    createdAt: '',
    updatedAt: '',
  };
}

/** An empty rule for the "add rule" row. Matches nothing until the operator
 *  types, which is why it is created disabled-safe: an empty match means "any"
 *  on the server, and a blank catch-all at the bottom is not what a click on
 *  "add" asked for. */
export function blankRule(): PolicyRuleInput {
  return {
    enabled: true,
    match: { domain: [], ip: [], port: null, protocol: [], network: null },
    action: { kind: 'block' },
  };
}

/** Rules as the API wants them back: ids kept, position implied by order. */
export function toRuleInput(rules: PolicyRule[]): PolicyRuleInput[] {
  return rules.map((r) => ({
    id: r.id.startsWith('new-') ? undefined : r.id,
    enabled: r.enabled,
    match: r.match,
    action: {
      kind: r.action.kind,
      // The server rejects a direction on anything but a cascade rule, and it
      // is right to: a leftover id from switching the action in the form would
      // otherwise ride along and mean something nobody asked for.
      ...(r.action.kind === 'cascade' ? { directionId: r.action.directionId } : {}),
    },
  }));
}
