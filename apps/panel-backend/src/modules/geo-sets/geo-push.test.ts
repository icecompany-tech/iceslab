import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { ApplyInboundsRequest, GeoFileDto } from '@iceslab/shared';
import { applyInboundsForNode } from '../inbounds/inbounds.queue.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { ROOT, datFile, domain, site } from '../../../tests/helpers/geo-dat.js';
import { NodeRequestError, NodeTransport } from '../nodes/nodes.transport.js';
import { ensureBuiltinSets, ingestGeoFile, sha256Hex } from './geo-sets.store.js';
import { geoVersionOf, layOutGeo, nodeGeoFor } from './geo-push.js';
import { xrayGeoEntry } from './geo-refs.js';

/**
 * Phase 9.2, the panel's half of a push: which files a node stands on, laid
 * out on its agent before the push names them. Files follow the node's pins.
 */
beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

/** An agent: what it holds, what it was sent. `null` holdings = older than geo. */
function agent(holds: Record<string, string> | null) {
  const put: { name: string; sha256: string; size: number }[] = [];
  const t = {
    async listAssets() {
      if (holds === null) throw new NodeRequestError('404', 404, null);
      return { files: Object.entries(holds).map(([name, sha256]) => ({ name, sha256, size: 0 })) };
    },
    async putAsset(name: string, bytes: Uint8Array, sha256: string): Promise<GeoFileDto> {
      put.push({ name, sha256, size: bytes.length });
      return { name, sha256, size: bytes.length };
    },
  };
  return { transport: t as unknown as NodeTransport, put };
}

const v1 = datFile(site('ADS', domain(ROOT, 'a.com')));
const v2 = datFile(site('ADS', domain(ROOT, 'a.com'), domain(ROOT, 'b.com')));

async function mine(bytes = v1) {
  const s = await prisma.geoSet.create({ data: { name: 'mine', kind: 'geosite', sourceType: 'upload' }, select: { id: true } });
  await ingestGeoFile(s.id, { bytes });
  return s.id;
}

async function nodeWithPolicy(domains: string[]) {
  const p = await prisma.nodePolicy.create({
    data: { name: 'p', rules: { create: [{ position: 0, matchDomain: domains, matchIp: [], matchProtocol: [], actionKind: 'block' }] } },
    select: { id: true },
  });
  const n = await prisma.node.create({
    data: { name: 'ru-01', address: 'ru-01.example.com:1337', protocol: 'xray', heartbeatSecret: randomBytes(32), policyId: p.id },
    select: { id: true },
  });
  return n.id;
}

