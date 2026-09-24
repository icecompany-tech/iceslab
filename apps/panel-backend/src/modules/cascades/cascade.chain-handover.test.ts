import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { autoRouteTag, buildTopologyFragmentsForNode, type TopologyInput } from './cascade.config.js';
import { chainSocksPort } from './chain.ports.js';

/**
 * K3: the entry stops dialling the next hop and hands each direction to the
 * chain process instead.
 *
 * The claim being tested is that no choice a client can make is lost. The
 * client still encodes it in the UUID and xray still surfaces it as
 * `vlessRoute`; what sits at the end of each rule changes, from a leg dialled
 * across the internet to a loopback socks port. Since phase 9.3 the route
 * policies moved too: the entry hands each (direction, profile) over as the
 * profile's socks user (`p<ordinal>`) and the chain process draws the policy,
 * so xray keeps no domain rule of its own. The goldens are taken BEFORE and
 * AFTER from the same topology and the diff between them is read.
 *
 * The topology is the stand's: a POOL OF TWO on the entry step, two directions,
 * one policy. The pool matters twice over, because two entries are two separate
 * xray configs that must offer the subscriber the same ways out and differ only
 * in the address each of them dials.
 */
const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__testdata__');

const XRAY_BIN =
  process.env.XRAY_BIN ?? ['/usr/local/bin/xray', '/usr/bin/xray'].find((p) => existsSync(p)) ?? '';

const RU1 = 'e1111111-1111-1111-1111-111111111111';
const RU2 = 'e2222222-2222-2222-2222-222222222222';
const NL = 'a3333333-3333-3333-3333-333333333333';
const SE = 'b4444444-4444-4444-4444-444444444444';

const CHAIN_PASSWORD = 'chain-socks-fixture-password-0000';

const HOSTS = new Map([
  [RU1, 'ru-01.example.com'],
  [RU2, 'ru-02.example.com'],
  [NL, 'nl-01.example.com'],
  [SE, 'se-01.example.com'],
]);

const leg = (from: string, to: string, directionTag: number) => ({
  fromNodeId: from,
  toNodeId: to,
  directionTag,
  cred: { protocol: 'vless' as const, port: 24000, uuid: `00000000-0000-4000-8000-00000000000${directionTag}` },
});

/** Both entries of the pool dial both directions: same ways out, own address. */
const STAND: TopologyInput = {
  positions: [{ position: 0, nodeIds: [RU1, RU2] }],
  directions: [
    { tag: 1, nodeIds: [NL] },
    { tag: 2, nodeIds: [SE] },
  ],
  links: [leg(RU1, NL, 1), leg(RU1, SE, 2), leg(RU2, NL, 1), leg(RU2, SE, 2)],
  hosts: HOSTS,
  // ⚠ PLAIN DOMAINS, never `geosite:*`, in any fixture that goes to `xray
  // -test`. CI installs the xray BINARY out of the release zip and nothing
  // else, so geosite.dat is not on the runner: xray then refuses the whole
  // config with "failed to open file: geosite.dat" and the failure reads like a
  // broken routing rule. Caught on 2026-09-22, green on a laptop whose xray
  // directory happened to carry the geodata.
  policies: [{ ordinal: 1, directDomains: ['ads.example'], blockDomains: ['tracker.example'] }],
};

const handedOver: TopologyInput = { ...STAND, chainSocksPassword: CHAIN_PASSWORD };

function golden(name: string, value: unknown): void {
  const path = join(GOLDEN_DIR, `${name}.json`);
  const got = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(path, got);
    return;
  }
  expect(got, `golden ${name} is out of date, retake it with UPDATE_GOLDEN=1 and read the diff`).toBe(
    readFileSync(path, 'utf8'),
  );
}

