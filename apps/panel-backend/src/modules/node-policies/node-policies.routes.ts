import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import {
  CreateNodePolicySchema,
  NodePolicyIdParamSchema,
  UpdateNodePolicySchema,
} from './node-policies.schemas.js';
import * as svc from './node-policies.service.js';
import { prisma } from '../../prisma.js';
import { audit } from '../audit/audit.hook.js';
import { policyTarget } from '../audit/audit.targets.js';

/** One place that turns the service's refusals into answers, so a rule the
 *  panel cannot carry out always comes back saying which node and why. */
function fail(err: unknown, reply: FastifyReply): unknown {
  if (err instanceof svc.NodePolicyNotFoundError) {
    return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
  }
  if (err instanceof svc.NodePolicyNameTakenError) {
    return reply.code(409).send({ error: 'CONFLICT', message: err.message });
  }
  if (err instanceof svc.DirectionNotFoundError) {
    return reply.code(400).send({ error: 'DIRECTION_NOT_FOUND', message: err.message });
  }
  if (err instanceof svc.PolicyDoesNotFitNodeError) {
    return reply.code(409).send({ error: 'POLICY_DOES_NOT_FIT_NODE', message: err.message });
  }
  throw err;
}

export async function nodePoliciesRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [requireAuth] };

  app.get('/api/node-policies', auth, async (_req, reply) => {
    return reply.send({ policies: await svc.listPolicies() });
  });

  app.get('/api/node-policies/:id', auth, async (req, reply) => {
    const { id } = NodePolicyIdParamSchema.parse(req.params);
    try {
      return reply.send(await svc.getPolicy(id));
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.post('/api/node-policies', auth, async (req, reply) => {
    const input = CreateNodePolicySchema.parse(req.body);
    // No id until it exists: a refused create keeps the name it was given.
    const entry = audit(req, { action: 'nodePolicy.create', target: { kind: 'node_policy', id: null, label: input.name } });
    try {
      const created = await svc.createPolicy(input);
      entry.target.id = created.id;
      entry.detail = { rules: created.rules.length, nodes: 0 };
      return reply.code(201).send(created);
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.put('/api/node-policies/:id', auth, async (req, reply) => {
    const { id } = NodePolicyIdParamSchema.parse(req.params);
    const input = UpdateNodePolicySchema.parse(req.body);
    const target = await policyTarget(id);
    const entry = target ? audit(req, { action: 'nodePolicy.update', target }) : null;
    try {
      const updated = await svc.updatePolicy(id, input);
      if (entry) entry.detail = { rules: updated.rules.length, nodes: await prisma.node.count({ where: { policyId: id } }) };
      return reply.send(updated);
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.delete('/api/node-policies/:id', auth, async (req, reply) => {
    const { id } = NodePolicyIdParamSchema.parse(req.params);
    // As it stood: the delete detaches every node that ran it.
    const standing = await svc.getPolicy(id).catch((err: unknown) => {
      if (err instanceof svc.NodePolicyNotFoundError) return null;
      throw err;
    });
    if (standing) {
      audit(req, {
        action: 'nodePolicy.delete',
        target: { kind: 'node_policy', id, label: standing.name },
        detail: { rules: standing.rules.length, nodes: standing.nodeCount ?? 0 },
      });
    }
    try {
      await svc.deletePolicy(id);
      return reply.code(204).send();
    } catch (err) {
      return fail(err, reply);
    }
  });
}
