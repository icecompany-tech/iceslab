import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, connect, type AddressInfo, type Socket } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { renderChainConfig, type ChainRenderInput } from './chain.config.js';
import { chainNodePolicyOf, type ChainNodePolicyRule } from './chain-policy.js';
import { LINK_PORT_BASE, type LinkCred } from './cascade.config.js';
import { CHAIN_SOCKS_USER } from './chain.ports.js';

/**
 * E53, stand 26.09: a node policy on a cascade EXIT did not touch the
 * cascade's traffic. nl-01 had domain:cloudflare.com -> warp, the push said
 * applied, and cdn-cgi/trace through the cascade said warp=off: the traffic
 * leaves the exit from the chain process, and only xray drew the policy.
 *
 * The exit's chain now carries it. Shape (golden), engine (`sing-box check`,
 * the WARP endpoint included), and a request through two engines where a
 * counter on each way out says which one it took (E51: "it went through" is
 * not evidence).
 */
const SINGBOX_BIN =
  process.env.SINGBOX_BIN ??
  ['/usr/local/bin/sing-box', '/usr/bin/sing-box'].find((p) => existsSync(p)) ??
  '';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__testdata__');

/** Allowed by value in .gitleaks.toml, like the other chain fixtures. */
const FIXTURE_SOCKS_PASSWORD = 'chain-socks-fixture-password-0000';
/** A WireGuard key that says what it is: base64 of the 32 bytes
 *  "iceslab-warp-fixture-key-0000000". Allowed by value in .gitleaks.toml. */
const FIXTURE_WARP_KEY = Buffer.from('iceslab-warp-fixture-key-0000000').toString('base64');

const REALITY = {
  privateKey: 'k'.repeat(43),
  publicKey: 'p'.repeat(43),
  shortId: '0123abcd',
  serverName: 'www.apple.com',
  dest: 'www.apple.com:443',
};

const POLICY: ChainNodePolicyRule[] = [
  { match: { domain: ['domain:cloudflare.com'] }, action: { kind: 'warp' } },
  { match: { domain: ['geosite:category-ads-all'] }, action: { kind: 'block' } },
  { match: { ip: ['10.0.0.0/8', '192.0.2.1'] }, action: { kind: 'direct' } },
  { match: { port: '6881-6889,51413', network: 'udp' }, action: { kind: 'block' } },
  { match: { domain: ['full:api.example.com'], ip: ['geoip:private'] }, action: { kind: 'direct' } },
  { match: { protocol: ['quic'] }, action: { kind: 'block' } },
  // A cascade rule means nothing at an exit; the save refuses it, the render skips it.
  { match: { domain: ['example.org'] }, action: { kind: 'cascade' } },
];

describe('a node policy as the exit chain carries it', () => {
  it('translates each matcher the way xray reads it', () => {
    const { rules, ruleSets, usesWarp } = chainNodePolicyOf(POLICY);
    expect(usesWarp).toBe(true);
    expect(rules).toEqual([
      { domain: ['cloudflare.com'], domain_suffix: ['.cloudflare.com'], action: 'route', outbound: 'warp' },
      { rule_set: ['geo-geosite-category-ads-all'], action: 'reject', method: 'drop' },
      // xray resolves a name no domain rule took (IPIfNonMatch); sing-box
      // matches an IP only on an IP, so the name is resolved here, after the
      // rules that match by name had their turn.
      { action: 'resolve' },
      { ip_cidr: ['10.0.0.0/8', '192.0.2.1/32'], action: 'route', outbound: 'direct' },
      { port: [51413], port_range: ['6881:6889'], network: ['udp'], action: 'reject', method: 'drop' },
      // Both halves named: xray ANDs them, sing-box would OR them.
      {
        type: 'logical',
        mode: 'and',
        rules: [{ domain: ['api.example.com'] }, { rule_set: ['geo-geoip-private'] }],
        action: 'route',
        outbound: 'direct',
      },
      { protocol: ['quic'], action: 'reject', method: 'drop' },
    ]);
    expect(ruleSets.map((r) => r.tag)).toEqual(['geo-geoip-private', 'geo-geosite-category-ads-all']);
  });

  it('spells a catch-all as a condition every connection meets', () => {
    expect(chainNodePolicyOf([{ match: {}, action: { kind: 'warp' } }]).rules).toEqual([
      { network: ['tcp', 'udp'], action: 'route', outbound: 'warp' },
    ]);
  });
});

