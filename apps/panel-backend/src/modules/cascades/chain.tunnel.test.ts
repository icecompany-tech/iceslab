import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderChainConfig, type ChainRenderInput } from './chain.config.js';
import { LINK_PORT_BASE, type LinkCred } from './cascade.config.js';
import { renderTunnelConf, type TopologyTunnel } from './cascade-tunnel.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { createCascade, getChainForNode } from './cascade.service.js';

/**
 * Phase 8.2: a leg inside an AmneziaWG tunnel, the panel's half of the render.
 *
 *   dialling end  the leg's outbound dials the far end's INNER address with
 *                 `bind_interface: awg-l<n>`, so with the tunnel down it fails
 *                 rather than leaving by the default route;
 *   receiving end the link-in listens on the tunnel's inner address, not on
 *                 0.0.0.0, so the leg's port is not open to the internet.
 *
 * ⚠ The keys are FIXTURES and say so: base64 of "iceslab-tunnel-fixture-...",
 * allowed by value in .gitleaks.toml.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, '__testdata__');

const SINGBOX_BIN =
  process.env.SINGBOX_BIN ??
  ['/usr/local/bin/sing-box', '/usr/bin/sing-box'].find((p) => existsSync(p)) ??
  '';

const LEG: LinkCred = {
  protocol: 'vless',
  port: LINK_PORT_BASE,
  uuid: '00000000-0000-4000-8000-000000000001',
};

const TUNNEL: TopologyTunnel = {
  fromNodeId: 'entry',
  toNodeId: 'exit',
  index: 0,
  port: 27000,
  cred: {
    from: {
      privateKey: 'aWNlc2xhYi10dW5uZWwtZml4dHVyZS1wcml2LWZyb20=',
      publicKey: 'aWNlc2xhYi10dW5uZWwtZml4dHVyZS1wdWItZnJvbSE=',
    },
    to: {
      privateKey: 'aWNlc2xhYi10dW5uZWwtZml4dHVyZS1wcml2LXRvISE=',
      publicKey: 'aWNlc2xhYi10dW5uZWwtZml4dHVyZS1wdWItdG8hISE=',
    },
    obfuscation: { jc: 4, jmin: 80, jmax: 400, s1: 20, s2: 30, s3: 12, s4: 7, h1: 1111, h2: 2222, h3: 3333, h4: 4444 },
  },
};

const entry: ChainRenderInput = {
  role: 'entry',
  socksPassword: 'chain-socks-fixture-password-0000',
  directionTags: [1],
  out: [{ tag: 1, host: '10.67.0.2', cred: LEG, via: 'awg-l0' }],
};

const exit: ChainRenderInput = {
  role: 'exit',
  socksPassword: 'chain-socks-fixture-password-0000',
  in: { cred: LEG, clients: [{ tag: 1, uuid: LEG.uuid }], listen: ['10.67.0.2'] },
};

/** An exit two entries reach through two tunnels: two listeners, two addresses. */
const exitOfTwo: ChainRenderInput = {
  ...exit,
  in: { cred: LEG, clients: [{ tag: 1, uuid: LEG.uuid }], listen: ['10.67.0.2', '10.67.0.6'] },
};

function golden(name: string, got: string): void {
  const path = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(path, got);
    return;
  }
  expect(got, `golden ${name} is out of date; retake with UPDATE_GOLDEN=1 and read the diff`).toBe(
    readFileSync(path, 'utf8').replace(/\r\n/g, '\n'),
  );
}

