import type { FastifyBaseLogger } from 'fastify';

/**
 * Background jobs (the cron worker, the BullMQ queue workers, and the domain
 * event-bus handlers) run outside the request lifecycle, so they have no
 * `request.log`. Instead of scattering `console.log` across them (B15), they
 * share the Fastify app's pino instance through this module: structured,
 * level-filtered output that lands in the same stream as request logs.
 *
 * `index.ts` calls `setBaseLogger(app.log)` right after `buildApp()`. Cron
 * jobs fire on a >=15s schedule, so the real pino logger is always in place by
 * the time one runs. Until it is set (unit tests, or the millisecond window
 * before bootstrap finishes) `getLogger()` falls back to a console-backed shim
 * so importing this module never explodes and early logs still surface.
 *
 * Always resolve via `getLogger()` at log time, never capture it at module
 * load - a cron file imported before bootstrap would otherwise freeze the shim.
 */
let base: FastifyBaseLogger | null = null;

const shim: FastifyBaseLogger = {
  level: 'info',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info: (...a: any[]) => console.log(...a),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn: (...a: any[]) => console.warn(...a),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: (...a: any[]) => console.error(...a),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fatal: (...a: any[]) => console.error(...a),
  debug: () => {},
  trace: () => {},
  silent: () => {},
  child: () => shim,
} as unknown as FastifyBaseLogger;

export function setBaseLogger(logger: FastifyBaseLogger): void {
  base = logger;
}

/** The active background-job logger (real pino once bootstrap ran, else shim). */
export function getLogger(): FastifyBaseLogger {
  return base ?? shim;
}
