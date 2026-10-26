import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_RETENTION_DAYS,
  DELETED_USER_RETENTION_DAYS,
  type AdminAuditDetails,
  type AdminAuditEventDto,
  type AdminAuditListResponse,
  type ConnLogClearResponse,
} from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { NodeRequestError, NodeTransport } from '../nodes/nodes.transport.js';
import { pruneHistory } from '../maintenance/retention.cron.js';
import { AUDIT_DETAIL_SCHEMAS, checkDetail, isForbiddenDetailKey, keysOf } from './audit.details.js';
import { recordAudit } from './audit.service.js';

const alerts: string[] = [];
vi.mock('../../lib/notify/telegram-notify.js', async (real) => ({
  ...(await real<typeof import('../../lib/notify/telegram-notify.js')>()),
  notifyTelegramAsync: (text: string) => {
    alerts.push(text);
  },
}));

/**
 * The admin audit log, wave 1 (decisions 26.10): each marked route leaves its
 * row with the outcome its answer carried, GET /api/audit reads them back
 * newest first, and nothing in a row is a secret or an address.
 */
let app: FastifyInstance;
let admin: string;
let seq = 0;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  admin = await registerAndLogin(app);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, bearer = admin) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload !== undefined ? { payload } : {}) });

async function rows(): Promise<AdminAuditEventDto[]> {
  const res = await call('GET', '/api/audit?limit=200');
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as AdminAuditListResponse).events;
}