describe('laying the files out', () => {
  it('an agent older than geo gets no geo, and nothing is sent to it', async () => {
    await mine();
    const node = await nodeWithPolicy(['ext:mine:ads']);
    const a = agent(null);
    expect(await layOutGeo(a.transport, node)).toBeUndefined();
    expect(a.put).toEqual([]);
  });

  it('sends what the agent lacks, names it, and pins the node on its first push', async () => {
    const setId = await mine();
    const node = await nodeWithPolicy(['ext:mine:ads']);
    const a = agent({});
    const geo = await layOutGeo(a.transport, node);
    const file = { name: 'iceslab-mine.dat', sha256: sha256Hex(v1), size: v1.length, reader: 'xray' };
    expect(geo).toEqual({ version: geoVersionOf([file]), files: [file] });
    expect(a.put).toEqual([{ name: 'iceslab-mine.dat', sha256: sha256Hex(v1), size: v1.length }]);
    const pin = await prisma.nodeGeoPin.findUniqueOrThrow({
      where: { nodeId_geoSetId: { nodeId: node, geoSetId: setId } },
      select: { version: { select: { sha256: true } } },
    });
    expect(pin.version.sha256).toBe(sha256Hex(v1));
  });

  it('does not send a file the agent already holds with that sha256', async () => {
    await mine();
    const node = await nodeWithPolicy(['ext:mine:ads']);
    const a = agent({ 'iceslab-mine.dat': sha256Hex(v1) });
    const geo = await layOutGeo(a.transport, node);
    expect(a.put).toEqual([]);
    expect(geo!.files.map((f) => f.name)).toEqual(['iceslab-mine.dat']);
  });

  it('follows the pin, not the newer current: an unrelated push moves no list', async () => {
    const setId = await mine();
    const node = await nodeWithPolicy(['ext:mine:ads']);
    await layOutGeo(agent({}).transport, node);
    await ingestGeoFile(setId, { bytes: v2 });

    const a = agent({ 'iceslab-mine.dat': sha256Hex(v1) });
    const geo = await layOutGeo(a.transport, node);
    expect(geo!.files[0]!.sha256).toBe(sha256Hex(v1));
    expect(a.put).toEqual([]);
    // What the card compares against says the same.
    expect((await nodeGeoFor(node, { pinMissing: false }))!.files[0]!.setVersion).toBe(sha256Hex(v1).slice(0, 12));
  });

  it('a node whose rules name nothing gets an empty geo, which clears what it no longer needs', async () => {
    await mine();
    const node = await nodeWithPolicy(['example.com']);
    const geo = await layOutGeo(agent({ 'iceslab-mine.dat': sha256Hex(v1) }).transport, node);
    expect(geo).toEqual({ version: geoVersionOf([]), files: [] });
    expect(await nodeGeoFor(node, { pinMissing: false })).toBeNull();
  });

  it('the built-in sets go under the names xray looks up; a set with nothing verified is left out', async () => {
    await ensureBuiltinSets(); // both still `checking`, no version
    await mine();
    const node = await nodeWithPolicy(['geosite:category-ads-all', 'ext:mine:ads']);
    const geo = await layOutGeo(agent({}).transport, node);
    expect(geo!.files.map((f) => f.name)).toEqual(['iceslab-mine.dat']);

    const builtin = await prisma.geoSet.findUniqueOrThrow({ where: { name: 'geosite' }, select: { id: true } });
    await ingestGeoFile(builtin.id, { bytes: v1 });
    const again = await layOutGeo(agent({}).transport, node);
    expect(again!.files.map((f) => f.name)).toEqual(['geosite.dat', 'iceslab-mine.dat']);
  });

  it('only the pin is read for the card; nothing is pinned by looking', async () => {
    await mine();
    const node = await nodeWithPolicy(['ext:mine:ads']);
    expect((await nodeGeoFor(node, { pinMissing: false }))!.files).toHaveLength(1);
    expect(await prisma.nodeGeoPin.count()).toBe(0);
  });
});

describe('the push itself', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lays the file out, then names it in the push that follows', async () => {
    await mine();
    const node = await nodeWithPolicy(['ext:mine:ads']);
    const order: string[] = [];
    let sent: ApplyInboundsRequest | null = null;
    vi.spyOn(NodeTransport.prototype, 'listAssets').mockImplementation(async () => {
      order.push('list');
      return { files: [] };
    });
    vi.spyOn(NodeTransport.prototype, 'putAsset').mockImplementation(async (name, bytes, sha256) => {
      order.push(`put ${name}`);
      return { name, sha256, size: bytes.length };
    });
    vi.spyOn(NodeTransport.prototype, 'applyInbounds').mockImplementation(async (req) => {
      order.push('push');
      sent = req;
      return { ok: true, applied: 0, skipped: 0 };
    });
    await applyInboundsForNode(node);
    expect(order).toEqual(['list', 'put iceslab-mine.dat', 'push']);
    expect(sent!.geo!.files.map((f) => f.name)).toEqual(['iceslab-mine.dat']);
  });
});

describe('the spelling xray on the node opens', () => {
  it.each([
    ['ext:mine:ads', 'ext:iceslab-mine.dat:ads'],
    ['ext-domain:mine:ads@cn', 'ext-domain:iceslab-mine.dat:ads@cn'],
    ['ext-ip:mine:!ru', 'ext-ip:iceslab-mine.dat:!ru'],
    ['ext:custom.dat:ads', 'ext:custom.dat:ads'],
    ['geosite:category-ads-all', 'geosite:category-ads-all'],
    ['domain:example.com', 'domain:example.com'],
  ])('%s -> %s, the same as the agent (internal/core/xray/geo.go)', (a, b) => {
    expect(xrayGeoEntry(a)).toBe(b);
  });
});
