import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCompress from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pingDatabase } from './prisma.js';
import { pingRedis, redis } from './lib/redis.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { nodesRoutes } from './modules/nodes/nodes.routes.js';
import { subscriptionRoutes } from './modules/subscription/subscription.routes.js';
import { srrRoutes } from './modules/srr/srr.routes.js';
// Slice 27: `inboundsRoutes` retired. The new /api/profiles + /api/bindings
// pair from `profilesRoutes` replaces it. The inbounds module file is kept
// in the tree for now because its config schemas are reused by profiles, but
// no routes are mounted.
// import { inboundsRoutes } from './modules/inbounds/inbounds.routes.js';
import { squadsRoutes } from './modules/squads/squads.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { profilesRoutes } from './modules/profiles/profiles.routes.js';
import { hostsRoutes } from './modules/hosts/hosts.routes.js';
import { cascadeRoutes } from './modules/cascades/cascade.routes.js';
import { hwidRoutes } from './modules/hwid/hwid.routes.js';
import { regionsRoutes } from './modules/regions/regions.routes.js';
import { testConnectRoutes } from './modules/test-connect/test-connect.routes.js';
import { apiTokensRoutes } from './modules/api-tokens/api-tokens.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { bullBoardRoutes } from './modules/admin/bull-board.routes.js';
import { systemRoutes } from './modules/system/system.routes.js';
import { registerSecurityGate } from './lib/security-gate.js';
import { registry as metricsRegistry, httpRequestDuration, routeLabel } from './lib/metrics.js';
import { requireAuth } from './modules/auth/auth.hook.js';
import { enforceScopes } from './modules/auth/scope.hook.js';