async function user(name = `audit-user-${++seq}`): Promise<string> {
  const res = await call('POST', '/api/users', { username: name });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function node(name = `audit-node-${++seq}`): Promise<string> {
  const n = await prisma.node.create({
    data: { name, address: `198.51.100.${++seq}:1337`, protocol: 'xray', heartbeatSecret: randomBytes(32) },
    select: { id: true },
  });
  return n.id;
}

describe('user.delete', () => {
  it('leaves an ok row: who, the user as redacted, and when the user will be erased', async () => {
    const id = await user('subscriber-anna');
    const res = await call('DELETE', `/api/users/${id}`);
    expect(res.statusCode).toBe(204);

    const [row] = await rows();
    expect(row).toMatchObject({
      actor: { kind: 'admin', label: 'admin' },
      action: 'user.delete',
      target: { kind: 'user', id, label: 'su***' },
      outcome: 'ok',
      refusal: null,
    });
    expect(row!.actor.id).toBeTruthy();
    const erasedAfter = Date.parse((row!.detail as AdminAuditDetails['user.delete']).erasedAfter);
    expect(Math.abs(erasedAfter - (Date.now() + DELETED_USER_RETENTION_DAYS * 86_400_000))).toBeLessThan(60_000);
    // The name of an erased subscriber is not kept, in any column.
    const raw = JSON.stringify(await prisma.$queryRawUnsafe('SELECT * FROM admin_audit_events'), (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(raw).not.toContain('subscriber-anna');
  });

  it('an unknown user is a 404 and no row: nothing was done to anything', async () => {
    const res = await call('DELETE', '/api/users/00000000-0000-4000-8000-000000000001');
    expect(res.statusCode).toBe(404);
    expect(await rows()).toEqual([]);
  });

  it('a bulk delete leaves one row per user it deleted', async () => {
    const a = await user();
    const b = await user();
    const res = await call('POST', '/api/users/bulk', {
      action: 'delete',
      userIds: [a, b, '00000000-0000-4000-8000-000000000002'],
    });
    expect(res.statusCode, res.body).toBe(200);
    const got = await rows();
    expect(got.map((r) => r.target.id).sort()).toEqual([a, b].sort());
    expect(got.every((r) => r.action === 'user.delete' && r.outcome === 'ok')).toBe(true);
  });

  it('an API token is named as one, for the admin who issued it', async () => {
    const minted = await call('POST', '/api/api-tokens', { name: 'billing-bot' });
    const token = JSON.parse(minted.body).token as string;
    const id = await user();
    expect((await call('DELETE', `/api/users/${id}`, undefined, token)).statusCode).toBe(204);
    const [row] = await rows();
    expect(row!.actor.kind).toBe('api_token');
    expect(row!.actor.label).toBe('api token');
    expect(row!.actor.id).toBe((await prisma.adminUser.findFirstOrThrow()).id);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('a row that cannot be written costs the row, never the action', async () => {
    const id = await user();
    vi.spyOn(prisma.adminAuditEvent, 'createMany').mockRejectedValueOnce(new Error('disk full'));
    expect((await call('DELETE', `/api/users/${id}`)).statusCode).toBe(204);
    expect(await prisma.user.count({ where: { id, deletedAt: { not: null } } })).toBe(1);
  });
});

describe('node.connLog.clear: the three outcomes', () => {
  const cleared: ConnLogClearResponse = {
    results: [
      { source: 'journal', state: 'cleared', steps: [{ command: 'journalctl --rotate', ok: true }] },
      { source: 'syslog', state: 'absent', steps: [] },
    ],
    after: { present: false, since: null, sources: [], checks: [] },
  };

  it('ok keeps what came of each source, and no command or address', async () => {
    const id = await node('ru-01');
    vi.spyOn(NodeTransport.prototype, 'clearConnLog').mockResolvedValue(cleared);
    expect((await call('POST', `/api/nodes/${id}/conn-log/clear`, {})).statusCode).toBe(200);
    const [row] = await rows();
    expect(row).toMatchObject({ action: 'node.connLog.clear', target: { kind: 'node', id, label: 'ru-01' }, outcome: 'ok' });
    expect(row!.detail).toEqual({ outcome: [{ source: 'journal', state: 'cleared' }, { source: 'syslog', state: 'absent' }] });
    expect(JSON.stringify(row)).not.toMatch(/journalctl|198\.51\.100/);
  });

  // ARCH 26.10: the log names the admin in full, text that leaves the panel
  // keeps the mask.
  it('the row has the admin by full name, the Telegram notice by the mask', async () => {
    const id = await node();
    vi.spyOn(NodeTransport.prototype, 'clearConnLog').mockResolvedValue(cleared);
    alerts.length = 0;
    expect((await call('POST', `/api/nodes/${id}/conn-log/clear`, {})).statusCode).toBe(200);
    const [stored] = await prisma.adminAuditEvent.findMany({ select: { actorLabel: true } });
    expect(stored!.actorLabel).toBe('admin');
    const notice = alerts.find((a) => a.includes('Connection log cleared'));
    // Markdown-escaped on the way out: ad*** is sent as ad\*\*\*.
    expect(notice).toContain('by: `ad\\*\\*\\*`');
    expect(notice).not.toContain('`admin`');
  });

  it('an old agent is refused, and the row keeps the code, never the message', async () => {
    const id = await node();
    vi.spyOn(NodeTransport.prototype, 'clearConnLog').mockRejectedValue(new NodeRequestError('not found', 404, null));
    expect((await call('POST', `/api/nodes/${id}/conn-log/clear`, {})).statusCode).toBe(409);
    const [row] = await rows();
    expect(row).toMatchObject({ outcome: 'refused', refusal: 'UPDATE_AGENT', detail: null });
  });

  it('a node that did not answer is failed, with no code', async () => {
    const id = await node();
    vi.spyOn(NodeTransport.prototype, 'clearConnLog').mockRejectedValue(new Error('connect ECONNREFUSED 198.51.100.30:1337'));
    expect((await call('POST', `/api/nodes/${id}/conn-log/clear`, {})).statusCode).toBe(502);
    const [row] = await rows();
    expect(row).toMatchObject({ outcome: 'failed', refusal: null, detail: null });
    expect(JSON.stringify(row)).not.toContain('198.51.100');
  });
});

describe('node policies', () => {
  const createPolicy = async (name: string) => {
    const res = await call('POST', '/api/node-policies', { name, rules: [{ action: { kind: 'direct' } }] });
    expect(res.statusCode, res.body).toBe(201);
    return JSON.parse(res.body).id as string;
  };

  it('create, update, attach, a swap as detach and attach, delete with the nodes it ran on', async () => {
    const nodeId = await node('nl-01');
    const first = await createPolicy('office');
    const second = await createPolicy('home');
    expect((await call('PUT', `/api/node-policies/${first}`, { rules: [{ action: { kind: 'direct' } }, { action: { kind: 'block' } }] })).statusCode).toBe(200);
    expect((await call('PUT', `/api/nodes/${nodeId}`, { policyId: first })).statusCode).toBe(200);
    // The same policy again is no change and no row.
    expect((await call('PUT', `/api/nodes/${nodeId}`, { policyId: first })).statusCode).toBe(200);
    expect((await call('PUT', `/api/nodes/${nodeId}`, { policyId: second })).statusCode).toBe(200);
    expect((await call('DELETE', `/api/node-policies/${second}`)).statusCode).toBe(204);

    const got = (await rows()).reverse().map((r) => [r.action, r.target.label, r.detail]);
    expect(got).toEqual([
      ['nodePolicy.create', 'office', { rules: 1, nodes: 0 }],
      ['nodePolicy.create', 'home', { rules: 1, nodes: 0 }],
      ['nodePolicy.update', 'office', { rules: 2, nodes: 0 }],
      ['nodePolicy.attach', 'nl-01', { policyId: first, policyLabel: 'office' }],
      ['nodePolicy.detach', 'nl-01', { policyId: first, policyLabel: 'office' }],
      ['nodePolicy.attach', 'nl-01', { policyId: second, policyLabel: 'home' }],
      ['nodePolicy.delete', 'home', { rules: 1, nodes: 1 }],
    ]);
  });

  it('a refused create keeps the name it was given and no id', async () => {
    await createPolicy('taken');
    const res = await call('POST', '/api/node-policies', { name: 'taken', rules: [] });
    expect(res.statusCode).toBe(409);
    const [row] = await rows();
    expect(row).toMatchObject({ action: 'nodePolicy.create', target: { id: null, label: 'taken' }, outcome: 'refused', refusal: 'CONFLICT' });
  });
});

describe('cascades', () => {
  it('create, switch off, delete: the size of the cascade on each', async () => {
    const entry = await node('ru-entry');
    const exit = await node('de-exit');
    const created = await call('POST', '/api/cascades', {
      name: 'ru-de',
      enabled: true,
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'xray' }],
      directions: [{ nodeIds: [exit], countryCode: 'DE' }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = JSON.parse(created.body).id as string;
    expect((await call('PUT', `/api/cascades/${id}`, { enabled: false })).statusCode).toBe(200);
    expect((await call('DELETE', `/api/cascades/${id}`)).statusCode).toBe(204);

    const got = (await rows()).reverse().map((r) => [r.action, r.target.id, r.target.label, r.outcome, r.detail]);
    const size = { directions: 1, nodes: 2 };
    expect(got).toEqual([
      ['cascade.create', id, 'ru-de', 'ok', size],
      ['cascade.disable', id, 'ru-de', 'ok', size],
      ['cascade.delete', id, 'ru-de', 'ok', size],
    ]);
  });
});

describe('GET /api/audit', () => {
  const seed = async (n: number) => {
    const actor = { kind: 'system', id: null, label: 'system' } as const;
    // One call, one `at` for all: the page boundary falls inside a tie.
    await recordAudit(
      actor,
      Array.from({ length: n }, (_, i) => ({
        action: i % 2 ? 'cascade.update' : 'user.delete',
        target: { kind: i % 2 ? 'cascade' : 'user', id: null, label: `t${i}` },
      }) as const),
      'ok',
      null,
    );
  };

  it('pages newest first by a cursor, through a tie in at, with no row twice and none lost', async () => {
    await seed(5);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await call('GET', `/api/audit?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as AdminAuditListResponse;
      seen.push(...body.events.map((e) => e.id));
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([...seen].sort((a, b) => Number(BigInt(b) - BigInt(a))));
    expect(new Set(seen).size).toBe(5);
  });

  it('filters by an action, a prefix and a target kind', async () => {
    await seed(5);
    const of = async (q: string) =>
      (JSON.parse((await call('GET', `/api/audit?${q}`)).body) as AdminAuditListResponse).events.length;
    expect(await of('action=user.delete')).toBe(3);
    expect(await of('action=cascade.')).toBe(2);
    expect(await of('targetKind=cascade')).toBe(2);
    expect(await of(`from=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`)).toBe(0);
  });

  it('refuses a cursor it did not hand out, and a query it cannot read', async () => {
    const bad = await call('GET', '/api/audit?cursor=bm90LWEtY3Vyc29y');
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body).error).toBe('BAD_CURSOR');
    const query = await call('GET', '/api/audit?limit=500');
    expect(query.statusCode).toBe(400);
    expect(JSON.parse(query.body).error).toBe('VALIDATION_ERROR');
  });

  it('is read in a session: a full token and a scoped one are both AUDIT_ADMIN_ONLY', async () => {
    for (const scopes of [undefined, ['users:read']]) {
      const minted = await call('POST', '/api/api-tokens', { name: `reader-${++seq}`, ...(scopes ? { scopes } : {}) });
      expect(minted.statusCode, minted.body).toBe(201);
      const res = await call('GET', '/api/audit', undefined, JSON.parse(minted.body).token as string);
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toBe('AUDIT_ADMIN_ONLY');
    }
  });
});

describe('retention', () => {
  it(`keeps a row ${ADMIN_AUDIT_RETENTION_DAYS - 1} days old and erases one ${ADMIN_AUDIT_RETENTION_DAYS + 1} days old`, async () => {
    const at = (days: number) => new Date(Date.now() - days * 86_400_000);
    const row = (days: number, label: string) => ({
      at: at(days),
      actorKind: 'system',
      actorLabel: 'system',
      action: 'user.delete',
      targetKind: 'user',
      targetLabel: label,
      outcome: 'ok',
    });
    await prisma.adminAuditEvent.createMany({
      data: [row(ADMIN_AUDIT_RETENTION_DAYS + 1, 'old'), row(ADMIN_AUDIT_RETENTION_DAYS - 1, 'kept')],
    });
    expect((await pruneHistory()).adminAudit).toBe(1);
    expect((await prisma.adminAuditEvent.findMany()).map((r) => r.targetLabel)).toEqual(['kept']);
  });
});

describe('the detail of a row', () => {
  // One valid detail per action, typed by the shared contract: a new action
  // without its schema or its sample does not compile.
  const samples: { [A in (typeof ADMIN_AUDIT_ACTIONS)[number]]: AdminAuditDetails[A] } = {
    'user.delete': { erasedAfter: '2026-11-25T10:00:00.000Z' },
    'node.connLog.clear': { outcome: [{ source: 'journal', state: 'cleared' }] },
    'node.cert.rotate': { notAfter: '2027-10-26T10:00:00.000Z' },
    'cascade.create': { directions: 1, nodes: 2 },
    'cascade.update': { directions: 1, nodes: 2 },
    'cascade.delete': { directions: 1, nodes: 2 },
    'cascade.enable': { directions: 1, nodes: 2 },
    'cascade.disable': { directions: 1, nodes: 2 },
    'nodePolicy.create': { rules: 1, nodes: 0 },
    'nodePolicy.update': { rules: 1, nodes: 0 },
    'nodePolicy.delete': { rules: 1, nodes: 0 },
    'nodePolicy.attach': { policyId: '00000000-0000-4000-8000-000000000003', policyLabel: 'office' },
    'nodePolicy.detach': { policyId: '00000000-0000-4000-8000-000000000003', policyLabel: 'office' },
  };

  it('every action has a schema, takes its sample as is, and no key of it is a forbidden name', () => {
    expect(Object.keys(AUDIT_DETAIL_SCHEMAS).sort()).toEqual([...ADMIN_AUDIT_ACTIONS].sort());
    for (const action of ADMIN_AUDIT_ACTIONS) {
      expect(checkDetail(action, samples[action]), action).toEqual({ detail: samples[action] });
      expect(keysOf(samples[action]).filter(isForbiddenDetailKey), action).toEqual([]);
    }
  });

  it('a field nobody listed is dropped with the row kept, a token among them', () => {
    expect(checkDetail('cascade.update', { directions: 1, nodes: 2, token: 'icp_x' })).toEqual({ detail: null, dropped: 'schema' });
    expect(checkDetail('node.connLog.clear', { outcome: [{ source: 'journal', state: 'cleared', command: 'rm' }] }).detail).toBeNull();
  });

  it('names forbidden as words, not as letters', () => {
    for (const k of ['token', 'apiKey', 'password', 'clientIp', 'ip', 'ip_addr', 'address', 'certPem', 'body', 'config']) {
      expect(isForbiddenDetailKey(k), k).toBe(true);
    }
    for (const k of ['description', 'policyId', 'directions', 'nodes', 'erasedAfter', 'shipped']) {
      expect(isForbiddenDetailKey(k), k).toBe(false);
    }
  });
});
