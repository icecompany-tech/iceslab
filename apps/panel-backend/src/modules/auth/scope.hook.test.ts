import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requiredScopeFor, enforceScopes, isKnownScope } from './scope.hook.js';

describe('isKnownScope', () => {
  it('accepts *, sub:read and every resource:verb', () => {
    const good = [
      '*',
      'sub:read',
      'users:read',
      'users:write',
      'nodes:write',
      'recipes:read',
      'hwid-devices:write',
    ];
    for (const s of good) {
      expect(isKnownScope(s), s).toBe(true);
    }
  });

  it('rejects typos and unknown / malformed scopes', () => {
    const bad = [
      'user:read', // typo: users
      'users:reed', // typo: read
      'users', // no verb
      'admin', // not a resource
      'users:*', // no wildcard verb
      'api-tokens:read', // tokens can never reach this route
      '',
    ];
    for (const s of bad) {
      expect(isKnownScope(s), s).toBe(false);
    }
  });
});

describe('requiredScopeFor', () => {
  it('derives <resource>:<verb> from method + route template', () => {
    expect(requiredScopeFor('GET', '/api/users')).toBe('users:read');
    expect(requiredScopeFor('POST', '/api/users')).toBe('users:write');
    expect(requiredScopeFor('PUT', '/api/users/:id')).toBe('users:write');
    expect(requiredScopeFor('DELETE', '/api/users/:id')).toBe('users:write');
    expect(requiredScopeFor('POST', '/api/users/:id/revoke')).toBe('users:write');
    expect(requiredScopeFor('POST', '/api/users/:id/reset-traffic')).toBe('users:write');
    expect(requiredScopeFor('GET', '/api/nodes/:id')).toBe('nodes:read');
    expect(requiredScopeFor('GET', '/api/settings')).toBe('settings:read');
    expect(requiredScopeFor('PUT', '/api/settings')).toBe('settings:write');
  });

  it('maps the per-user endpoints list to sub:read', () => {
    expect(requiredScopeFor('GET', '/api/users/:id/endpoints')).toBe('sub:read');
  });

  it('returns null for non-/api routes', () => {
    expect(requiredScopeFor('GET', '/health')).toBeNull();
    expect(requiredScopeFor('GET', '/metrics')).toBeNull();
    expect(requiredScopeFor('GET', undefined)).toBeNull();
  });
});

function makeReqReply(opts: {
  apiToken?: { id: string; name: string; scopes: string[] };
  method?: string;
  url?: string;
}) {
  const send = vi.fn();
  const code = vi.fn(() => ({ send }));
  const request = {
    apiToken: opts.apiToken,
    method: opts.method ?? 'GET',
    routeOptions: { url: opts.url },
  } as unknown as FastifyRequest;
  const reply = { code } as unknown as FastifyReply;
  return { request, reply, code, send };
}

describe('enforceScopes', () => {
  it('no-ops for non-token (admin JWT / public) requests', async () => {
    const { request, reply, code } = makeReqReply({ method: 'GET', url: '/api/settings' });
    await enforceScopes(request, reply);
    expect(code).not.toHaveBeenCalled();
  });

  it('no-ops for full/legacy tokens (empty scopes)', async () => {
    const { request, reply, code } = makeReqReply({
      apiToken: { id: 't', name: 'full', scopes: [] },
      method: 'PUT',
      url: '/api/settings',
    });
    await enforceScopes(request, reply);
    expect(code).not.toHaveBeenCalled();
  });

  it('no-ops for a wildcard token', async () => {
    const { request, reply, code } = makeReqReply({
      apiToken: { id: 't', name: 'star', scopes: ['*'] },
      method: 'DELETE',
      url: '/api/nodes/:id',
    });
    await enforceScopes(request, reply);
    expect(code).not.toHaveBeenCalled();
  });

  it('allows a scoped provisioning token on routes its scopes grant', async () => {
    const scopes = ['users:read', 'users:write', 'sub:read'];
    const cases = [
      ['POST', '/api/users'],
      ['PUT', '/api/users/:id'],
      ['POST', '/api/users/:id/revoke'],
      ['POST', '/api/users/:id/rotate-subscription'],
      ['POST', '/api/users/:id/reset-traffic'],
      ['GET', '/api/users/:id/endpoints'],
    ] as const;
    for (const [method, url] of cases) {
      const { request, reply, code } = makeReqReply({
        apiToken: { id: 't', name: 'prov', scopes },
        method,
        url,
      });
      await enforceScopes(request, reply);
      expect(code, `${method} ${url}`).not.toHaveBeenCalled();
    }
  });

  it('denies a scoped token on routes outside its scopes', async () => {
    const scopes = ['users:read', 'users:write', 'sub:read'];
    const cases = [
      ['GET', '/api/settings'],
      ['PUT', '/api/settings'],
      ['POST', '/api/nodes'],
      ['GET', '/api/dashboard/overview'],
      ['POST', '/api/api-tokens'],
    ] as const;
    for (const [method, url] of cases) {
      const { request, reply, code, send } = makeReqReply({
        apiToken: { id: 't', name: 'prov', scopes },
        method,
        url,
      });
      await enforceScopes(request, reply);
      expect(code, `${method} ${url}`).toHaveBeenCalledWith(403);
      expect(send).toHaveBeenCalled();
    }
  });
});
