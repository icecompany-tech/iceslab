import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { JSDOM } from 'jsdom';
import { FORMAT_NAMES, PROTOCOL_NAMES } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { invalidateSrrCache } from '../srr/srr.service.js';
import { deriveSsPassword } from '../../lib/auth/credentials.js';
import { parseProtocolsParam, withProtocols } from './subscription.protocols.js';
import { buildSubscriptionPage, type SubscriptionPageData } from './subscription.page.js';

/**
 * `?protocols=`: a subscription that hands out one protocol or a few, on every
 * format and on the page (promised to the operator 24.08).
 */

describe('the parameter', () => {
  it('reads names in any case, folds duplicates, keeps the panel order', () => {
    expect(parseProtocolsParam(' Xray, HYSTERIA ,xray')).toEqual({ kind: 'some', protocols: ['hysteria', 'xray'] });
    expect(parseProtocolsParam(undefined)).toEqual({ kind: 'all' });
    expect(parseProtocolsParam('')).toEqual({ kind: 'all' });
    expect(parseProtocolsParam(' , ')).toEqual({ kind: 'all' });
    // No alias: vless is a door of xray, not a protocol of the panel.
    expect(parseProtocolsParam('xray,vless')).toEqual({ kind: 'unknown', protocol: 'vless' });
  });

  it('is written into a link one way, and taken out without touching the rest', () => {
    const base = 'https://p.example/sub/tok';
    expect(withProtocols(base, ['xray'])).toBe(`${base}?protocols=xray`);
    expect(withProtocols(`${base}?format=clash&node=a`, ['hysteria', 'xray'])).toBe(
      `${base}?protocols=hysteria,xray&format=clash&node=a`,
    );
    expect(withProtocols(`${base}?protocols=xray&format=clash`, [])).toBe(`${base}?format=clash`);
    expect(withProtocols(`${base}?protocols=xray#name`, ['tuic'])).toBe(`${base}?protocols=tuic#name`);
    expect(withProtocols('?lang=ru', ['xray'])).toBe('?protocols=xray&lang=ru');
  });
});

// ───── the route ─────

let app: FastifyInstance;
let token: string;

const auth = () => ({ authorization: `Bearer ${token}` });

async function post(url: string, payload: object): Promise<string> {
  const res = await app.inject({ method: 'POST', url, headers: auth(), payload });
  if (res.statusCode !== 201) throw new Error(`${url}: ${res.statusCode} ${res.body}`);
  return JSON.parse(res.body).id as string;
}

let seq = 0;
async function bind(protocol: string, config: object, nodeId: string, port: number) {
  seq += 1;
  const profileId = await post('/api/profiles', { name: `${protocol}-${seq}`, protocol, config });
  await post('/api/bindings', { profileId, nodeId, port });
}

const XRAY = {
  realityDest: 'www.cloudflare.com:443',
  realityServerNames: ['www.cloudflare.com'],
  realityShortIds: ['abc123'],
  realityPrivateKey: 'test-pubkey-for-vitest',
  realityPublicKey: 'test-pubkey-for-vitest',
};

/** One node with three protocols on it, and a person who has all three. */
async function subscriber() {
  const node = await post('/api/nodes', { name: 'eu-1', address: '10.0.0.1:8443' });
  await bind('hysteria', {}, node, 443);
  await bind('xray', XRAY, node, 8443);
  await bind('shadowsocks', { method: 'chacha20-ietf-poly1305' }, node, 8388);
  const res = await app.inject({ method: 'POST', url: '/api/users', headers: auth(), payload: { username: 'alice' } });
  const id = JSON.parse(res.body).id as string;
  const u = await prisma.user.findUniqueOrThrow({
    where: { id },
    select: { subscriptionToken: true, hysteriaPassword: true, xrayUuid: true },
  });
  return { node, ...u, ssPassword: deriveSsPassword(u.xrayUuid, 'chacha20-ietf-poly1305') };
}

