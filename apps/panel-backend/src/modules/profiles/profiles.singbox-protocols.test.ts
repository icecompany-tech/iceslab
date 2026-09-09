import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { fetchEnabledInbounds } from '../inbounds/inbounds.queue.js';

/**
 * TUIC, AnyTLS and ShadowTLS reach a node.
 *
 * Everything about these three existed - the sing-box adapter, the inbound
 * config schemas, credential fan-out, share links, and a profile form that
 * offers all three - except the front door: `ProtocolEnum` listed seven
 * protocols, so `POST /api/profiles` refused to save them. Deployment goes only
 * through Profile -> ProfileNodeBinding, so an operator could not use them and
 * a field test was impossible (audit A-029).
 *
 * The test therefore walks the whole way rather than asserting the enum: create
 * the profile, bind it to a node, and read the very inbound set the node is
 * handed.
 */
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

async function post(url: string, payload: unknown, expected = 201) {
  const res = await app.inject({ method: 'POST', url, headers: auth(), payload });
  expect(res.statusCode, `${url} -> ${res.body}`).toBe(expected);
  return JSON.parse(res.body);
}

/** What the profile form sends for each of the three. */
const CONFIGS: Record<string, Record<string, unknown>> = {
  tuic: { serverName: 'www.bing.com', congestionControl: 'bbr' },
  anytls: { serverName: 'www.bing.com' },
  shadowtls: { handshake: 'www.microsoft.com', ssMethod: '2022-blake3-aes-128-gcm' },
};

async function deploy(protocol: string, port: number) {
  const profile = await post('/api/profiles', {
    name: `${protocol}-profile`,
    protocol,
    engine: 'singbox',
    config: CONFIGS[protocol],
  });
  const node = await post('/api/nodes', {
    name: `${protocol}-node`,
    address: `${protocol}.example.com`,
    protocol: 'xray',
  });
  await post('/api/bindings', { profileId: profile.id, nodeId: node.id, port });
  const inbounds = await fetchEnabledInbounds(node.id);
  return { profile, node, inbounds };
}

describe('the sing-box protocol trio', () => {
  it.each(['tuic', 'anytls', 'shadowtls'])('saves a %s profile and hands it to the node', async (protocol) => {
    const { inbounds } = await deploy(protocol, 8443);
    expect(inbounds).toHaveLength(1);
    expect(inbounds[0]!.protocol).toBe(protocol);
    // The core that actually speaks them. A null engine here would send the
    // inbound to a native adapter that does not exist for these three.
    expect(inbounds[0]!.engine).toBe('singbox');
    expect(inbounds[0]!.port).toBe(8443);
  });

  it('accepts the engine the form sends instead of calling it invalid', async () => {
    // ENGINE_OPTIONS is what makes `engine: 'singbox'` a legal answer. Without
    // an entry the protocol saves only with a null engine, and the form's own
    // payload comes back rejected with a message about the engine - which reads
    // as "this protocol is broken", not "say it differently".
    for (const protocol of ['tuic', 'anytls', 'shadowtls']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/profiles',
        headers: auth(),
        payload: { name: `${protocol}-engine`, protocol, engine: 'singbox', config: CONFIGS[protocol] },
      });
      expect(res.statusCode, `${protocol} -> ${res.body}`).toBe(201);
    }
  });

  it('still refuses an engine that cannot serve the protocol', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: auth(),
      payload: { name: 'tuic-on-xray', protocol: 'tuic', engine: 'xray', config: CONFIGS.tuic },
    });
    expect(res.statusCode).toBe(400);
  });

  it('takes a null engine, and the node then has to guess the core', async () => {
    // Recorded rather than asserted as desirable: `engine` is nullish for every
    // protocol, so these three can be stored native. There is no native TUIC
    // adapter, so the answer to "what does the node do" is: nothing good.
    const profile = await post('/api/profiles', {
      name: 'tuic-native',
      protocol: 'tuic',
      config: CONFIGS.tuic,
    });
    expect(profile.engine).toBeNull();
  });
});

describe('the ShadowTLS inner key', () => {
  it('is generated on create, because the node refuses an inbound without it', async () => {
    const { inbounds } = await deploy('shadowtls', 9443);
    const config = inbounds[0]!.config as { ssPassword?: string };
    expect(typeof config.ssPassword).toBe('string');
    expect(config.ssPassword!.length).toBeGreaterThan(0);
  });

  it('survives an edit that does not mention it', async () => {
    // The form has no field for it, so every save from the profile screen omits
    // it. Overwriting would drop the key the node is running and the next push
    // would be refused - an unrelated edit breaking the inbound.
    const { profile } = await deploy('shadowtls', 9444);
    const before = (await prisma.profile.findUniqueOrThrow({ where: { id: profile.id } }))
      .config as { ssPassword: string };

    const res = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${profile.id}`,
      headers: auth(),
      payload: { config: { handshake: 'www.apple.com', ssMethod: '2022-blake3-aes-128-gcm' } },
    });
    expect(res.statusCode, res.body).toBe(200);

    const after = (await prisma.profile.findUniqueOrThrow({ where: { id: profile.id } }))
      .config as { ssPassword: string; handshake: string };
    expect(after.ssPassword).toBe(before.ssPassword);
    expect(after.handshake).toBe('www.apple.com');
  });
});
