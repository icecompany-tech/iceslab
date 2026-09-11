import type { NodePolicy as WireNodePolicy, NodePolicyRule as WireRule } from '@iceslab/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { mapPolicy, type NodePolicyDto } from './node-policies.mapper.js';
import type {
  CreateNodePolicyInput,
  PolicyRuleInput,
  UpdateNodePolicyInput,
} from './node-policies.schemas.js';

export class NodePolicyNotFoundError extends Error {
  constructor(public id: string) {
    super(`Node policy ${id} not found`);
    this.name = 'NodePolicyNotFoundError';
  }
}

export class NodePolicyNameTakenError extends Error {
  constructor(public name: string) {
    super(`A node policy named "${name}" already exists`);
    this.name = 'NodePolicyNameTakenError';
  }
}

export class DirectionNotFoundError extends Error {
  constructor(public directionId: string) {
    super(`Cascade direction ${directionId} not found`);
    this.name = 'DirectionNotFoundError';
  }
}

/**
 * A policy cannot be rendered on a node that has nowhere to send the traffic.
 *
 * Raised at SAVE time rather than left to the push. The node would refuse the
 * config too (xray validates its own tags and the outbound simply is not
 * there), but that failure arrives minutes later, in a worker log, attached to
 * a node rather than to the rule the operator just wrote.
 */
export class PolicyDoesNotFitNodeError extends Error {
  constructor(
    public nodeName: string,
    public reason: string,
  ) {
    super(`Node "${nodeName}" cannot run this policy: ${reason}`);
    this.name = 'PolicyDoesNotFitNodeError';
  }
}

const RULE_INCLUDE = {
  rules: {
    orderBy: { position: 'asc' },
    include: {
      direction: { select: { id: true, tag: true, countryCode: true } },
    },
  },
} satisfies Prisma.NodePolicyInclude;

export async function listPolicies(): Promise<NodePolicyDto[]> {
  const rows = await prisma.nodePolicy.findMany({
    include: { ...RULE_INCLUDE, _count: { select: { nodes: true } } },
    orderBy: { name: 'asc' },
  });
  return rows.map((p) => mapPolicy(p, p._count.nodes));
}

export async function getPolicy(id: string): Promise<NodePolicyDto> {
  const p = await prisma.nodePolicy.findUnique({
    where: { id },
    include: { ...RULE_INCLUDE, _count: { select: { nodes: true } } },
  });
  if (!p) throw new NodePolicyNotFoundError(id);
  return mapPolicy(p, p._count.nodes);
}

export async function createPolicy(input: CreateNodePolicyInput): Promise<NodePolicyDto> {
  await assertDirectionsExist(input.rules);
  try {
    const created = await prisma.nodePolicy.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        rules: { create: input.rules.map(toRuleRow) },
      },
      include: RULE_INCLUDE,
    });
    return mapPolicy(created, 0);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new NodePolicyNameTakenError(input.name);
    }
    throw err;
  }
}

export async function updatePolicy(
  id: string,
  input: UpdateNodePolicyInput,
): Promise<NodePolicyDto> {
  const existing = await prisma.nodePolicy.findUnique({
    where: { id },
    select: { id: true, nodes: { select: { id: true } } },
  });
  if (!existing) throw new NodePolicyNotFoundError(id);
  if (input.rules) await assertDirectionsExist(input.rules);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.nodePolicy.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
      if (input.rules) {
        // Replaced wholesale rather than diffed: a policy IS its ordered list,
        // the screen edits all of it, and rebuilding is the only way a reorder
        // and a deletion in the same save cannot half-apply.
        await tx.nodePolicyRule.deleteMany({ where: { policyId: id } });
        for (const [position, rule] of input.rules.entries()) {
          await tx.nodePolicyRule.create({
            data: { policyId: id, ...toRuleRow(rule, position) },
          });
        }
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new NodePolicyNameTakenError(input.name ?? '');
    }
    throw err;
  }

  // Every node running this policy now serves different rules, so each needs a
  // push. Checked BEFORE announcing, so a policy that no longer fits a node it
  // is attached to is refused here rather than on the node.
  for (const node of existing.nodes) await assertPolicyFitsNode(id, node.id);
  if (existing.nodes.length > 0) {
    eventBus.emit('policy.changed', { policyId: id, nodeIds: existing.nodes.map((n) => n.id) });
  }

  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<void> {
  const existing = await prisma.nodePolicy.findUnique({
    where: { id },
    select: { nodes: { select: { id: true } } },
  });
  if (!existing) throw new NodePolicyNotFoundError(id);
  // SET NULL on the node side: the nodes go back to no policy, which is a state
  // they can be in, and each of them needs its config rewritten without it.
  await prisma.nodePolicy.delete({ where: { id } });
  if (existing.nodes.length > 0) {
    eventBus.emit('policy.changed', { policyId: id, nodeIds: existing.nodes.map((n) => n.id) });
  }
}

function toRuleRow(rule: PolicyRuleInput, position?: number) {
  return {
    position: position ?? 0,
    enabled: rule.enabled,
    matchDomain: rule.match.domain,
    matchIp: rule.match.ip,
    matchPort: rule.match.port ?? null,
    matchProtocol: rule.match.protocol,
    matchNetwork: rule.match.network ?? null,
    actionKind: rule.action.kind,
    actionDirectionId: rule.action.directionId ?? null,
  };
}