describe('the entry handing its directions to the chain process', () => {
  it('matches the golden of the entry as it is dialled today', () => {
    golden('xray-entry-before', buildTopologyFragmentsForNode(RU1, STAND));
  });

  it('matches the golden of the entry after the handover', () => {
    golden('xray-entry-after', buildTopologyFragmentsForNode(RU1, handedOver));
  });

  it('keeps every choice a client can make, one rule per profile, and draws no policy', () => {
    // Phase 9.3. Before the handover one rule per direction accepted the plain
    // tag and every policy's tag, and the policy's domain rules sat above it.
    // After it, each (direction, profile) has a rule of its own that hands the
    // connection to the chain AS that profile's user, and the chain draws the
    // policy. So: the same inbounds and firewall, QUIC still dropped first, no
    // domain rule left on xray, and every tag accepted before still accepted.
    const before = buildTopologyFragmentsForNode(RU1, STAND)!;
    const after = buildTopologyFragmentsForNode(RU1, handedOver)!;
    expect(after.inbounds).toEqual(before.inbounds);
    expect(after.linkIngressPort).toEqual(before.linkIngressPort);
    expect(after.linkAllowFrom).toEqual(before.linkAllowFrom);
    expect(after.routingRules[0]).toEqual(before.routingRules[0]);
    expect(before.routingRules.some((r) => 'domain' in r)).toBe(true);
    expect(after.routingRules.some((r) => 'domain' in r)).toBe(false);

    const tags = (rules: Record<string, unknown>[]) =>
      rules
        .filter((r) => typeof r.vlessRoute === 'string' && !('domain' in r))
        .flatMap((r) => (r.vlessRoute as string).split(','))
        .sort();
    expect(tags(after.routingRules)).toEqual(tags(before.routingRules));
  });

  it('hands each profile over as its own socks user', () => {
    const after = buildTopologyFragmentsForNode(RU1, handedOver)!;
    const target = (tag: number) =>
      after.routingRules.find((r) => r.vlessRoute === String(tag))?.outboundTag as string | undefined;
    const userOf = (outboundTag: string | undefined) => {
      const o = after.outbounds.find((x) => x.tag === outboundTag)!;
      const server = (o.settings as { servers: { port: number; users: { user: string }[] }[] }).servers[0]!;
      return { port: server.port, user: server.users[0]!.user };
    };
    // Plain on direction 1 (tag 1), the policy on direction 1 (tag 257), plain
    // on direction 2 (tag 2): same port per direction, the user names the profile.
    expect(userOf(target(1))).toEqual({ port: chainSocksPort(1), user: 'p0' });
    expect(userOf(target(257))).toEqual({ port: chainSocksPort(1), user: 'p1' });
    expect(userOf(target(2))).toEqual({ port: chainSocksPort(2), user: 'p0' });
    // Still a single STRING per rule, never an array: an array fails the whole
    // config and the core refuses to start.
    for (const r of after.routingRules) if ('vlessRoute' in r) expect(typeof r.vlessRoute).toBe('string');
  });

  it('dials the loopback port the formula gives, with a password', () => {
    const after = buildTopologyFragmentsForNode(RU1, handedOver)!;
    const socks = after.outbounds.filter((o) => o.protocol === 'socks');
    // Two directions, two profiles (plain and the one policy).
    expect(socks.length).toBe(4);
    const dialled = socks.map((o) => {
      const server = (o.settings as { servers: Record<string, unknown>[] }).servers[0]!;
      return { address: server.address, port: server.port, users: server.users };
    });
    expect([...new Set(dialled.map((d) => d.port))]).toEqual([chainSocksPort(1), chainSocksPort(2)]);
    // Loopback only: a socks outbound pointed anywhere else would carry the
    // user's traffic to a machine nobody named.
    expect(dialled.every((d) => d.address === '127.0.0.1')).toBe(true);
    expect(
      dialled.every(
        (d) => ((d.users as { pass: string }[])[0]?.pass ?? '') === CHAIN_PASSWORD,
      ),
    ).toBe(true);
    // And no leg is dialled across the internet from here any more.
    expect(after.outbounds.some((o) => o.protocol === 'vless')).toBe(false);
    expect(after.outbounds.some((o) => o.protocol === 'shadowsocks')).toBe(false);
  });
  it('gives both entries of the pool the same ways out, differing only by address', () => {
    // Two entries are two configs, and the subscriber must not be able to tell
    // which one they landed on. Before the handover they differ in the legs
    // they dial; after it they do not differ at all, because the legs moved to
    // each node's own chain process.
    const ruleShape = (node: string, input: TopologyInput) =>
      JSON.stringify(buildTopologyFragmentsForNode(node, input)!.routingRules);
    expect(ruleShape(RU2, STAND)).toBe(ruleShape(RU1, STAND));
    expect(ruleShape(RU2, handedOver)).toBe(ruleShape(RU1, handedOver));

    const addresses = (node: string) =>
      buildTopologyFragmentsForNode(node, STAND)!
        .outbounds.flatMap((o) => {
          const s = o.settings as { vnext?: { address: string }[] } | undefined;
          return s?.vnext?.map((v) => v.address) ?? [];
        })
        .sort();
    // Same destinations before the handover: the pool is two ways into one
    // cascade, not two cascades.
    expect(addresses(RU2)).toEqual(addresses(RU1));
  });

  it('hands the Auto line over as one more way out per profile, and stops measuring', () => {
    // Auto is "the fastest way out right now", and under handover the measuring
    // belongs to the chain process, which offers it on its own loopback port
    // like any other direction. So the entry keeps the RULES and loses the
    // machinery: no balancer to pick with, no observatory to pick by.
    const before = buildTopologyFragmentsForNode(RU1, { ...STAND, auto: true })!;
    const after = buildTopologyFragmentsForNode(RU1, { ...handedOver, auto: true })!;
    expect(before.balancers).toBeDefined();
    expect(before.observatory).toBeDefined();
    expect(after.balancers).toBeUndefined();
    expect(after.observatory).toBeUndefined();

    // One Auto rule per profile, each to Auto's own port as that profile's
    // user. Tag 0 is a port of its own rather than a reuse of some direction's:
    // reusing one would send every Auto subscriber down the same fixed way out.
    for (const [ordinal, user] of [[0, 'p0'], [1, 'p1']] as const) {
      const rule = after.routingRules.find((r) => r.vlessRoute === String(autoRouteTag(ordinal)))!;
      const o = after.outbounds.find((x) => x.tag === rule.outboundTag)!;
      const server = (o.settings as { servers: { port: number; users: { user: string }[] }[] }).servers[0]!;
      expect({ port: server.port, user: server.users[0]!.user }).toEqual({ port: chainSocksPort(0), user });
    }
  });
  it.skipIf(!XRAY_BIN).each([
    ['without the Auto line', handedOver],
    ['with the Auto line', { ...handedOver, auto: true }],
  ])('is a config xray will load, %s', (_what, input) => {
    const fragment = buildTopologyFragmentsForNode(RU1, input as TopologyInput)!;
    const config = JSON.stringify({
      log: { loglevel: 'warning' },
      inbounds: [
        {
          tag: 'vless-in',
          port: 443,
          listen: '0.0.0.0',
          protocol: 'vless',
          settings: { clients: [{ id: '00000000-0000-4000-8000-000000000009' }], decryption: 'none' },
          streamSettings: { network: 'raw', security: 'none' },
        },
        ...fragment.inbounds,
      ],
      outbounds: [
        { tag: 'direct', protocol: 'freedom' },
        { tag: 'blocked', protocol: 'blackhole' },
        ...fragment.outbounds.filter((o) => o.tag !== 'direct'),
      ],
      routing: { rules: fragment.routingRules },
    });
    const dir = mkdtempSync(join(tmpdir(), 'iceslab-xray-'));
    const file = join(dir, 'config.json');
    writeFileSync(file, config);
    let ok = true;
    let output: string;
    try {
      output = execFileSync(XRAY_BIN, ['-test', '-c', file], { encoding: 'utf8' });
    } catch (err) {
      ok = false;
      const e = err as { stdout?: string; stderr?: string; message?: string };
      output = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`;
    }
    expect(ok, output).toBe(true);
  });
});