const exitInput = (): ChainRenderInput => {
  const { rules, ruleSets } = chainNodePolicyOf(POLICY);
  return {
    role: 'exit',
    socksPassword: FIXTURE_SOCKS_PASSWORD,
    in: {
      cred: { protocol: 'vless', port: LINK_PORT_BASE, uuid: '00000000-0000-4000-8000-000000000002', reality: REALITY },
      clients: [{ tag: 1, uuid: '00000000-0000-4000-8000-000000000002', shortId: REALITY.shortId }],
    },
    exitPolicy: {
      rules,
      warp: {
        privateKey: FIXTURE_WARP_KEY,
        address: ['172.16.0.2/32', '2606:4700:110:8a36::1/128'],
        reserved: [1, 2, 3],
      },
    },
    ruleSets: ruleSets.map((r) => ({ tag: r.tag, path: r.path })),
  };
};

describe('the exit chain with a node policy', () => {
  it('matches the golden', () => {
    const got = `${JSON.stringify(renderChainConfig(exitInput()), null, 2)}\n`;
    const path = join(GOLDEN_DIR, 'chain-exit-policy.json');
    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(path, got);
      return;
    }
    expect(got).toBe(readFileSync(path, 'utf8'));
  });

  it('keeps the protections above the policy, and says where the rest goes', () => {
    const cfg = renderChainConfig(exitInput()) as { route: { rules: Record<string, unknown>[]; final?: string } };
    expect(cfg.route.rules.slice(0, 4).map((r) => r.action)).toEqual(['sniff', 'hijack-dns', 'reject', 'reject']);
    expect(cfg.route.final).toBe('direct');
  });

  it('is not there for an exit without a policy, byte for byte', () => {
    const plain = renderChainConfig({ ...exitInput(), exitPolicy: undefined, ruleSets: undefined }) as Record<string, unknown>;
    expect(plain.endpoints).toBeUndefined();
    expect((plain.route as Record<string, unknown>).final).toBeUndefined();
  });

  it.skipIf(!SINGBOX_BIN)('is a config sing-box will load, the WARP endpoint included', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iceslab-exit-policy-'));
    const input = exitInput();
    // The rule-set files the node would have: empty lists, the engine only
    // has to open them.
    for (const rs of input.ruleSets ?? []) {
      const file = join(dir, rs.path.split('/').pop()!);
      writeFileSync(file, JSON.stringify({ version: 2, rules: [] }));
      rs.path = file;
    }
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(renderChainConfig(input), null, 2));
    try {
      execFileSync(SINGBOX_BIN, ['check', '-c', file], { encoding: 'utf8' });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      throw new Error(`${e.stdout ?? ''}${e.stderr ?? ''}`);
    }
  });
});

// ───── live ─────

const children: ChildProcess[] = [];
afterAll(() => {
  for (const c of children) c.kill('SIGKILL');
});

async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const s = createTcpServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

function run(name: string, config: unknown): { log: () => string } {
  const dir = mkdtempSync(join(tmpdir(), `iceslab-e53-${name}-`));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  const child = spawn(SINGBOX_BIN, ['run', '-c', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr!.on('data', (d: Buffer) => (out += d.toString()));
  return { log: () => `--- ${name}\n${out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(-15).join('\n')}` };
}

/** A socks5 proxy that counts the connections it carries to `targetPort`. */
async function countingSocks(targetPort: number): Promise<{ port: number; hits: () => number; close: () => void }> {
  let hits = 0;
  const server = createTcpServer((client: Socket) => {
    let buf = Buffer.alloc(0);
    let stage = 0;
    client.on('error', () => client.destroy());
    const onData = (d: Buffer): void => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0) {
        if (buf.length < 2 || buf.length < 2 + buf[1]!) return;
        buf = buf.subarray(2 + buf[1]!);
        client.write(Buffer.from([5, 0]));
        stage = 1;
      }
      if (buf.length < 5) return;
      let host: string;
      let off: number;
      if (buf[3] === 1) {
        if (buf.length < 10) return;
        host = [...buf.subarray(4, 8)].join('.');
        off = 8;
      } else if (buf[3] === 3) {
        const l = buf[4]!;
        if (buf.length < 7 + l) return;
        host = buf.subarray(5, 5 + l).toString();
        off = 5 + l;
      } else {
        return void client.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0]));
      }
      const port = buf.readUInt16BE(off);
      const rest = buf.subarray(off + 2);
      client.off('data', onData);
      client.pause();
      // `localhost` to the address the page listens on, not to ::1.
      const up = connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
        if (port === targetPort) hits += 1;
        client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        if (rest.length > 0) up.write(rest);
        client.pipe(up);
        up.pipe(client);
        client.resume();
      });
      up.on('error', () => client.destroy());
    };
    client.on('data', onData);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { port: (server.address() as AddressInfo).port, hits: () => hits, close: () => server.close() };
}

