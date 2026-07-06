import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import * as dashboardService from './dashboard.service.js';
import { getInsights } from './insights.service.js';

// B12 - response schema for the hottest read in the panel (every admin tab
// polls /overview every 30s). Attaching a schema swaps Fastify's generic
// JSON.stringify for a compiled fast-json-stringify serializer over the
// declared primitive fields. Crucially every object sets
// `additionalProperties: true`, so this is purely additive: nothing is ever
// stripped (the usual response-schema footgun), undeclared/nested fields pass
// through unchanged, and the complex `host`/`metrics` blobs from
// @iceslab/shared ride through as opaque objects without needing a mirrored
// schema that could drift. Shape mirrors DashboardOverview in dashboard.service.
const nullableStr = { type: ['string', 'null'] } as const;
const overviewResponseSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    users: {
      type: 'object',
      additionalProperties: true,
      properties: {
        total: { type: 'number' },
        byStatus: { type: 'object', additionalProperties: true },
        onlineNow: { type: 'number' },
        onlineToday: { type: 'number' },
        onlineThisWeek: { type: 'number' },
        neverOnline: { type: 'number' },
      },
    },
    traffic: {
      type: 'object',
      additionalProperties: true,
      properties: {
        todayBytes: { type: 'number' },
        yesterdayBytes: { type: 'number' },
        last7dBytes: { type: 'number' },
        last30dBytes: { type: 'number' },
        calendarMonthBytes: { type: 'number' },
        currentYearBytes: { type: 'number' },
        prev7dBytes: { type: 'number' },
        prev30dBytes: { type: 'number' },
        lastCalendarMonthBytes: { type: 'number' },
        lastYearBytes: { type: 'number' },
        last24hHourly: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: { hour: { type: 'string' }, bytes: { type: 'number' } },
          },
        },
      },
    },
    system: {
      type: 'object',
      additionalProperties: true,
      properties: {
        onlineNodeCount: { type: 'number' },
        totalNodeCount: { type: 'number' },
      },
    },
    inventory: {
      type: 'object',
      additionalProperties: true,
      properties: {
        profileCount: { type: 'number' },
        squadCount: { type: 'number' },
      },
    },
    // host/metrics shapes live in @iceslab/shared and evolve independently,
    // pass them through opaque rather than mirror (and risk stripping) them.
    host: { type: ['object', 'null'], additionalProperties: true },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          address: { type: 'string' },
          protocol: { type: 'string' },
          status: { type: 'string' },
          countryCode: nullableStr,
          lastStatusChange: nullableStr,
          inboundCount: { type: 'number' },
          todayBytes: { type: 'number' },
          metrics: { type: ['object', 'null'], additionalProperties: true },
        },
      },
    },
    byProtocol: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          protocol: { type: 'string' },
          inboundCount: { type: 'number' },
          enabledUserCount: { type: 'number' },
        },
      },
    },
    topUsersToday: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          username: { type: 'string' },
          bytes: { type: 'number' },
        },
      },
    },
    recentEvents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          eventType: { type: 'string' },
          userId: { type: 'string' },
          username: nullableStr,
          createdAt: { type: 'string' },
        },
      },
    },
  },
} as const;

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/dashboard/overview',
    { onRequest: [requireAuth], schema: { response: { 200: overviewResponseSchema } } },
    async (_request, reply) => {
      const overview = await dashboardService.getOverview();
      return reply.send(overview);
    },
  );

  // K1-b/c Insights: on-demand (not polled). `days` selects the SRH window;
  // the HWID stats are point-in-time and ignore it.
  app.get<{ Querystring: { days?: string } }>(
    '/api/dashboard/insights',
    { onRequest: [requireAuth] },
    async (request, reply) => {
      const days = request.query.days ? Number(request.query.days) : undefined;
      const insights = await getInsights(days);
      return reply.send(insights);
    },
  );
}
