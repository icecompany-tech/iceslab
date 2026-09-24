import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import {
  CreateCascadeSchema,
  UpdateCascadeSchema,
  CascadeIdParamSchema,
  RotateTunnelsSchema,
} from './cascade.schemas.js';
import { CASCADE_DTO_FIELDS } from './cascade.mapper.js';
import * as svc from './cascade.service.js';
import { CascadeEntryNotChainableError, CascadeValidationError } from './cascade.validation.js';

function handleError(err: unknown, reply: FastifyReply): FastifyReply {
  // Before the generic one, and with a CODE of its own: the screen matches on
  // it to name the entries the chain takes, which is what the operator needs to
  // pick another one instead of filing a bug.
  if (err instanceof CascadeEntryNotChainableError) {
    return reply.code(400).send({ error: err.code, message: err.message });
  }
  if (err instanceof CascadeValidationError) {
    return reply.code(400).send({ error: 'INVALID', message: err.message });
  }
  if (err instanceof svc.CascadeEntryPolicyNotFoundError) {
    return reply.code(400).send({ error: err.code, message: err.message, policyId: err.policyId });
  }
  if (err instanceof svc.CascadeNodeMissingError) {
    return reply.code(400).send({ error: 'INVALID', message: err.message });
  }
  if (err instanceof svc.CascadeNotFoundError) {
    return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
  }
  if (err instanceof svc.CascadeNameTakenError) {
    return reply.code(409).send({ error: 'CONFLICT', message: err.message });
  }
  if (err instanceof svc.DirectionInUseByPolicyError) {
    // 409: the save is well-formed, it conflicts with what a node policy is
    // currently routing through. The policy names travel with it so the panel
    // can link straight to them instead of saying "something uses this".
    return reply.code(409).send({
      error: 'DIRECTION_IN_USE_BY_POLICY',
      message: err.message,
      policies: err.policyNames,
    });
  }
  if (err instanceof svc.CascadeLinkPortInUseError) {
    // 409: the cascade is well-formed, and a profile already listens on the
    // port one of its legs needs. The list travels in machine form because the
    // operator has to move those profiles, and the cascade screen has no field
    // to fix instead.
    return reply.code(409).send({
      error: 'LINK_PORT_IN_USE',
      message: err.message,
      conflicts: err.conflicts,
    });
  }
  if (err instanceof svc.CascadeCellNotCarriedError) {
    // 409 and not 400, for the same reason as ENTRY_CORE_TOO_OLD: the request
    // is well-formed, it conflicts with what those nodes currently run. The
    // list travels in machine form because the fix is per node and the screen
    // has to point at the right leg rather than at the whole cascade.
    return reply.code(409).send({
      error: err.code,
      message: err.message,
      conflicts: err.conflicts,
    });
  }
  if (err instanceof svc.LinkUnderlayNotOnNodeError) {
    // 409: an `awg` leg on a node that reports AmneziaWG as not installed.
    // Every such node is named, like the other gates of this save.
    return reply.code(409).send({ error: err.code, message: err.message, nodeNames: err.nodeNames });
  }
  if (err instanceof svc.CascadeEntryCannotChainError) {
    // 409: well-formed, and in conflict with what those nodes have installed.
    return reply.code(409).send({ error: err.code, message: err.message, conflicts: err.conflicts });
  }
  if (err instanceof svc.CascadeEntryChangeDropsUsersError) {
    // 409 and not 400: the request is valid and becomes acceptable with one
    // more field. The screen matches the code, shows who leaves, and repeats
    // the save with confirmEntryChange: true.
    return reply.code(409).send({
      error: err.code,
      message: err.message,
      from: err.from,
      to: err.to,
      conflicts: err.conflicts,
    });
  }
  if (err instanceof svc.CascadeEntryNodesDroppedError) {
    // The same shape and the same consent as ENTRY_CHANGE_DROPS_USERS: the
    // screen shows who leaves and repeats the save with confirmEntryChange.
    return reply.code(409).send({ error: err.code, message: err.message, conflicts: err.conflicts });
  }
  if (err instanceof svc.CascadeEntryCoreTooOldError) {
    // T7: entry node's xray is too old for exit selection. 409: the request is
    // well-formed but conflicts with the node's current core version.
    return reply.code(409).send({
      error: 'ENTRY_CORE_TOO_OLD',
      message: err.message,
      nodeName: err.nodeName,
      coreVersion: err.coreVersion,
      minVersion: err.minVersion,
    });
  }
  throw err;
}

export async function cascadeRoutes(app: FastifyInstance): Promise<void> {
  // Per-route auth (see users.routes.ts header for the Fastify v5 rationale).
  const auth = { onRequest: [requireAuth] };

  app.get('/api/cascades', auth, async (_req, reply) => {
    // `fields`: what this server renders, answered with no cascade too.
    return reply.send({ cascades: await svc.listCascades(), fields: CASCADE_DTO_FIELDS });
  });

  app.get('/api/cascades/:id', auth, async (req, reply) => {
    const { id } = CascadeIdParamSchema.parse(req.params);
    try {
      return reply.send(await svc.getCascade(id));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Provisioning status of the cascade's hops, polled by the UI after a save.
  // Registered before the POST so the more specific path is unambiguous.
  app.get('/api/cascades/:id/status', auth, async (req, reply) => {
    const { id } = CascadeIdParamSchema.parse(req.params);
    try {
      return reply.send(await svc.getCascadeStatus(id));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/api/cascades', auth, async (req, reply) => {
    const input = CreateCascadeSchema.parse(req.body);
    try {
      return reply.code(201).send(await svc.createCascade(input));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.put('/api/cascades/:id', auth, async (req, reply) => {
    const { id } = CascadeIdParamSchema.parse(req.params);
    const input = UpdateCascadeSchema.parse(req.body);
    try {
      return reply.send(await svc.updateCascade(id, input));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Phase 8.3: re-key the leg tunnels, all of them or one node pair's. The only
  // way a tunnel's keys change: a save keeps them.
  app.post('/api/cascades/:id/tunnels/rotate', auth, async (req, reply) => {
    const { id } = CascadeIdParamSchema.parse(req.params);
    const body = RotateTunnelsSchema.parse(req.body ?? {});
    try {
      const pair = body.fromNodeId && body.toNodeId ? { fromNodeId: body.fromNodeId, toNodeId: body.toNodeId } : undefined;
      return reply.send(await svc.rotateCascadeTunnels(id, pair));
    } catch (err) {
      if (err instanceof svc.CascadeTunnelNotFoundError) {
        return reply.code(404).send({ error: 'TUNNEL_NOT_FOUND', message: err.message });
      }
      return handleError(err, reply);
    }
  });

  app.delete('/api/cascades/:id', auth, async (req, reply) => {
    const { id } = CascadeIdParamSchema.parse(req.params);
    try {
      await svc.deleteCascade(id);
      return reply.code(204).send();
    } catch (err) {
      return handleError(err, reply);
    }
  });
}
