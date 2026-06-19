/**
 * Axios adapter for the read-only demo build. Replaces the HTTP transport
 * entirely (api.defaults.adapter), so the demo never opens a single network
 * connection to a real backend:
 *   - GET  -> served from ./fixtures by path.
 *   - POST/PUT/PATCH/DELETE -> no-op success stub (nothing mutates; the next
 *     refetch returns the unchanged fixtures).
 * Only ships in the demo build.
 */
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { now } from '../lib/demoFlag';
import {
  AUTH_STATUS,
  BINDINGS,
  CASCADES,
  INSIGHTS,
  NODES_LIST,
  PROFILES,
  PUBLIC_SETTINGS,
  REGIONS,
  SETTINGS,
  SQUADS,
  USERS_LIST,
  VERSION,
  buildOverview,
} from './fixtures';

function respond(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse;
}

const GET_ROUTES: Array<[RegExp, () => unknown]> = [
  [/^\/api\/dashboard\/overview$/, () => buildOverview()],
  [/^\/api\/dashboard\/insights/, () => INSIGHTS],
  [/^\/api\/auth\/status$/, () => AUTH_STATUS],
  [/^\/api\/auth\/2fa\/status$/, () => ({ enabled: false })],
  [/^\/api\/settings\/public$/, () => PUBLIC_SETTINGS],
  [/^\/api\/settings$/, () => SETTINGS],
  [/^\/api\/system\/version$/, () => VERSION],
  [/^\/api\/nodes$/, () => NODES_LIST],
  [/^\/api\/nodes\/[^/]+\/exposure$/, () => ({ checked: false })],
  [/^\/api\/regions$/, () => ({ regions: REGIONS })],
  [/^\/api\/cascades$/, () => ({ cascades: CASCADES })],
  [/^\/api\/profiles$/, () => ({ profiles: PROFILES })],
  [/^\/api\/bindings\/next-free-port$/, () => ({ port: 443 })],
  [/^\/api\/bindings$/, () => ({ bindings: BINDINGS })],
  [/^\/api\/hosts$/, () => ({ hosts: [] })],
  [/^\/api\/squads$/, () => ({ squads: SQUADS })],
  [/^\/api\/users$/, () => USERS_LIST],
  [/^\/api\/users\/[^/]+\/endpoints$/, () => ({ endpoints: [] })],
  [/^\/api\/users\/[^/]+\/hwid-devices$/, () => ({ devices: [] })],
  [/^\/api\/srr$/, () => ({ rules: [] })],
  [/^\/api\/api-tokens$/, () => ({ tokens: [] })],
  [/^\/api\/inbounds$/, () => ({ inbounds: [] })],
];

function parseBody(data: unknown): Record<string, unknown> {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return {};
}

export const demoAdapter: AxiosAdapter = (config) => {
  const method = (config.method ?? 'get').toLowerCase();
  // baseURL is '' in a prod-mode build, but strip any origin defensively.
  const path = (config.url ?? '').replace(/^https?:\/\/[^/]+/, '').split('?')[0]!;

  if (method === 'get') {
    for (const [re, handler] of GET_ROUTES) {
      if (re.test(path)) return Promise.resolve(respond(config, handler()));
    }
    // Unmapped GET: benign empty payload. Never a real request.
    return Promise.resolve(respond(config, {}));
  }

  // Mutations are no-ops in the read-only demo.
  if (method === 'delete') return Promise.resolve(respond(config, {}));
  const stub = {
    id: `demo-${Math.random().toString(36).slice(2, 10)}`,
    ...parseBody(config.data),
    createdAt: new Date(now()).toISOString(),
    updatedAt: new Date(now()).toISOString(),
  };
  return Promise.resolve(respond(config, stub));
};
