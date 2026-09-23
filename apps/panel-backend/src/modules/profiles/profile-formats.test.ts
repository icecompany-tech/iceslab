import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FORMAT_NAMES } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { clientSecurityLayer, profileFormats } from './profile-formats.js';

/**
 * GET /api/profiles/:id/formats: which formats carry this profile's door.
 *
 * The same table the subscription gate reads (FORMAT_DOORS through
 * formatCarries), answered for one profile and, on the host screen, for one
 * host's security override. The door-by-door proof that the table and the files
 * agree lives beside the builders (format-doors.test.ts); this pins the
 * profile-level reading of it.
 */

const byFormat = (r: ReturnType<typeof profileFormats>) =>
  Object.fromEntries(r.formats.map((f) => [f.format, f]));

describe('profileFormats', () => {
  it('answers every format once, in the shared order', () => {
    const r = profileFormats('xray', { security: 'reality', subprotocol: 'vless' });
    expect(r.formats.map((f) => f.format)).toEqual([...FORMAT_NAMES]);
  });

  it('reads the door off the xray subprotocol, vless when there is none', () => {
    expect(profileFormats('xray', { security: 'reality' }).door).toBe('vless');
    expect(profileFormats('xray', { subprotocol: 'socks', security: 'none' }).door).toBe('socks');
    expect(profileFormats('hysteria', {}).door).toBe('hysteria');
  });

  it('keeps a REALITY trojan out of Surge, and lets a TLS host put it back', () => {
    const cfg = { security: 'reality', subprotocol: 'trojan' };
    expect(byFormat(profileFormats('xray', cfg)).surge).toEqual({
      format: 'surge',
      carried: false,
      why: 'client-lacks-protocol',
    });
    expect(byFormat(profileFormats('xray', cfg, 'tls')).surge!.carried).toBe(true);
  });

  it('says why a socks door is missing from Surge and from AmneziaWG files', () => {
    const f = byFormat(profileFormats('xray', { subprotocol: 'socks', security: 'none' }));
    expect(f.surge!.why).toBe('not-yet');
    expect(f.wgconf!.why).toBe('client-lacks-protocol');
    expect(f.clash).toMatchObject({ carried: true, why: 'native' });
  });

  it('has no plain link for AmneziaWG', () => {
    const f = byFormat(profileFormats('amneziawg', {}));
    expect(f.plain!.why).toBe('no-uri-standard');
    expect(f.wgconf!.carried).toBe(true);
  });

  it('works out the client security layer the way the subscription does', () => {
    expect(clientSecurityLayer({ security: 'reality' })).toBe('default');
    expect(clientSecurityLayer({ security: 'tls' })).toBe('tls');
    expect(clientSecurityLayer({ security: 'reality' }, 'none')).toBe('none');
    expect(clientSecurityLayer({ security: 'reality' }, 'default')).toBe('default');
    // vmess never rides REALITY: the service hands it out as none.
    expect(clientSecurityLayer({ security: 'reality', subprotocol: 'vmess' })).toBe('none');
  });
});

describe('GET /api/profiles/:id/formats', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildApp();
    await cleanDatabase();
    token = await registerAndLogin(app);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await closeRedis();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  async function makeTrojanReality(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: auth(),
      payload: {
        name: 'formats-trojan',
        protocol: 'xray',
        config: {
          security: 'reality',
          realityDest: 'www.microsoft.com:443',
          realityServerNames: ['www.microsoft.com'],
          realityPrivateKey: 'k'.repeat(43),
          realityPublicKey: 'p'.repeat(43),
          realityShortIds: ['0123abcd'],
          network: 'raw',
          subprotocol: 'trojan',
        },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return JSON.parse(res.body).id as string;
  }

  it('answers { door, formats } for the profile, and for a host override', async () => {
    const id = await makeTrojanReality();
    const plain = await app.inject({ method: 'GET', url: `/api/profiles/${id}/formats`, headers: auth() });
    expect(plain.statusCode, plain.body).toBe(200);
    const body = JSON.parse(plain.body) as ReturnType<typeof profileFormats>;
    expect(body.door).toBe('trojan');
    expect(body.formats).toHaveLength(FORMAT_NAMES.length);
    expect(byFormat(body).surge).toMatchObject({ carried: false, why: 'client-lacks-protocol' });

    const tls = await app.inject({
      method: 'GET',
      url: `/api/profiles/${id}/formats?securityLayer=tls`,
      headers: auth(),
    });
    expect(byFormat(JSON.parse(tls.body)).surge).toMatchObject({ carried: true, why: 'native' });
  });

  it('404 for a profile that does not exist, 400 for a layer that does not', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: '/api/profiles/00000000-0000-4000-8000-000000000000/formats',
      headers: auth(),
    });
    expect(missing.statusCode).toBe(404);
    const id = await makeTrojanReality();
    const bad = await app.inject({
      method: 'GET',
      url: `/api/profiles/${id}/formats?securityLayer=quic`,
      headers: auth(),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('asks for a login', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/profiles/00000000-0000-4000-8000-000000000000/formats',
    });
    expect(res.statusCode).toBe(401);
  });
});