/** A direction id that names nothing is a rule pointing at a way out that does
 *  not exist. The FK would catch it, but with a message about a constraint. */
async function assertDirectionsExist(rules: PolicyRuleInput[]): Promise<void> {
  const ids = [
    ...new Set(rules.map((r) => r.action.directionId).filter((v): v is string => !!v)),
  ];
  if (ids.length === 0) return;
  const found = await prisma.cascadeDirection.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const seen = new Set(found.map((d) => d.id));
  const missing = ids.find((id) => !seen.has(id));
  if (missing) throw new DirectionNotFoundError(missing);
}

/**
 * Can this node actually carry out this policy?
 *
 * Two things it can fail on, and both produce a config the core refuses rather
 * than traffic going somewhere unexpected, which is why they are worth catching
 * at the save instead:
 *
 *   - a WARP rule on a node with no WARP egress provisioned;
 *   - a cascade rule naming a direction this node has no leg to.
 *
 * The second also rejects a direction whose pool this node reaches through MORE
 * than one leg. The rendered policy names ONE outbound, and with two legs there
 * is no single honest answer: picking the first would quietly send every
 * matching connection through half of a pool the operator built for redundancy.
 * Balancing across a direction needs a per-direction balancer and a wire field
 * to target it, which is its own change.
 */
export async function assertPolicyFitsNode(policyId: string, nodeId: string): Promise<void> {
  const [policy, node] = await Promise.all([
    prisma.nodePolicy.findUnique({
      where: { id: policyId },
      include: { rules: { include: { direction: { select: { id: true, tag: true, cascadeId: true } } } } },
    }),
    prisma.node.findFirst({
      where: { id: nodeId, deletedAt: null },
      select: { id: true, name: true, warpEnabled: true },
    }),
  ]);
  if (!policy || !node) return;

  for (const rule of policy.rules) {
    if (!rule.enabled) continue;
    if (rule.actionKind === 'warp' && !node.warpEnabled) {
      throw new PolicyDoesNotFitNodeError(
        node.name,
        'it has a rule routing into WARP, and WARP egress is not enabled on this node',
      );
    }
    if (rule.actionKind === 'cascade' && rule.direction) {
      const legs = await prisma.cascadeLink.count({
        where: {
          cascadeId: rule.direction.cascadeId,
          fromNodeId: node.id,
          directionTag: rule.direction.tag,
        },
      });
      if (legs === 0) {
        throw new PolicyDoesNotFitNodeError(
          node.name,
          `it has a rule going out through a cascade direction this node does not dial`,
        );
      }
      if (legs > 1) {
        throw new PolicyDoesNotFitNodeError(
          node.name,
          `it has a rule going out through a cascade direction this node reaches by ${legs} links; ` +
            `a policy rule names one outbound, so pooled directions are not supported yet`,
        );
      }
    }
  }
}

/** Per-direction outbound tag, mirroring cascade.config's dirOutTag. Kept in one
 *  place: the panel prints both the fragments and this rule in the same push, so
 *  they cannot disagree, but two copies of the format string could. */
export function directionOutboundTag(directionTag: number, idx: number): string {
  return `cascade-link-out-d${directionTag}-${idx}`;
}

/**
 * The policy this node should be running, in wire shape.
 *
 * Direction ids become outbound names HERE, in the same push that prints the
 * cascade fragments those outbounds come from. That is the whole reason the id
 * is what gets stored: the name is only true relative to one rendering.
 *
 * Returns undefined when the node has no policy, which is the normal state and
 * renders on the node exactly as before the field existed.
 */
export async function resolvePolicyForNode(nodeId: string): Promise<WireNodePolicy | undefined> {
  const node = await prisma.node.findFirst({
    where: { id: nodeId, deletedAt: null },
    select: {
      policy: {
        include: {
          rules: {
            where: { enabled: true },
            orderBy: { position: 'asc' },
            include: { direction: { select: { tag: true, cascadeId: true } } },
          },
        },
      },
    },
  });
  if (!node?.policy) return undefined;

  const rules: WireRule[] = [];
  for (const r of node.policy.rules) {
    const match: WireRule['match'] = {};
    if (r.matchDomain.length) match.domain = r.matchDomain;
    if (r.matchIp.length) match.ip = r.matchIp;
    if (r.matchPort) match.port = r.matchPort;
    if (r.matchProtocol.length) match.protocol = r.matchProtocol;
    if (r.matchNetwork) match.network = r.matchNetwork as WireRule['match']['network'];

    if (r.actionKind === 'cascade') {
      if (!r.direction) continue;
      const legs = await prisma.cascadeLink.findMany({
        where: {
          cascadeId: r.direction.cascadeId,
          fromNodeId: nodeId,
          directionTag: r.direction.tag,
        },
        select: { id: true },
      });
      // Skipped rather than rendered when the node cannot reach the direction.
      // Saving already refuses this, so reaching it means the topology changed
      // underneath; naming an outbound that is not in the config would make the
      // core reject the WHOLE push and take the node's other inbounds with it.
      if (legs.length !== 1) continue;
      rules.push({ match, action: { kind: 'cascade', exit: directionOutboundTag(r.direction.tag, 0) } });
      continue;
    }
    rules.push({
      match,
      action: { kind: r.actionKind as 'direct' | 'block' | 'warp' },
    });
  }

  return { rules };
}
