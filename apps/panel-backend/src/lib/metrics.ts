import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

/**
 * Prometheus metrics registry (slice 33).
 *
 * One process-global Registry. Default metrics (process CPU, memory, GC,
 * event-loop lag) + a small set of business-flavoured counters/gauges.
 *
 * Why a small set, not "everything":
 *   - Each label combination costs memory in the registry indefinitely.
 *     High-cardinality labels (user ids, node ids) explode quickly and
 *     turn the metrics endpoint into a slowloris vector.
 *   - We only add a metric when there's a concrete operator question it
 *     answers, alerting on it, or putting it on the dashboard.
 *
 * Mount path: `/metrics`. Gated behind `requireAuth` in app.ts (both JWT
 * admin sessions and `icp_*` API tokens work), so a Prometheus scrape
 * job needs an API token in its bearer header. No env knob, disabling
 * the endpoint is "don't scrape it"; default-metrics collection costs a
 * few microseconds per request so leaving it on always is fine.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

// HTTP histogram: one observation per request, labelled by method, the
// matched route (NOT raw URL, that's high cardinality) and status code
// family. Buckets cover sub-millisecond static-asset responses up through
// a slow subscription render.
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// Login attempts: split by outcome so an operator can graph the
// brute-force / lockout pattern without correlating across logs.
export const loginAttempts = new Counter({
  name: 'iceslab_login_attempts_total',
  help: 'Admin login attempts split by outcome',
  labelNames: ['result'] as const, // ok | invalid | locked
  registers: [registry],
});

// Subscription request counter, high-value signal: zero subscription
// requests for a long stretch means the panel is up but unreachable from
// clients (NS / CDN / TLS issue), even when /health is green.
export const subscriptionRequests = new Counter({
  name: 'iceslab_subscription_requests_total',
  help: 'Subscription endpoint hits by format',
  labelNames: ['format'] as const,
  registers: [registry],
});

// Inbound-sync job outcomes: tells us if the BullMQ worker is healthy
// AND if a particular node is failing to receive applyInbounds (we add
// node-name as a label; that's bounded by deployed node count which is
// always small for a single-operator panel).
export const inboundSyncJobs = new Counter({
  name: 'iceslab_inbound_sync_jobs_total',
  help: 'applyInbounds fan-out outcomes',
  labelNames: ['result'] as const, // ok | fail
  registers: [registry],
});

// Honey-route hits: separately tracks the security-gate trap firings
// to graph scanner activity over time. Doesn't replace the Telegram
// first-hit alert; gives a long-window view.
export const honeypotHits = new Counter({
  name: 'iceslab_honeypot_hits_total',
  help: 'Honey-route trap firings',
  registers: [registry],
});

// Geo-block denials, same idea: per-day count of admin-route accesses
// from disallowed countries. Spikes mean someone is actively probing.
export const geoBlockDenials = new Counter({
  name: 'iceslab_geo_block_denials_total',
  help: 'Admin requests rejected by ADMIN_ALLOWED_COUNTRIES',
  registers: [registry],
});

// Live gauges: refreshed by a 30s loop in scheduler.queue so they're
// always close-to-current without paying the DB cost on every /metrics
// scrape. See scheduler/metrics-refresh.ts for the loop.
export const nodesGauge = new Gauge({
  name: 'iceslab_nodes',
  help: 'Number of nodes by status',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const usersGauge = new Gauge({
  name: 'iceslab_users',
  help: 'Number of users by status',
  labelNames: ['status'] as const,
  registers: [registry],
});

/**
 * Normalise a request's route to a low-cardinality label. Falls back
 * to "unknown" for routes that didn't match anything, important so we
 * never emit raw URLs with embedded ids/tokens (cardinality bomb +
 * leaks subscriber tokens into the metrics endpoint).
 */
export function routeLabel(request: { routeOptions?: { url?: string } }): string {
  return request.routeOptions?.url ?? 'unknown';
}
