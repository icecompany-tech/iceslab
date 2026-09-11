import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import {
  CreateCascadeSchema,
  UpdateCascadeSchema,
  CascadeIdParamSchema,
} from './cascade.schemas.js';
import * as svc from './cascade.service.js';
import { CascadeValidationError } from './cascade.validation.js';

function handleError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof CascadeValidationError) {
    return reply.code(400).send({ error: 'INVALID', message: err.message });
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
    return reply.send({ cascades: await svc.listCascades() });
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