/** One GET through the entry's socks listener, by name or by address. */
function getThroughSocks(socksPort: number, password: string, target: number, host?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock: Socket = connect(socksPort, '127.0.0.1');
    sock.setTimeout(8000, () => sock.destroy(new Error('socks timeout')));
    let stage = 0;
    let buf = Buffer.alloc(0);
    sock.on('error', reject);
    sock.on('connect', () => sock.write(Buffer.from([5, 1, 2])));
    sock.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 2) {
        const u = Buffer.from(CHAIN_SOCKS_USER);
        const p = Buffer.from(password);
        sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]));
        buf = buf.subarray(2);
        stage = 1;
      }
      if (stage === 1 && buf.length >= 2) {
        if (buf[1] !== 0) return sock.destroy(new Error('socks auth refused'));
        const port = Buffer.alloc(2);
        port.writeUInt16BE(target);
        const addr = host
          ? Buffer.concat([Buffer.from([3, host.length]), Buffer.from(host)])
          : Buffer.from([1, 127, 0, 0, 1]);
        sock.write(Buffer.concat([Buffer.from([5, 1, 0]), addr, port]));
        buf = buf.subarray(2);
        stage = 2;
      }
      if (stage === 2 && buf.length >= 10) {
        if (buf[1] !== 0) return sock.destroy(new Error(`socks connect refused, code ${buf[1]}`));
        sock.write(`GET / HTTP/1.1\r\nHost: ${host ?? '127.0.0.1'}:${target}\r\nConnection: close\r\n\r\n`);
        buf = buf.subarray(10);
        stage = 3;
      }
    });
    sock.on('end', () => (stage === 3 ? resolve(buf.toString()) : reject(new Error(`socks closed at stage ${stage}`))));
  });
}

async function eventually<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  const until = Date.now() + ms;
  let last: unknown;
  while (Date.now() < until) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw last;
}

describe('a request leaves the exit the way its node policy says, live', () => {
  it.skipIf(!SINGBOX_BIN)(
    'domain:localhost goes through WARP, the same page by address goes direct, counted on both',
    async () => {
      let pageHits = 0;
      const nonce = randomBytes(8).toString('hex');
      const http: Server = createHttpServer((_req, res) => {
        pageHits += 1;
        res.end(nonce);
      });
      await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()));
      const httpPort = (http.address() as AddressInfo).port;
      // WARP cannot be reached from a test, so the ONE thing replaced in the
      // exit's config is what `warp` is: the rendered endpoint goes, a counting
      // proxy under the same tag comes. The rules stay exactly as rendered.
      const warp = await countingSocks(httpPort);

      const password = randomBytes(12).toString('hex');
      const socksPort = await freePort();
      const leg: LinkCred = { protocol: 'vless', port: await freePort(), uuid: randomUUID() };
      const entry = renderChainConfig({
        role: 'entry',
        socksPassword: password,
        directionTags: [1],
        out: [{ tag: 1, host: '127.0.0.1', cred: leg }],
      }) as { inbounds: { type: string; listen_port: number }[] };
      for (const i of entry.inbounds) if (i.type === 'socks') i.listen_port = socksPort;

      const { rules } = chainNodePolicyOf([{ match: { domain: ['domain:localhost'] }, action: { kind: 'warp' } }]);
      const exit = renderChainConfig({
        role: 'exit',
        socksPassword: password,
        in: { cred: leg, clients: [{ tag: 1, uuid: (leg as { uuid: string }).uuid }] },
        exitPolicy: { rules, warp: { privateKey: FIXTURE_WARP_KEY, address: ['172.16.0.2/32'] } },
      }) as { endpoints?: unknown[]; outbounds: Record<string, unknown>[] };
      expect(exit.endpoints).toHaveLength(1);
      delete exit.endpoints;
      exit.outbounds.push({ type: 'socks', tag: 'warp', server: '127.0.0.1', server_port: warp.port, version: '5' });

      const logs = [run('exit', exit), run('entry', entry)];
      try {
        const byName = await eventually(() => getThroughSocks(socksPort, password, httpPort, 'localhost'), 15000);
        expect(byName).toContain(nonce);
        expect([warp.hits(), pageHits]).toEqual([1, 1]);

        const byAddress = await eventually(() => getThroughSocks(socksPort, password, httpPort), 5000);
        expect(byAddress).toContain(nonce);
        // The page was reached a second time, WARP was not: that one went direct.
        expect([warp.hits(), pageHits]).toEqual([1, 2]);
        console.log(`E53 live: by name -> warp ${warp.hits()}, page ${pageHits}; by address -> direct ${pageHits - warp.hits()}`);
      } catch (err) {
        throw new Error(`${(err as Error).message}\n${logs.map((l) => l.log()).join('\n')}`);
      } finally {
        for (const c of children.splice(0)) c.kill('SIGKILL');
        warp.close();
        http.close();
      }
    },
    60000,
  );
});
