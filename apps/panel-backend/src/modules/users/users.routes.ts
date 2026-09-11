import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { requireAuth } from '../auth/auth.hook.js';
import {
  BulkUsersSchema,
  CreateUserSchema,
  UpdateUserSchema,
  ListUsersQuerySchema,
  UserIdParamSchema,
} from './users.schemas.js';
import * as usersService from './users.service.js';
import { mapUserToPublic } from './users.mapper.js';
import { getUserDelivery } from './users.delivery.js';
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
          firstConnectedAt: nstr,
          lastConnectedNodeId: nstr,
          lastConnectedNodeName: nstr,
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
  // no-auth (Fastify v5 quirk, see feedback_fastify_auth memory). All
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
      if (err instanceof usersService.SubscriptionTokenTakenError) {
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

  // GET /api/users/tags - distinct tags in use, for the Filters popover.
  // Declared before /api/users/:id so "tags" isn't parsed as an id.
  // Cheap (one indexed DISTINCT) and small: a tag set is operator-authored, so
  // it stays in the dozens even on a large install.
  app.get('/api/users/tags', auth, async (_request, reply) => {
    const rows = await prisma.user.findMany({
      where: { deletedAt: null, tag: { not: null } },
      distinct: ['tag'],
      select: { tag: true },
      orderBy: { tag: 'asc' },
    });
    return reply.send({ tags: rows.map((r) => r.tag).filter((t): t is string => t !== null) });
  });

  // What this user actually gets served, as opposed to what is on their row:
  // the routing preset after the user -> squad -> panel fall-through, and the
  // format their client's User-Agent resolves to. Both are decided at serve
  // time out of several places, so neither is visible on the user itself.
  // Declared before /api/users/:id so "delivery" is not read as an id.
  app.get('/api/users/:id/delivery', auth, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    const delivery = await getUserDelivery(params.id);
    if (!delivery) return reply.code(404).send({ error: 'USER_NOT_FOUND' });
    return reply.send(delivery);
  });

  // POST /api/users/bulk - one action, many users. Declared before
  // /api/users/:id so "bulk" is not read as an id.
  //
  // Always 200, even when some users failed: the response body is the report.
  // A blanket 4xx would tell the caller nothing about WHICH of two hundred ids
  // went wrong, and rolling the whole batch back over three stale ids would be
  // worse than doing the other hundred and ninety-seven.
  app.post('/api/users/bulk', auth, async (request, reply) => {
    const input = BulkUsersSchema.parse(request.body);
    const result = await usersService.bulkUsers(input);
    return reply.send({
      action: input.action,
      requested: input.userIds.length,
      succeeded: result.ok.length,
      ok: result.ok,
      failed: result.failed,
    });
  });

  // ───── Lookups by natural key ─────
  //
  // A Telegram bot never holds our internal uuid: it knows the person by their
  // telegram id, and support knows them by username, email or the token in the
  // link they pasted. Without these, every bot action starts with a full-list
  // scan and a client-side filter, which is both slow and racy on a roster of
  // thousands.
  //
  // Declared BEFORE /api/users/:id so `by-telegram-id` is not parsed as an id.
  //
  // ⚠ Two of these four keys can match SEVERAL people, so they return a LIST.
  //
  //   - `telegramId`: in the operator's live data 151 telegram ids belong to
  //     more than one account and one belongs to 24. Families share a login,
  //     resellers hold several subscriptions under one chat.
  //   - `email`: no constraint anywhere, and nothing stops two accounts from
  //     carrying the same address.
  //
  // They used to answer with `findFirst`, i.e. with an ARBITRARY one of the
  // matches, and a bot acting on that answer acted on the wrong person's
  // subscription - silently, because the reply looked perfectly valid.
  //
  // The other two stay single. `subscriptionToken` is UNIQUE in the schema, and
  // a token identifying exactly one person is the whole point of a token.
  // `username` has no DB constraint but createUser refuses a duplicate (409),
  // so at most one live user carries a given name. ⚠ That guarantee comes from
  // the service, not the column: an importer writing to the database directly
  // could seed duplicates, and then this lookup would hide all but the first.
  //
  // The lists are not paginated and not capped on purpose. These are natural-key
  // lookups over a handful of rows; a cap would either truncate silently (the
  // failure this change exists to remove) or need a page cursor nobody would
  // use. Listing at scale is what GET /api/users is for.
  const lookupMany = async (
    where: Prisma.UserWhereInput,
    reply: FastifyReply,
  ): Promise<unknown> => {
    const users = await prisma.user.findMany({
      where: { ...where, deletedAt: null },
      include: { traffic: { include: { lastConnectedNode: { select: { id: true, name: true } } } } },
      // Stable order, oldest first: without it the same request can come back
      // in a different order and a caller that takes "the first one" behaves
      // differently on identical data.
      orderBy: { createdAt: 'asc' },
    });
    return reply.send({
      users: users.map((u) => mapUserToPublic(u, u.traffic)),
      total: users.length,
    });
  };

  const lookupOne = async (
    where: Prisma.UserWhereInput,
    reply: FastifyReply,
  ): Promise<unknown> => {
    const user = await prisma.user.findFirst({
      where: { ...where, deletedAt: null },
      include: { traffic: { include: { lastConnectedNode: { select: { id: true, name: true } } } } },
    });
    if (!user) return reply.code(404).send({ error: 'USER_NOT_FOUND' });
    return reply.send(mapUserToPublic(user, user.traffic));
  };

  app.get('/api/users/by-telegram-id/:telegramId', auth, async (request, reply) => {
    const { telegramId } = z
      .object({ telegramId: z.string().regex(/^\d+$/, 'telegram id must be digits') })
      .parse(request.params);
    // BigInt: Telegram ids passed 2^32 long ago and will pass 2^53 eventually.
    return lookupMany({ telegramId: BigInt(telegramId) }, reply);
  });

  app.get('/api/users/by-username/:username', auth, async (request, reply) => {
    const { username } = z.object({ username: z.string().min(1).max(64) }).parse(request.params);
    return lookupOne({ username }, reply);
  });

  app.get('/api/users/by-subscription-token/:token', auth, async (request, reply) => {
    const { token } = z.object({ token: z.string().min(8).max(64) }).parse(request.params);
    return lookupOne({ subscriptionToken: token }, reply);
  });

  app.get('/api/users/by-email/:email', auth, async (request, reply) => {
    const { email } = z.object({ email: z.string().min(3).max(255) }).parse(request.params);
    return lookupMany({ email }, reply);
  });

  /**
   * GET /api/users/:id/usage?start=&end=
   *
   * Per-day traffic for one user. The rows have been accumulating since the
   * stats poller landed; there was simply no way to read them, so a bot asking
   * "how much did I use this month" had nothing to answer with.
   *
   * Daily granularity, because that is what is stored: the poller folds each
   * node's deltas into a per-(node, user, day) row. Days with no traffic have
   * no row at all rather than a zero, so a caller charting a period must fill
   * gaps itself - inventing zeroes here would hide the difference between "used
   * nothing" and "node reported nothing".
   *
   * Totals are summed across nodes and returned alongside, since that is what
   * the caller almost always wants and it saves them adding bigints correctly.
   */
  app.get('/api/users/:id/usage', auth, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    const query = z
      .object({
        start: z.iso.date().optional(),
        end: z.iso.date().optional(),
        // Per-node breakdown is opt-in: most callers want one number per day,
        // and the split multiplies the row count by the size of the fleet.
        byNode: z.enum(['true', 'false']).default('false'),
      })
      .parse(request.query);

    const user = await prisma.user.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { id: true },
    });
    if (!user) return reply.code(404).send({ error: 'USER_NOT_FOUND' });

    // Default window: the last 30 days, which is the period a subscription
    // question is almost always about.
    const end = query.end ? new Date(query.end) : new Date();
    const start = query.start
      ? new Date(query.start)
      : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);

    const rows = await prisma.nodeUserUsageHistory.findMany({
      where: { userId: params.id, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
      select: { date: true, bytesIn: true, bytesOut: true, nodeId: true },
    });

    const perNode = query.byNode === 'true';
    const buckets = new Map<string, { date: string; nodeId?: string; bytesIn: bigint; bytesOut: bigint }>();
    for (const r of rows) {
      const date = r.date.toISOString().slice(0, 10);
      const key = perNode ? `${date}|${r.nodeId}` : date;
      const b = buckets.get(key) ?? {
        date,
        ...(perNode ? { nodeId: r.nodeId } : {}),
        bytesIn: 0n,
        bytesOut: 0n,
      };
      b.bytesIn += r.bytesIn;
      b.bytesOut += r.bytesOut;
      buckets.set(key, b);
    }

    let totalIn = 0n;
    let totalOut = 0n;
    for (const b of buckets.values()) {
      totalIn += b.bytesIn;
      totalOut += b.bytesOut;
    }

    // Bytes go out as strings: a month of traffic passes 2^53 long before a
    // year does, and JSON numbers would round it silently.
    return reply.send({
      userId: params.id,
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      totalBytesIn: totalIn.toString(),
      totalBytesOut: totalOut.toString(),
      days: [...buckets.values()].map((b) => ({
        date: b.date,
        ...(b.nodeId ? { nodeId: b.nodeId } : {}),
        bytesIn: b.bytesIn.toString(),
        bytesOut: b.bytesOut.toString(),
      })),
    });
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

  // GET /api/users/:id/endpoints: per-protocol URIs for this user.
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
        // Admin context, no UA-driven SRR filtering, return every endpoint.
        userAgent: '',
      });
      return reply.send({
        endpoints: result.endpoints.map((e) => ({
          protocol: e.protocol,
          /**
           * The core serving it. A protocol name alone does not say what the
           * client is talking to: hysteria2 served by its own daemon and by
           * xray are the same protocol and different dialects, and the link
           * above already differs between them. A card that prints the protocol
           * without the engine prints half the answer.
           */
          engine: e.engine,
          // `label` is the string the client shows. It was called `nodeName`
          // until 2026-07-31 while never holding a node name: one node emits
          // several of these (a cascade entry produces one per direction and
          // policy), so the old name invited a join that quietly drops rows.
          // `nodeId` is the join key.
          label: e.nodeName,
          nodeId: e.nodeId,
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

  // POST /api/users/:id/revoke: kill the current subscription link (leaked or
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

  // POST /api/users/:id/rotate-subscription: issue a fresh token (old link
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

  // POST /api/users/:id/reset-traffic: zero used traffic + stamp the reset;
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
