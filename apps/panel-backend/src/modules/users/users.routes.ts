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

// B12-tail - response schema for the paginated users list (Users page keeps it
// warm via placeholderData). Compiles a fast-json-stringify serializer over the
// declared PublicUserDto primitives; every object is additionalProperties:true
// so nothing is ever stripped and undeclared fields pass through unchanged.
const nstr = { type: ['string', 'null'] } as const;
const nnum = { type: ['number', 'null'] } as const;
const usersListResponseSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    users: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          shortId: { type: 'string' },
          username: { type: 'string' },
          status: { type: 'string' },
          expireAt: nstr,
          trafficLimitBytes: nnum,
          trafficUsedBytes: { type: 'number' },
          lifetimeTrafficBytes: { type: 'number' },
          trafficLimitStrategy: { type: 'string' },
          lastTrafficResetAt: nstr,
          lastOnlineAt: nstr,
          subscriptionToken: { type: 'string' },
          subRevokedAt: nstr,
          hwidDeviceLimit: nnum,
          description: nstr,
          tag: nstr,
          telegramId: nstr,
          email: nstr,
          enabledProtocols: { type: 'array', items: { type: 'string' } },
          groupIds: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
      },
    },
    total: { type: 'number' },
    page: { type: 'number' },
    limit: { type: 'number' },
  },
} as const;

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
  app.get(
    '/api/users',
    { onRequest: [requireAuth], schema: { response: { 200: usersListResponseSchema } } },
    async (request, reply) => {
      const query = ListUsersQuerySchema.parse(request.query);
      const result = await usersService.listUsers(query);
      return reply.send(result);
    },
  );

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

  // POST /api/users/:id/revoke — kill the current subscription link (leaked or
  // abusive). /sub then returns 403 REVOKED until the link is rotated.
  app.post('/api/users/:id/revoke', auth, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    try {
      const user = await usersService.revokeSubscription(params.id);
      return reply.send(user);
    } catch (err) {
      if (err instanceof usersService.UserNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // POST /api/users/:id/rotate-subscription — issue a fresh token (old link
  // dies, prior revoke cleared so the new link works immediately).
  app.post('/api/users/:id/rotate-subscription', auth, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    try {
      const user = await usersService.rotateSubscription(params.id);
      return reply.send(user);
    } catch (err) {
      if (err instanceof usersService.UserNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // POST /api/users/:id/reset-traffic — zero used traffic + stamp the reset;
  // the user.traffic-reset cascade lifts a traffic limit and re-provisions
  // nodes. For period-billing ("bought a period -> counter reset").
  app.post('/api/users/:id/reset-traffic', auth, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    try {
      const user = await usersService.resetUserTraffic(params.id);
      return reply.send(user);
    } catch (err) {
      if (err instanceof usersService.UserNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}
