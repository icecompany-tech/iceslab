import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { GEO_SET_KINDS } from '@iceslab/shared';
import { requireAuth } from '../auth/auth.hook.js';
import * as svc from './geo-sets.service.js';

/**
 * /api/geo-sets, geo-contract.md section 5. Validation of shape here; every
 * rule about names, URLs and rollouts is in the service, so the refusals have
 * one wording whichever door they came through.
 */

const IdParam = z.object({ id: z.uuid() });

const UrlSource = z.object({
  type: z.literal('url'),
  url: z.string().min(1).max(2048),
  sha256Source: z.enum(['sidecar', 'manual']),
  sha256: z.string().max(64).optional(),
  refreshHours: z.number().int().min(1).max(720).optional(),
});

const CreateSchema = z.object({
  // Checked against GEO_SET_NAME in the service, which says why in words.
  name: z.string().max(64),
  kind: z.enum(GEO_SET_KINDS),
  source: UrlSource,
});

const PatchSchema = z.object({
  name: z.string().max(64).optional(),
  url: z.string().min(1).max(2048).optional(),
  sha256Source: z.enum(['sidecar', 'manual']).optional(),
  sha256: z.string().max(64).optional(),
  refreshHours: z.number().int().min(1).max(720).optional(),
});

const TagsQuery = z.object({
  q: z.string().max(64).default(''),
  limit: z.coerce.number().int().min(1).max(2000).default(50),
});

const RolloutSchema = z.object({ version: z.string().min(1).max(64) });

function fail(err: unknown, reply: FastifyReply): unknown {
  if (err instanceof svc.GeoSetNotFoundError) {
    return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
  }
  if (err instanceof svc.GeoSetInvalidError) {
    return reply.code(400).send({ error: 'GEO_SET_INVALID', reason: err.reason, message: err.message });
  }
  if (err instanceof svc.GeoSetNameTakenError) {
    return reply.code(409).send({ error: 'GEO_SET_NAME_TAKEN', message: err.message });
  }
  if (err instanceof svc.GeoSetInUseError) {
    return reply.code(409).send({ error: 'GEO_SET_IN_USE', uses: err.uses, message: err.message });
  }
  if (err instanceof svc.GeoSetBuiltinError) {
    return reply.code(409).send({ error: 'GEO_SET_BUILTIN', message: err.message });
  }
  if (err instanceof svc.GeoSetNotVerifiedError) {
    return reply.code(409).send({ error: 'GEO_SET_NOT_VERIFIED', message: err.message });
  }
  if (err instanceof svc.GeoRolloutStaleError) {
    return reply.code(409).send({ error: 'GEO_ROLLOUT_STALE', current: err.current, message: err.message });
  }
  if (err instanceof svc.GeoRolloutBreaksError) {
    return reply.code(409).send({ error: 'GEO_ROLLOUT_BREAKS', breaks: err.breaks, message: err.message });
  }
  throw err;
}

export async function geoSetsRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [requireAuth] };

  app.get('/api/geo-sets', auth, async (_req, reply) => {
    return reply.send({ geoSets: await svc.listGeoSets() });
  });

  app.get('/api/geo-sets/:id', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    try {
      return reply.send(await svc.getGeoSet(id));
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.post('/api/geo-sets', auth, async (req, reply) => {
    const input = CreateSchema.parse(req.body);
    try {
      return reply.code(202).send(await svc.createUrlSet(input));
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.patch('/api/geo-sets/:id', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const input = PatchSchema.parse(req.body);
    try {
      return reply.send(await svc.patchSet(id, input));
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.post('/api/geo-sets/:id/refresh', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    try {
      return reply.code(202).send(await svc.refreshSet(id));
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.delete('/api/geo-sets/:id', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    try {
      await svc.deleteSet(id);
      return reply.code(204).send();
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.get('/api/geo-sets/:id/tags', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const { q, limit } = TagsQuery.parse(req.query);
    try {
      return reply.send(await svc.listTags(id, q, limit));
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.get('/api/geo-sets/:id/rollout-plan', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    try {
      return reply.send(await svc.rolloutPlan(id));
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.post('/api/geo-sets/:id/rollout', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const { version } = RolloutSchema.parse(req.body);
    try {
      return reply.code(202).send(await svc.rollout(id, version));
    } catch (err) {
      return fail(err, reply);
    }
  });
}
