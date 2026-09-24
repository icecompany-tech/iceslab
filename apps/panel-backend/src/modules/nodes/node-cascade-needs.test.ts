import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { cascadeNeedsByNode } from './node-cascade-needs.js';

/**
 * cascadeNeedsEngines: which cores a node must keep for the cascades it stands
 * in, the third fact that keeps a core from being removed (core-lifecycle.md
 * section 8). Built from the tables on purpose: the positions, directions,
 * tunnels and legacy hops are four tables that have to agree.
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

async function node(name: string): Promise<string> {
  const n = await prisma.node.create({
    data: { name, address: `${name}.example.com:1337`, protocol: 'xray', heartbeatSecret: randomBytes(32) },
    select: { id: true },
  });
  return n.id;
}

/** A v4 cascade: one entry, one direction, the entry's protocol given. */
async function v4(name: string, entry: string, exit: string, entryProtocol: string, enabled = true) {
  const c = await prisma.cascade.create({ data: { name, enabled, mode: 'chain' }, select: { id: true } });
  await prisma.cascadePosition.create({
    data: { cascadeId: c.id, position: 0, entryProtocol, nodes: { create: [{ nodeId: entry }] } },
  });
  await prisma.cascadeDirection.create({ data: { cascadeId: c.id, tag: 1, nodes: { create: [{ nodeId: exit }] } } });
  return c.id;
}

const engines = (needs: { engine: string }[] | undefined) => (needs ?? []).map((n) => n.engine);

describe('what the cascades need from a node', () => {
  it('an xray entry: xray for its users, sing-box for the chain; the exit: sing-box', async () => {
    const entry = await node('ru-01');
    const exit = await node('se-01');
    const id = await v4('ru', entry, exit, 'xray');
    const needs = await cascadeNeedsByNode([entry, exit]);
    expect(engines(needs.get(entry))).toEqual(['xray', 'singbox']);
    expect(engines(needs.get(exit))).toEqual(['singbox']);
    expect(needs.get(entry)![0]!.cascades).toEqual([{ id, name: 'ru', enabled: true }]);
  });

  it('a hysteria entry needs hysteria, not xray', async () => {
    const entry = await node('ru-01');
    const exit = await node('se-01');
    await v4('ru', entry, exit, 'hysteria');
    expect(engines((await cascadeNeedsByNode([entry])).get(entry))).toEqual(['hysteria', 'singbox']);
  });

  it('a leg in an AWG tunnel needs amneziawg at both ends', async () => {
    const entry = await node('ru-01');
    const exit = await node('se-01');
    const id = await v4('ru', entry, exit, 'xray');
    await prisma.cascadeTunnel.create({
      data: { cascadeId: id, fromNodeId: entry, toNodeId: exit, index: 0, port: 27000, config: {} },
    });
    const needs = await cascadeNeedsByNode([entry, exit]);
    // In ENGINE_NAMES order, so two reads of one node compare.
    expect(engines(needs.get(entry))).toEqual(['xray', 'singbox', 'amneziawg']);
    expect(engines(needs.get(exit))).toEqual(['singbox', 'amneziawg']);
  });

  it('every hop of a cascade from before the topology tables needs xray', async () => {
    const a = await node('ru-01');
    const b = await node('nl-01');
    const c = await prisma.cascade.create({ data: { name: 'old', enabled: true, mode: 'chain' }, select: { id: true } });
    await prisma.cascadeHop.createMany({
      data: [
        { cascadeId: c.id, nodeId: a, position: 0, entryProtocol: 'xray' },
        { cascadeId: c.id, nodeId: b, position: 1 },
      ],
    });
    const needs = await cascadeNeedsByNode([a, b]);
    expect(engines(needs.get(a))).toEqual(['xray']);
    expect(engines(needs.get(b))).toEqual(['xray']);
  });

  it('counts a disabled cascade, marked, and names every cascade once per core', async () => {
    const entry = await node('ru-01');
    const exit = await node('se-01');
    const exit2 = await node('nl-01');
    await v4('b-on', entry, exit, 'xray');
    await v4('a-off', entry, exit2, 'xray', false);
    const singbox = (await cascadeNeedsByNode([entry])).get(entry)!.find((n) => n.engine === 'singbox')!;
    expect(singbox.cascades.map((c) => [c.name, c.enabled])).toEqual([
      ['a-off', false],
      ['b-on', true],
    ]);
  });

  it('reaches the node DTO: empty outside every cascade, filled inside, on the list and by id', async () => {
    const entry = await node('ru-01');
    const exit = await node('se-01');
    const lonely = await node('de-01');
    await v4('ru', entry, exit, 'xray');
    const auth = { authorization: `Bearer ${token}` };

    const byId = JSON.parse((await app.inject({ method: 'GET', url: `/api/nodes/${entry}`, headers: auth })).body);
    expect(engines(byId.cascadeNeedsEngines)).toEqual(['xray', 'singbox']);
    const alone = JSON.parse((await app.inject({ method: 'GET', url: `/api/nodes/${lonely}`, headers: auth })).body);
    expect(alone.cascadeNeedsEngines).toEqual([]);

    const list = JSON.parse((await app.inject({ method: 'GET', url: '/api/nodes', headers: auth })).body);
    const row = (list.nodes as { id: string; cascadeNeedsEngines: { engine: string }[] }[]).find((n) => n.id === exit)!;
    expect(engines(row.cascadeNeedsEngines)).toEqual(['singbox']);
  });
});
