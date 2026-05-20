import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import {
  CreateUserSchema,
  UpdateUserSchema,
  ListUsersQuerySchema,
  UserIdParamSchema,
} from './users.schemas.js';
import * as usersService from './users.service.js';
import { prisma } from '../../prisma.js';
import {
  generateSubscription,
  SubscriptionForbiddenError,
  SubscriptionNotFoundError,
} from '../subscription/subscription.service.js';

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  // Wave-14 #15: per-route onRequest instead of plugin-level addHook so a
  // future public route added to this plugin doesn't silently inherit
  // no-auth (Fastify v5 quirk — see feedback_fastify_auth memory). All
  // current routes are still auth-gated; the change is structural.
  const auth = { onRequest: [requireAuth] };
  // POST /api/users
  app.post('/api/users', auth, async (request, reply) => {
    const input = CreateUserSchema.parse(request.body);
    try {
      const user = await usersService.createUser(input);
      return reply.code(201).send(user);
    } catch (err) {
      if (err instanceof usersService.UserAlreadyExistsError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  // GET /api/users
  app.get('/api/users', auth, async (request, reply) => {
    const query = ListUsersQuerySchema.parse(request.query);
    const result = await usersService.listUsers(query);
    return reply.send(result);
  });

  // GET /api/users/:id
  app.get('/api/users/:id', auth, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    try {
      const user = await usersService.getUserById(params.id);
      return reply.send(user);
    } catch (err) {
      if (err instanceof usersService.UserNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // GET /api/users/:id/endpoints — per-protocol URIs for this user.
  // Reuses the same generateSubscription pipeline that powers /sub/<token>
  // (no duplicated URI-building logic), then strips it down to {protocol,
  // nodeName, host, port, uri} entries the admin UI can render with copy
  // buttons. Added so admins don't have to fetch the public /sub endpoint
  // and decode formats by hand.
  app.get('/api/users/:id/endpoints', auth, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    const user = await prisma.user.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { subscriptionToken: true },
    });
    if (!user) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'user not found' });
    }
    try {
      const result = await generateSubscription(user.subscriptionToken, {
        ip: request.ip,
        // Admin context — no UA-driven SRR filtering, return every endpoint.
        userAgent: '',
      });
      return reply.send({
        endpoints: result.endpoints.map((e) => ({
          protocol: e.protocol,
          nodeName: e.nodeName,
          host: e.host,
          port: e.port,
          uri: e.uri,
        })),
      });
    } catch (err) {
      if (err instanceof SubscriptionNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'subscription not found' });
      }
      if (err instanceof SubscriptionForbiddenError) {
        return reply
          .code(403)
          .send({ error: 'FORBIDDEN', message: `Subscription is ${err.reason}` });
      }
      throw err;
    }
  });

  // PUT /api/users/:id
  app.put('/api/users/:id', auth, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    const input  = UpdateUserSchema.parse(request.body);
    try {
      const user = await usersService.updateUser(params.id, input);
      return reply.send(user);
    } catch (err) {
      if (err instanceof usersService.UserNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // DELETE /api/users/:id
  app.delete('/api/users/:id', auth, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    try {
      await usersService.deleteUser(params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof usersService.UserNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}
