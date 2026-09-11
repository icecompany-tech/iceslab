import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import {
  CreateHostSchema,
  HostIdParamSchema,
  ListHostsQuerySchema,
  ReorderHostsSchema,
  UpdateHostSchema,
} from './hosts.schemas.js';
import * as svc from './hosts.service.js';
import { getHostFreshness } from './hosts.freshness.js';

export async function hostsRoutes(app: FastifyInstance): Promise<void> {
  // Wave-14 #15: per-route auth (see users.routes.ts header comment).
  const auth = { onRequest: [requireAuth] };

  app.get('/api/hosts', auth, async (req, reply) => {
    const q = ListHostsQuerySchema.parse(req.query);
    return reply.send({ hosts: await svc.listHosts(q) });
  });

  app.get('/api/hosts/:id', auth, async (req, reply) => {
    const { id } = HostIdParamSchema.parse(req.params);
    try {
      return reply.send(await svc.getHostById(id));
    } catch (err) {
      if (err instanceof svc.HostNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // How many subscribers are still on the old link. Counts PEOPLE, not configs:
  // the question the screen asks is who cannot connect, and one person in two
  // squads is one person. Declared before the generic :id routes below purely
  // for readability, Fastify matches the static segment either way.
  app.get('/api/hosts/:id/freshness', auth, async (req, reply) => {
    const { id } = HostIdParamSchema.parse(req.params);
    const freshness = await getHostFreshness(id);
    if (!freshness) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.send(freshness);
  });

  app.post('/api/hosts', auth, async (req, reply) => {
    const input = CreateHostSchema.parse(req.body);
    try {
      const h = await svc.createHost(input);
      return reply.code(201).send(h);
    } catch (err) {
      if (
        err instanceof svc.BindingNotFoundError ||
        err instanceof svc.ProfileNotFoundError ||
        err instanceof svc.NodeNotFoundError
      ) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      // Creating a host can now create the binding under it, so the port clash
      // that used to belong to the bindings route surfaces here too.
      if (err instanceof svc.PortInUseError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      // The form shows this next to the SNI field, so it carries the served
      // names rather than only prose.
      if (err instanceof svc.SniMismatchError) {
        return reply.code(400).send({
          error: 'SNI_MISMATCH',
          message: err.message,
          expected: err.expected,
        });
      }
      throw err;
    }
  });

  app.put('/api/hosts/:id', auth, async (req, reply) => {
    const { id } = HostIdParamSchema.parse(req.params);
    const input = UpdateHostSchema.parse(req.body);
    try {
      return reply.send(await svc.updateHost(id, input));
    } catch (err) {
      if (err instanceof svc.HostNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof svc.SniMismatchError) {
        return reply.code(400).send({
          error: 'SNI_MISMATCH',
          message: err.message,
          expected: err.expected,
        });
      }
      throw err;
    }
  });

  app.delete('/api/hosts/:id', auth, async (req, reply) => {
    const { id } = HostIdParamSchema.parse(req.params);
    try {
      await svc.deleteHost(id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof svc.HostNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  app.put('/api/hosts/reorder', auth, async (req, reply) => {
    const input = ReorderHostsSchema.parse(req.body);
    try {
      return reply.send({ hosts: await svc.reorderHosts(input) });
    } catch (err) {
      if (err instanceof svc.HostNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}
