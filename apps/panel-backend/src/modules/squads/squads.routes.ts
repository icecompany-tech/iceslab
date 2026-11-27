import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import {
  CreateSquadSchema,
  ReorderSquadsSchema,
  UpdateSquadSchema,
  SquadIdParamSchema,
} from './squads.schemas.js';
import * as squadsService from './squads.service.js';
import { RoutingPresetNotFoundError } from '../routing-presets/routing-presets.assign.js';

export async function squadsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/squads', { onRequest: [requireAuth] }, async (_req, reply) => {
    return reply.send({ squads: await squadsService.listSquads() });
  });

  app.get('/api/squads/:id', { onRequest: [requireAuth] }, async (request, reply) => {
    const params = SquadIdParamSchema.parse(request.params);
    try {
      return reply.send(await squadsService.getSquadById(params.id));
    } catch (err) {
      if (err instanceof squadsService.SquadNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  app.post('/api/squads', { onRequest: [requireAuth] }, async (request, reply) => {
    const input = CreateSquadSchema.parse(request.body);
    try {
      const squad = await squadsService.createSquad(input);
      return reply.code(201).send(squad);
    } catch (err) {
      if (err instanceof squadsService.SquadAlreadyExistsError) {
        return reply.code(409).send({ error: 'NAME_TAKEN', message: err.message });
      }
      if (err instanceof squadsService.SquadExitAclError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      if (err instanceof RoutingPresetNotFoundError) {
        return reply.code(400).send({ error: err.code, message: err.message, field: 'customRoutingPresetId' });
      }
      throw err;
    }
  });

  app.put('/api/squads/reorder', { onRequest: [requireAuth] }, async (request, reply) => {
    const input = ReorderSquadsSchema.parse(request.body);
    try {
      return reply.send({ ids: await squadsService.reorderSquads(input) });
    } catch (err) {
      if (err instanceof squadsService.SquadOrderConflictError) {
        return reply.code(409).send({ error: 'SQUAD_ORDER_CONFLICT', message: err.message, ids: err.ids });
      }
      throw err;
    }
  });

  app.put('/api/squads/:id', { onRequest: [requireAuth] }, async (request, reply) => {
    const params = SquadIdParamSchema.parse(request.params);
    const input = UpdateSquadSchema.parse(request.body);
    try {
      return reply.send(await squadsService.updateSquad(params.id, input));
    } catch (err) {
      if (err instanceof squadsService.SquadNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof squadsService.SquadAlreadyExistsError) {
        return reply.code(409).send({ error: 'NAME_TAKEN', message: err.message });
      }
      if (err instanceof squadsService.SquadExitAclError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      if (err instanceof squadsService.SquadProtectedError) {
        return reply.code(403).send({ error: 'PROTECTED', message: err.message });
      }
      if (err instanceof RoutingPresetNotFoundError) {
        return reply.code(400).send({ error: err.code, message: err.message, field: 'customRoutingPresetId' });
      }
      throw err;
    }
  });

  app.delete('/api/squads/:id', { onRequest: [requireAuth] }, async (request, reply) => {
    const params = SquadIdParamSchema.parse(request.params);
    try {
      await squadsService.deleteSquad(params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof squadsService.SquadNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof squadsService.SquadProtectedError) {
        return reply.code(403).send({ error: 'PROTECTED', message: err.message });
      }
      throw err;
    }
  });
}