// Each request from its own address: the subscription route is rate-limited
// per (ip, token) and per ip, and this file asks every format three times.
let caller = 0;
const get = (url: string, headers: Record<string, string> = {}) => {
  caller += 1;
  return app.inject({ method: 'GET', url, headers, remoteAddress: `10.77.${Math.floor(caller / 250)}.${caller % 250}` });
};

/** The body as text, the base64 list decoded. */
function text(format: string, body: string): string {
  return format === 'plain' ? Buffer.from(body, 'base64').toString('utf8') : body;
}

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  invalidateSrrCache();
  token = await registerAndLogin(app);
  seq = 0;
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('?protocols= on the subscription', () => {
  it('refuses a name the panel does not have, naming it and the ones it has', async () => {
    const s = await subscriber();
    const res = await get(`/sub/${s.subscriptionToken}?protocols=xray,vless`);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({
      error: 'SUBSCRIPTION_PROTOCOL_UNKNOWN',
      protocol: 'vless',
      known: [...PROTOCOL_NAMES],
    });
  });

  it('hands out only the protocols asked for, on every format', async () => {
    const s = await subscriber();
    // The secret of each protocol, which is what would leak if a format
    // ignored the narrowing: the hysteria password, the xray uuid, the SS key.
    const secret = { hysteria: s.hysteriaPassword, xray: s.xrayUuid, shadowsocks: s.ssPassword };
    const formats = FORMAT_NAMES.filter((f) => f !== 'wgconf' && f !== 'amneziavpn');
    for (const only of ['hysteria', 'xray', 'shadowsocks'] as const) {
      for (const format of formats) {
        const res = await get(`/sub/${s.subscriptionToken}?format=${format}&protocols=${only}`);
        expect([200, 404], `${format} ${only}: ${res.body}`).toContain(res.statusCode);
        const body = text(format, res.body);
        for (const [p, value] of Object.entries(secret)) {
          if (p === only) continue;
          expect(body.includes(value), `${format} under ${only} carries ${p}`).toBe(false);
        }
      }
    }
    // And the one asked for is really there where the format carries it.
    const plain = text('plain', (await get(`/sub/${s.subscriptionToken}?protocols=xray`)).body);
    expect(plain.split('\n').filter(Boolean).every((l) => l.startsWith('vless://'))).toBe(true);
    expect(plain).toContain(s.xrayUuid);
  });

  it('several at once, in any case', async () => {
    const s = await subscriber();
    const lines = text('plain', (await get(`/sub/${s.subscriptionToken}?protocols=XRAY,hysteria`)).body)
      .split('\n')
      .filter(Boolean);
    expect(lines.map((l) => l.split('://')[0]).sort()).toEqual(['hysteria2', 'vless']);
  });

  it('says so when the narrowing leaves a format nothing: a comment where the format takes one, a 404 in words otherwise', async () => {
    const s = await subscriber();
    const clash = await get(`/sub/${s.subscriptionToken}?format=clash&protocols=tuic`);
    expect(clash.statusCode).toBe(200);
    expect(clash.body).toMatch(/^# this subscription has no hosts of tuic/);

    const wg = await get(`/sub/${s.subscriptionToken}?format=wgconf&protocols=amneziawg`);
    expect(wg.statusCode).toBe(200);
    expect(wg.body.startsWith('# ')).toBe(true);

    for (const format of ['plain', 'singbox', 'json', 'amneziavpn']) {
      const res = await get(`/sub/${s.subscriptionToken}?format=${format}&protocols=tuic`);
      expect(res.statusCode, format).toBe(404);
      expect(JSON.parse(res.body)).toMatchObject({
        error: 'SUBSCRIPTION_PROTOCOL_EMPTY',
        protocols: ['tuic'],
        available: ['hysteria', 'xray', 'shadowsocks'],
      });
    }
  });

  it('leaves every existing contract alone without the parameter', async () => {
    const s = await subscriber();
    await prisma.profileNodeBinding.deleteMany({});
    const plain = await get(`/sub/${s.subscriptionToken}`);
    expect(plain.statusCode).toBe(200);
    expect(Buffer.from(plain.body, 'base64').toString('utf8')).toBe('');
    const wg = await get(`/sub/${s.subscriptionToken}?format=wgconf`);
    expect(wg.statusCode).toBe(200);
    expect(wg.body).toBe('');
  });

  it('one narrowed request does not narrow the next one (the cache holds the whole subscription)', async () => {
    const s = await subscriber();
    const narrowed = text('plain', (await get(`/sub/${s.subscriptionToken}?protocols=xray`)).body);
    expect(narrowed).not.toContain('hysteria2://');
    const whole = text('plain', (await get(`/sub/${s.subscriptionToken}`)).body);
    expect(whole).toContain('hysteria2://');
    expect(whole).toContain('vless://');
    const again = text('plain', (await get(`/sub/${s.subscriptionToken}?protocols=hysteria`)).body);
    expect(again).not.toContain('vless://');
  });

  it('puts a cascade line with the protocol of its entry', async () => {
    const s = await subscriber();
    const nl = await post('/api/nodes', { name: 'nl-1', address: '10.0.0.2:8443' });
    await prisma.node.update({ where: { id: nl }, data: { countryCode: 'NL' } });
    const c = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: {
        name: 'ru',
        enabled: true,
        positions: [{ position: 0, nodeIds: [s.node], entryProtocol: 'xray', linkProtocol: 'vless' }],
        directions: [{ nodeIds: [nl] }],
      },
    });
    expect(c.statusCode, c.body).toBe(201);
    const decode = async (q: string) =>
      text('plain', (await get(`/sub/${s.subscriptionToken}?protocols=${q}`)).body)
        .split('\n')
        .filter(Boolean)
        .map((l) => decodeURIComponent(l));
    const xray = await decode('xray');
    expect(xray.some((l) => l.includes('ru → NL'))).toBe(true);
    expect(xray.every((l) => l.startsWith('vless://'))).toBe(true);
    const hy = await decode('hysteria');
    expect(hy.some((l) => l.includes('→'))).toBe(false);
  });

  it('the page offers the switcher, carries the narrowing in its link, and says when it leaves nothing', async () => {
    const s = await subscriber();
    const html = (q: string) => get(`/sub/${s.subscriptionToken}${q}`, { accept: 'text/html' });
    const page = await html('?protocols=xray');
    expect(page.statusCode).toBe(200);
    const doc = new JSDOM(page.body).window.document;
    expect(doc.querySelector('[data-proto-switch]')).not.toBeNull();
    expect((doc.getElementById('url') as HTMLInputElement).value).toMatch(/\?protocols=xray$/);
    expect(doc.querySelector('[data-proto="xray"]')?.classList.contains('is-on')).toBe(true);
    expect(doc.querySelector('[data-proto=""]')?.classList.contains('is-on')).toBe(false);
    // The chips are what this person HAS, not what the link narrows to.
    expect([...doc.querySelectorAll('[data-proto]')].map((c) => c.getAttribute('data-proto'))).toEqual([
      '',
      'hysteria',
      'xray',
      'shadowsocks',
    ]);

    const empty = new JSDOM((await html('?protocols=tuic')).body).window.document;
    expect(empty.querySelector('[data-proto-empty]')?.textContent).toContain('no hosts of tuic');
  });
});

