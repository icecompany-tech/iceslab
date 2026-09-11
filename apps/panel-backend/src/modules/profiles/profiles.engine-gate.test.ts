import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { observedCores } from '../nodes/nodes.cron.js';
import { applyInboundsRequestForNode } from '../inbounds/inbounds.queue.js';

/**
 * Deploying a profile to a node whose cores cannot serve it.
 *
 * The push does not fail: applyInbounds finds no adapter for the
 * (protocol, engine) pair, logs a line and answers 200 with `skipped`. So the
 * panel shows the profile deployed, the subscription keeps handing out the
 * endpoint, and nobody is listening on it. The only honest place to say no is
 * the save.
 *
 * Two rules the tests below pin, and they are not the same rule:
 *   - the GATE answers at click time, from the reported cores when the node has
 *     reported and from how it was installed when it has not;
 *   - the FLAG on an existing binding only ever speaks from the report, and
 *     stays absent otherwise. Absent is not false.
 */
let app: FastifyInstance;
let token: string;
let seq = 0;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
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

const auth = () => ({ authorization: `Bearer ${token}` });

const XRAY_CONFIG = {
  security: 'reality',
  realityDest: 'www.microsoft.com:443',
  realityServerNames: ['www.microsoft.com'],
  realityPrivateKey: 'k'.repeat(43),
  realityPublicKey: 'p'.repeat(43),
  realityShortIds: ['0123abcd'],
  network: 'raw',
};

async function makeNode(over: Record<string, unknown> = {}) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name: `gate-node-${seq}`, address: `gate-${seq}.test`, protocol: 'xray', ...over },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body);
}

async function makeProfile(protocol: string, config: unknown, engine?: string) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: { name: `gate-profile-${seq}`, protocol, config, ...(engine ? { engine } : {}) },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body);
}

async function bind(profileId: string, nodeId: string, port: number, expected = 201) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId, nodeId, port },
  });
  expect(res.statusCode, res.body).toBe(expected);
  return JSON.parse(res.body);
}

/** Pretend the agent checked in and listed these engines. */
async function reportCores(nodeId: string, cores: { name: string; engine: string }[]) {
  await prisma.node.update({
    where: { id: nodeId },
    data: {
      cores: observedCores(
        cores.map((c) => ({ name: c.name as never, engine: c.engine as never, running: true })),
        new Date().toISOString(),
      ) as unknown as object,
    },
  });
}

