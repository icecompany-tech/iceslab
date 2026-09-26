import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import {
  CreateNamedOutboundSchema,
  NamedOutboundIdParamSchema,
  UpdateNamedOutboundSchema,
} from './named-outbounds.schemas.js';
import * as svc from './named-outbounds.service.js';

/** The service's refusals, each under its own code and in machine form. */
function fail(err: unknown, reply: FastifyReply): unknown {
  if (err instanceof svc.NamedOutboundNotFoundError) {
    return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
  }
  if (err instanceof svc.NamedOutboundNameTakenError) {
    return reply.code(409).send({ error: err.code, message: err.message, name: err.outboundName });
  }
  if (err instanceof svc.NamedOutboundInUseError) {
    return reply.code(409).send({ error: err.code, message: err.message, usedBy: err.usedBy });
  }
  if (err instanceof svc.NamedOutboundTypeNotForDirectionError) {
    return reply.code(409).send({ error: err.code, message: err.message, type: err.type, usedBy: err.usedBy });
  }
  if (err instanceof svc.NamedOutboundConfigInvalidError) {
    return reply.code(400).send({
      error: 'VALIDATION',
      message: err.message,
      issues: err.issues.map((i) => ({ path: ['config', ...i.path], message: i.message })),
    });
  }
  throw err;
}

/** Phase 10 (Э3.2): foreign ways out a cascade direction can stand on. */
export async function namedOutboundsRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [requireAuth] };

  app.get('/api/named-outbounds', auth, async (_req, reply) => {
    return reply.send({ outbounds: await svc.listNamedOutbounds() });
  });

  app.get('/api/named-outbounds/:id', auth, async (req, reply) => {
    const { id } = NamedOutboundIdParamSchema.parse(req.params);
    try {
      return reply.send(await svc.getNamedOutbound(id));
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.post('/api/named-outbounds', auth, async (req, reply) => {
    const input = CreateNamedOutboundSchema.parse(req.body);
    try {
      return reply.code(201).send(await svc.createNamedOutbound(input));
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.put('/api/named-outbounds/:id', auth, async (req, reply) => {
    const { id } = NamedOutboundIdParamSchema.parse(req.params);
    const input = UpdateNamedOutboundSchema.parse(req.body);
    try {
      return reply.send(await svc.updateNamedOutbound(id, input));
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.delete('/api/named-outbounds/:id', auth, async (req, reply) => {
    const { id } = NamedOutboundIdParamSchema.parse(req.params);
    try {
      await svc.deleteNamedOutbound(id);
      return reply.code(204).send();
    } catch (err) {
      return fail(err, reply);
    }
  });
}