// ───── the page's switcher, run in jsdom ─────

describe('the switcher rewrites the links in place', () => {
  const BASE = 'https://panel.example.com/sub/abc123';

  function page(overrides: Partial<SubscriptionPageData> = {}) {
    const html = buildSubscriptionPage({
      brandTitle: 'Iceslab',
      lang: 'en',
      subUrl: BASE,
      supportUrl: null,
      user: { username: 'adm', status: 'active', expireAt: null, trafficLimitBytes: null, trafficUsedBytes: 0 },
      protocols: ['hysteria', 'xray'],
      protocolSwitch: { available: ['hysteria', 'xray'], selected: [] },
      carriedFormats: ['plain', 'clash', 'singbox'],
      ...overrides,
    });
    const dom = new JSDOM(html, {
      url: `${BASE}?lang=en`,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    });
    return dom.window;
  }

  const click = (el: Element | null) => {
    expect(el).not.toBeNull();
    el!.dispatchEvent(new el!.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  };

  /** Every place the page carries the subscription link, as it stands now. */
  function carried(doc: Document) {
    const attrs = [...doc.querySelectorAll('[href],[data-app-add],[data-copy-config],[data-qr-text]')].flatMap((el) =>
      ['href', 'data-app-add', 'data-copy-config', 'data-qr-text'].map((a) => el.getAttribute(a) ?? ''),
    );
    return {
      input: (doc.getElementById('url') as HTMLInputElement).value,
      qr: doc.querySelector('.qr-plate [data-qr-text]')?.getAttribute('data-qr-text') ?? '',
      box: doc.querySelector('.link-box__value')?.textContent ?? '',
      raw: attrs.filter((v) => v.includes(BASE.replace('https://', ''))),
      enc: attrs.filter((v) => v.includes(encodeURIComponent(BASE.replace('https://', '')))),
      lang: [...doc.querySelectorAll('.lng')].map((a) => a.getAttribute('href')),
    };
  }

  it('one chip: the link, its code, the Add buttons, the downloads and the page address all narrow', () => {
    const win = page();
    const doc = win.document;
    expect(carried(doc).raw.length + carried(doc).enc.length).toBeGreaterThan(0);

    click(doc.querySelector('[data-proto="xray"]'));

    const want = `${BASE}?protocols=xray`;
    const c = carried(doc);
    expect(c.input).toBe(want);
    expect(c.qr).toBe(want);
    expect(c.box).toBe(want);
    for (const v of c.raw) {
      // Raw: the link itself, or inside a deep link; a download keeps its own
      // parameters after the narrowing.
      expect(v, v).toMatch(/panel\.example\.com\/sub\/abc123\?protocols=xray(&|$|#|\s)/);
    }
    for (const v of c.enc) {
      expect(decodeURIComponent(v), v).toContain(want);
    }
    expect(c.lang).toEqual(['?protocols=xray&lang=ru', '?protocols=xray&lang=en']);
    expect(win.location.href).toBe(`${BASE}?protocols=xray&lang=en`);
    expect(doc.querySelector('[data-proto="xray"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(doc.querySelector('[data-proto=""]')!.classList.contains('is-on')).toBe(false);
  });

  it('every protocol picked is the same as all, and says it the short way; "all" takes the narrowing off', () => {
    const doc = page().document;
    click(doc.querySelector('[data-proto="xray"]'));
    click(doc.querySelector('[data-proto="hysteria"]'));
    expect(carried(doc).input).toBe(BASE);
    expect(doc.querySelector('[data-proto=""]')!.classList.contains('is-on')).toBe(true);

    click(doc.querySelector('[data-proto="hysteria"]'));
    expect(carried(doc).input).toBe(`${BASE}?protocols=hysteria`);
    click(doc.querySelector('[data-proto=""]'));
    const c = carried(doc);
    expect(c.input).toBe(BASE);
    for (const v of [...c.raw, ...c.enc.map(decodeURIComponent)]) expect(v).not.toContain('protocols=');
  });

  it('starts from the narrowing the page was opened with', () => {
    const doc = page({
      subUrl: `${BASE}?protocols=xray`,
      protocols: ['xray'],
      protocolSwitch: { available: ['hysteria', 'xray'], selected: ['xray'] },
    }).document;
    expect(doc.querySelector('[data-proto="xray"]')!.classList.contains('is-on')).toBe(true);
    click(doc.querySelector('[data-proto="hysteria"]'));
    // xray and hysteria, which is everything: back to the plain link.
    expect(carried(doc).input).toBe(BASE);
  });

  it('is not there with one protocol and no narrowing', () => {
    const doc = page({ protocols: ['xray'], protocolSwitch: { available: ['xray'], selected: [] } }).document;
    expect(doc.querySelector('[data-proto-switch]')).toBeNull();
    expect(doc.querySelector('.proto')?.textContent).toBe('xray');
  });
});