/**
 * Build the Fastify instance with all plugins and routes registered.
 *
 * Side-effect-free: does not call `app.listen()`, does not start BullMQ workers,
 * and does not register cron jobs. The bootstrap (`index.ts`) wires those up.
 *
 * Tests use this directly with `app.inject(...)` for end-to-end HTTP coverage
 * without binding a port.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    // X-Forwarded-For trust hops, gated by env. Zero (default) ignores
    // the header entirely so dev / single-host runs aren't spoofable.
    // Production behind Caddy + Cloudflare uses TRUST_PROXY_HOPS=2.
    // Bumping this above the real hop count is a security bug, any
    // client can then forge X-Forwarded-For and dodge per-IP rate limits.
    trustProxy: config.TRUST_PROXY_HOPS,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      // Log the issues to stdout so admins can see *which field* failed
      // without needing to open browser DevTools, caught by request log
      // but with full issue array (path + message + code per offending
      // field) instead of just `statusCode: 400`.
      request.log.warn(
        { url: request.url, issues: error.issues },
        'Zod validation failed',
      );
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
        issues: error.issues,
      });
    }

    // Honor explicit statusCode set by Fastify plugins, most importantly
    // @fastify/rate-limit, which throws Error{statusCode:429} when a route
    // exceeds its per-route or global budget. Before this branch existed,
    // every rate-limit hit fell through to the generic 500 path below: the
    // client saw HTTP 500 *with* Retry-After / X-RateLimit-* headers (the
    // plugin sets those on `reply` before throwing), which is bizarre and
    // useless for an attacker, AND triggered noisy "Unhandled error" logs
    // for what is normal protection. Caught live 2026-05-12 on cycle #6
    // reality-check while testing the login per-IP rate-limit (max=5/min).
    //
    // We only special-case 4xx, 5xx-flagged plugin errors should still
    // surface as our generic 500 because something IS broken and the log
    // entry has diagnostic value.
    const errWithCode = error as { statusCode?: number; message?: string };
    const statusCode = errWithCode.statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: statusCode === 429 ? 'RATE_LIMITED' : 'REQUEST_REJECTED',
        message: errWithCode.message ?? 'Request rejected',
      });
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  // Slice 33: HTTP request histogram. `onResponse` fires after the route
  // matched, so request.routeOptions.url is the templated path (low
  // cardinality), not the raw URL with embedded ids/tokens.
  app.addHook('onResponse', async (request, reply) => {
    const elapsedSec = reply.elapsedTime / 1000;
    httpRequestDuration.observe(
      {
        method: request.method,
        route: routeLabel(request),
        status: String(reply.statusCode),
      },
      elapsedSec,
    );
  });

  // Enforce API-token scopes globally. preHandler runs after route-level
  // requireAuth, so request.apiToken is populated. Admin-JWT sessions and
  // full/legacy tokens (empty scopes) are unaffected; tokens with explicit
  // scopes are least-privilege (default-deny on unmapped routes). Added before
  // every route below so it covers /metrics and all plugin routes.
  app.addHook('preHandler', enforceScopes);

  // /metrics: Prometheus scrape endpoint. Auth-gated so it isn't a free
  // info disclosure; Prometheus jobs use an `icp_*` API token in
  // Authorization: Bearer for scraping.
  app.get(
    '/metrics',
    { onRequest: [requireAuth] },
    async (_request, reply) => {
      reply.header('content-type', metricsRegistry.contentType);
      return reply.send(await metricsRegistry.metrics());
    },
  );

  app.get('/health', async () => {
    const [dbOk, redisOk] = await Promise.all([pingDatabase(), pingRedis()]);
    return {
      status: dbOk && redisOk ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'down',
      redis: redisOk ? 'ok' : 'down',
    };
  });

  // Compress JSON responses ≥1 KB. Dashboard overview is the obvious target,
  // the per-node metrics + nodes table + events array runs ~12 KB and gzips
  // to ~2 KB. Below threshold (small lists, error bodies) we skip compression
  // to avoid the CPU/latency cost on responses where the savings are noise.
  //
  // Restricted to application/json so subscription URIs (text/plain, YAML,
  // wgconf) stay raw, those clients are mobile VPN apps that don't always
  // negotiate Accept-Encoding correctly, and the payloads are small.
  //
  // Skipped under NODE_ENV=test: vitest's app.inject() advertises
  // Accept-Encoding but light-my-request doesn't auto-decode the response,
  // so compressed bodies look like gibberish to JSON.parse. The compression
  // win is a production concern anyway.
  if (config.NODE_ENV !== 'test') {
    await app.register(fastifyCompress, {
      global: true,
      encodings: ['gzip', 'deflate'],
      threshold: 1024,
      customTypes: /^application\/json$/,
    });
  }

  await app.register(fastifyCors, {
    origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
    // Explicit methods, `@fastify/cors` defaults to GET/HEAD/POST only,
    // which silently breaks DELETE/PUT mutations from the SPA (browser
    // CORS preflight rejects them). Caught the first time admin tried to
    // delete a user via the UI.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    cache: 10000,
    // B9 - back the rate-limit counter with Redis so the window survives a
    // restart (in-memory reset every deploy, letting a flooder start fresh)
    // and stays consistent if the backend ever runs more than one instance.
    //
    // NOT in tests: each test file builds its own app, and the default
    // in-memory store resets per instance. A shared Redis store instead
    // accumulates auth requests across the WHOLE suite and trips the 100/min
    // global limit (429 RATE_LIMITED in registerAdmin). Keep tests on the
    // per-instance in-memory store.
    ...(config.NODE_ENV === 'test' ? {} : { redis }),
  });

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
    // Slice 37: also accept the JWT via cookie so server-rendered tools
    // mounted on the panel origin (Bull-board UI at /admin/queues) can be
    // gated behind requireAuth without copy-pasting tokens. The SPA sets
    // this cookie on login alongside its localStorage copy.
    cookie: {
      cookieName: 'iceslab_auth',
      signed: false,
    },
  });

  // Tier-1 security: blacklist + honeypot + geo-block. Mounted before
  // every route so a flagged IP can't even reach business logic. Skipped
  // entirely under NODE_ENV=test, tests pose as random IPs and we don't
  // want them tripping the honeypot when they probe `/.env` etc.
  if (config.NODE_ENV !== 'test') {
    await registerSecurityGate(app);
  }

  await app.register(authRoutes);
  await app.register(usersRoutes);
  await app.register(nodesRoutes);
  await app.register(subscriptionRoutes);
  await app.register(srrRoutes);
  await app.register(squadsRoutes);
  await app.register(dashboardRoutes);
  await app.register(profilesRoutes);
  await app.register(hostsRoutes);
  await app.register(cascadeRoutes);
  await app.register(hwidRoutes);
  await app.register(regionsRoutes);
  await app.register(testConnectRoutes);
  await app.register(apiTokensRoutes);
  await app.register(settingsRoutes);
  await app.register(bullBoardRoutes);
  await app.register(systemRoutes);

  return app;
}