function engineAccepts(config: unknown): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'iceslab-tunnel-'));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  try {
    return { ok: true, output: execFileSync(SINGBOX_BIN, ['check', '-c', file], { encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}` };
  }
}

describe('a leg inside a tunnel, rendered', () => {
  const cases: [string, ChainRenderInput][] = [
    ['chain8-entry', entry],
    ['chain8-exit', exit],
    ['chain8-exit-two-tunnels', exitOfTwo],
  ];
  for (const [name, input] of cases) {
    it(`matches the golden for ${name}`, () => {
      golden(`${name}.json`, `${JSON.stringify(renderChainConfig(input), null, 2)}\n`);
    });
    it.skipIf(!SINGBOX_BIN)(`is a config sing-box will load, ${name}`, () => {
      const verdict = engineAccepts(renderChainConfig(input));
      expect(verdict.ok, verdict.output).toBe(true);
    });
  }

  it('binds the leg to the tunnel and dials the inner address', () => {
    const cfg = renderChainConfig(entry) as { outbounds: Record<string, unknown>[] };
    const leg = cfg.outbounds.find((o) => o.tag === 'out-d1')!;
    expect(leg).toMatchObject({ server: '10.67.0.2', bind_interface: 'awg-l0' });
  });

  it('listens on the inner address and never on 0.0.0.0, one listener per tunnel', () => {
    const one = renderChainConfig(exit) as { inbounds: Record<string, unknown>[] };
    expect(one.inbounds.map((i) => [i.tag, i.listen])).toEqual([['link-in', '10.67.0.2']]);
    const two = renderChainConfig(exitOfTwo) as { inbounds: Record<string, unknown>[] };
    expect(two.inbounds.map((i) => [i.tag, i.listen])).toEqual([
      ['link-in', '10.67.0.2'],
      ['link-in-1', '10.67.0.6'],
    ]);
  });

  it('renders a leg over the internet exactly as before', () => {
    const plain = renderChainConfig({ ...exit, in: { cred: LEG, clients: [{ tag: 1, uuid: LEG.uuid }] } }) as {
      inbounds: Record<string, unknown>[];
    };
    expect(plain.inbounds.map((i) => [i.tag, i.listen])).toEqual([['link-in', '0.0.0.0']]);
  });
});

describe('the tunnel config of each end', () => {
  it('matches the golden on the dialling end and on the receiving end', () => {
    golden('tunnel8-from.conf', renderTunnelConf(TUNNEL, 'from', 'exit.example.com'));
    golden('tunnel8-to.conf', renderTunnelConf(TUNNEL, 'to'));
  });

  it('has no hooks and no DNS, and only the receiving end listens', () => {
    for (const conf of [renderTunnelConf(TUNNEL, 'from', 'exit.example.com'), renderTunnelConf(TUNNEL, 'to')]) {
      expect(conf).not.toMatch(/^(PreUp|PostUp|PreDown|PostDown|DNS)\s*=/m);
      expect(conf).toContain('Table = off');
      expect(conf).toContain('S3 = 12');
      expect(conf).toContain('S4 = 7');
    }
    expect(renderTunnelConf(TUNNEL, 'from', 'exit.example.com')).not.toContain('ListenPort');
    expect(renderTunnelConf(TUNNEL, 'to')).toContain('ListenPort = 27000');
    expect(renderTunnelConf(TUNNEL, 'to')).not.toContain('Endpoint');
  });
});

describe('the chain block of both ends, from the database', () => {
  let seq = 0;
  async function makeNode(name: string, address: string) {
    seq += 1;
    return (
      await prisma.node.create({
        data: { name, address, protocol: 'xray', countryCode: 'NL', heartbeatSecret: randomBytes(32) },
        select: { id: true },
      })
    ).id;
  }

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await closeRedis();
  });

  it('hands each end its tunnel, and the leg rides it', async () => {
    const entryId = await makeNode('ru-entry', 'ru.example.com:1337');
    const exitId = await makeNode('nl-exit', 'nl.example.com:1337');
    await createCascade({
      name: `awg-${seq}`,
      enabled: true,
      positions: [
        { position: 0, nodeIds: [entryId], entryProtocol: 'xray', linkProtocol: 'vless', linkParams: { underlay: 'awg' } },
      ],
      directions: [{ countryCode: 'NL', nodeIds: [exitId] }],
    } as never);

    const atEntry = await getChainForNode(entryId);
    const atExit = await getChainForNode(exitId);
    expect(atEntry?.tunnels).toEqual([{ iface: 'awg-l0', conf: expect.stringContaining('Endpoint = nl.example.com:27000') }]);
    expect(atExit?.tunnels).toEqual([
      { iface: 'awg-l0', conf: expect.stringContaining('Address = 10.67.0.2/30'), listenPort: 27000 },
    ]);
    const out = (atEntry!.config as { outbounds: Record<string, unknown>[] }).outbounds.find((o) => o.type === 'vless');
    expect(out).toMatchObject({ server: '10.67.0.2', bind_interface: 'awg-l0' });
    const inb = (atExit!.config as { inbounds: Record<string, unknown>[] }).inbounds;
    expect(inb.map((i) => i.listen)).toEqual(['10.67.0.2']);
  });

  it('sends no tunnels for a cascade whose legs go direct', async () => {
    const entryId = await makeNode('ru-entry', 'ru.example.com:1337');
    const exitId = await makeNode('nl-exit', 'nl.example.com:1337');
    await createCascade({
      name: `direct-${seq}`,
      enabled: true,
      positions: [{ position: 0, nodeIds: [entryId], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions: [{ countryCode: 'NL', nodeIds: [exitId] }],
    } as never);
    const atEntry = await getChainForNode(entryId);
    expect(atEntry).not.toBeNull();
    expect('tunnels' in atEntry!).toBe(false);
  });
});