describe('the gate on deploying a profile', () => {
  it('says nothing at all about a node that has never reported', async () => {
    // The deliberate quiet state, and the reason the gate is safe to ship now.
    // The only other thing to judge an unreported node by is `Node.protocol`,
    // and that is a LABEL for which adapter is primary, not a list of what the
    // node serves: the schema says "the actual deployment is per-binding", and
    // a node labelled one way routinely carries profiles of another. A first
    // version of this gate fell back to that label and refused 23 pairs this
    // very suite builds on purpose.
    const node = await makeNode({ protocol: 'hysteria' });
    const profile = await makeProfile('xray', XRAY_CONFIG);
    await bind(profile.id, node.id, 443);
  });

  it('refuses a profile whose core the node REPORTED it does not run', async () => {
    const node = await makeNode({ protocol: 'hysteria' });
    await reportCores(node.id, [{ name: 'hysteria', engine: 'hysteria' }]);
    const profile = await makeProfile('xray', XRAY_CONFIG);
    const body = await bind(profile.id, node.id, 443, 409);
    expect(body.error).toBe('PROFILE_DOES_NOT_RUN_ON_NODE');
    // The message names the core wanted and what the node has, or the operator
    // is left to guess which half is wrong.
    expect(body.message).toContain('xray');
    expect(body.message).toContain('hysteria');
  });

  it('believes the node over its own label', async () => {
    // Labelled hysteria, actually running xray beside it. Refusing here would
    // block a pair the node demonstrably serves.
    const node = await makeNode({ protocol: 'hysteria' });
    await reportCores(node.id, [
      { name: 'hysteria', engine: 'hysteria' },
      { name: 'xray', engine: 'xray' },
    ]);
    const profile = await makeProfile('xray', XRAY_CONFIG);
    await bind(profile.id, node.id, 443);
  });

  it('knows shadowsocks rides on xray', async () => {
    // The native core of a protocol is not always its own name, and getting
    // this wrong would refuse a pair that works today.
    const node = await makeNode({ protocol: 'xray' });
    await reportCores(node.id, [{ name: 'xray', engine: 'xray' }]);
    const profile = await makeProfile('shadowsocks', { method: '2022-blake3-aes-256-gcm' });
    await bind(profile.id, node.id, 443);
  });

  it('knows a single-core protocol is its own engine', async () => {
    // amneziawg, naive, mieru and mtproto have no engine to choose. Reading
    // them as xray (the tempting default) would refuse every AmneziaWG
    // deployment on an AmneziaWG node.
    const node = await makeNode({ protocol: 'amneziawg' });
    await reportCores(node.id, [{ name: 'amneziawg', engine: 'amneziawg' }]);
    const profile = await makeProfile('amneziawg', {
      serverPrivateKey: 'a'.repeat(44),
      serverPublicKey: 'b'.repeat(44),
      subnet: '10.66.66.0/24',
      obfuscation: {},
    });
    await bind(profile.id, node.id, 51820);
  });

  it('sorts sing-box protocols by the engine the node reports', async () => {
    const withEngine = await makeNode({ protocol: 'xray', singboxEngine: true });
    await reportCores(withEngine.id, [
      { name: 'xray', engine: 'xray' },
      { name: 'tuic', engine: 'singbox' },
    ]);
    const without = await makeNode({ protocol: 'xray' });
    await reportCores(without.id, [{ name: 'xray', engine: 'xray' }]);
    const tuic = await makeProfile('tuic', {});

    await bind(tuic.id, withEngine.id, 443);
    const refused = await bind(tuic.id, without.id, 8443, 409);
    expect(refused.error).toBe('PROFILE_DOES_NOT_RUN_ON_NODE');
  });

  it('answers in machine form beside the prose', async () => {
    // The panel is bilingual and this sentence is English. Nothing reads these
    // yet; they are here so the sentence can be rebuilt in the operator's
    // language later without changing the contract.
    const node = await makeNode({ protocol: 'hysteria' });
    await reportCores(node.id, [{ name: 'hysteria', engine: 'hysteria' }]);
    const profile = await makeProfile('xray', XRAY_CONFIG);
    const body = await bind(profile.id, node.id, 443, 409);

    expect(body.nodeName).toBe(node.name);
    expect(body.neededEngine).toBe('xray');
    expect(body.reportedEngines).toEqual(['hysteria']);
    expect(body.canWait).toBe(false);
    // The prose is built FROM these, so it cannot say something else.
    expect(body.message).toContain(node.name);
    expect(body.message).toContain('xray');
  });

  it('reports an empty list when the node runs nothing, never a missing field', async () => {
    // `reportedEngines` is always an array: this refusal is only reachable
    // after a node has reported, because one that never checked in is let
    // through. So [] means "reported, runs nothing", not "unknown".
    const node = await makeNode({ protocol: 'xray' });
    await reportCores(node.id, []);
    const profile = await makeProfile('xray', XRAY_CONFIG);
    const body = await bind(profile.id, node.id, 443, 409);

    expect(body.reportedEngines).toEqual([]);
    expect(body.message).toContain('no core at all');
  });

  it('says "not yet" rather than "no" when the core was only just switched on', async () => {
    // The narrow edge: sing-box is enabled on a node that has already reported,
    // and between that click and the next poll the report still says what it
    // said before. The pair is legitimate and the refusal is only early.
    // Falling back to intent to avoid refusing is what was measured as wrong,
    // so the difference lives in the message.
    const node = await makeNode({ protocol: 'xray', singboxEngine: true });
    await reportCores(node.id, [{ name: 'xray', engine: 'xray' }]);
    const tuic = await makeProfile('tuic', {});

    const body = await bind(tuic.id, node.id, 443, 409);
    expect(body.message).toContain('has not reported it yet');
    expect(body.message).toContain('wait for the next status poll');
  });

  it('does not say "not yet" when the node is not set up for that core at all', async () => {
    // The other half: here it really is "no", and offering to wait would send
    // the operator to stare at a poll that is never going to change anything.
    const node = await makeNode({ protocol: 'xray' });
    await reportCores(node.id, [{ name: 'xray', engine: 'xray' }]);
    const tuic = await makeProfile('tuic', {});

    const body = await bind(tuic.id, node.id, 443, 409);
    expect(body.message).not.toContain('wait for the next status poll');
  });

  it('refuses an engine switch that would strand the profile on its nodes', async () => {
    // The pair changes on every node at once, so the same question is asked per
    // node. Editing an inbound out from under its own deployment is how a
    // profile ends up serving nowhere.
    const node = await makeNode({ protocol: 'xray' });
    const profile = await makeProfile('xray', XRAY_CONFIG);
    await bind(profile.id, node.id, 443);
    await reportCores(node.id, [{ name: 'xray', engine: 'xray' }]);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${profile.id}`,
      headers: auth(),
      payload: { engine: 'singbox' },
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body).error).toBe('PROFILE_DOES_NOT_RUN_ON_NODE');
  });
});

describe('the flag on an existing binding', () => {
  it('is absent while the node has never reported', async () => {
    // NOT false. Saying "this will not come up" about a node that may well be
    // running the core is the lie the panel used to tell about the policy.
    const node = await makeNode({ protocol: 'xray' });
    const profile = await makeProfile('xray', XRAY_CONFIG);
    await bind(profile.id, node.id, 443);

    const res = await app.inject({
      method: 'GET',
      url: `/api/bindings?nodeId=${node.id}`,
      headers: auth(),
    });
    const [b] = JSON.parse(res.body).bindings;
    expect('rendersProfile' in b).toBe(false);
  });

  it('turns true or false once the node reports', async () => {
    const node = await makeNode({ protocol: 'xray' });
    const profile = await makeProfile('xray', XRAY_CONFIG);
    await bind(profile.id, node.id, 443);

    await reportCores(node.id, [{ name: 'xray', engine: 'xray' }]);
    let res = await app.inject({
      method: 'GET',
      url: `/api/bindings?nodeId=${node.id}`,
      headers: auth(),
    });
    expect(JSON.parse(res.body).bindings[0].rendersProfile).toBe(true);

    // The day the fleet reports something else, existing bindings go false.
    await reportCores(node.id, [{ name: 'hysteria', engine: 'hysteria' }]);
    res = await app.inject({
      method: 'GET',
      url: `/api/bindings?nodeId=${node.id}`,
      headers: auth(),
    });
    expect(JSON.parse(res.body).bindings[0].rendersProfile).toBe(false);
  });

  it('NEVER keeps the inbound out of the push', async () => {
    // The whole point of the flag being a flag. On the day the fleet starts
    // reporting cores a batch of bindings turns false at once; if anything on
    // the push path read this, that upgrade would take those nodes down and it
    // would look like the agent broke them.
    const node = await makeNode({ protocol: 'xray' });
    const profile = await makeProfile('xray', XRAY_CONFIG);
    await bind(profile.id, node.id, 443);
    await reportCores(node.id, [{ name: 'hysteria', engine: 'hysteria' }]);

    const req = await applyInboundsRequestForNode(node.id);
    expect(req?.inbounds).toHaveLength(1);
    expect(req?.inbounds[0]!.protocol).toBe('xray');
  });
});

describe('the node DTO', () => {
  it('lists the engines it reported, and nothing before that', async () => {
    const node = await makeNode({ protocol: 'xray', singboxEngine: true });
    let res = await app.inject({
      method: 'GET',
      url: `/api/nodes/${node.id}`,
      headers: auth(),
    });
    // Absent, not an empty list and not the intent: the intent is what the
    // installer was told, and it is already on the node as protocol +
    // singboxEngine.
    expect('engines' in JSON.parse(res.body)).toBe(false);

    await reportCores(node.id, [
      { name: 'xray', engine: 'xray' },
      { name: 'tuic', engine: 'singbox' },
      { name: 'anytls', engine: 'singbox' },
    ]);
    res = await app.inject({ method: 'GET', url: `/api/nodes/${node.id}`, headers: auth() });
    // Distinct: two sing-box protocols are one engine.
    expect(JSON.parse(res.body).engines.sort()).toEqual(['singbox', 'xray']);
  });
});
