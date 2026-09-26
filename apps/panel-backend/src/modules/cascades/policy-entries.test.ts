import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, connect, type AddressInfo, type Socket } from 'node:net';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { classifyPolicyEntry, splitPolicyEntries } from './policy-entries.js';
import { chainPoliciesOf } from './chain-policy.js';
import { renderChainConfig } from './chain.config.js';
import { chainSocksUser } from './chain.ports.js';

/**
 * E55: a route policy's entries are names or addresses, and the entry's chain
 * carries both. `geoip:` used to be dropped by the chain and handed to xray as
 * a domain, so "ru goes direct" (the Э3 acceptance criterion, written with
 * geoip) could be saved and did nothing.
 */
const SINGBOX_BIN =
  process.env.SINGBOX_BIN ??
  ['/usr/local/bin/sing-box', '/usr/bin/sing-box'].find((p) => existsSync(p)) ??
  '';

describe('what an entry is', () => {
  it.each([
    ['geosite:category-ads-all', 'domain'],
    ['ext:ru-list:gov', 'domain'],
    ['domain:yandex.ru', 'domain'],
    ['full:api.example.com', 'domain'],
    ['keyword:ads', 'domain'],
    ['regexp:.*\\.ru$', 'domain'],
    ['gosuslugi.ru', 'domain'],
    ['geoip:ru', 'ip'],
    ['geoip:!ru', 'ip'],
    ['ext-ip:operator:office', 'ip'],
    ['10.0.0.0/8', 'ip'],
    ['2001:db8::/32', 'ip'],
    ['192.0.2.1', 'ip'],
  ] as const)('%s is a %s', (entry, kind) => {
    expect(classifyPolicyEntry(entry)).toBe(kind);
  });

  it.each(['', 'geoip:', 'ext:onlyset', 'regexp:(', 'domain:', 'foo:bar', 'has space.com', '10.0.0.0/40', 'http://x.ru'])(
    '%j is neither, and is refused',
    (entry) => {
      expect(classifyPolicyEntry(entry)).toBeNull();
    },
  );

  it('splits a list by kind, in order', () => {
    expect(splitPolicyEntries(['geoip:ru', 'domain:ya.ru', '10.0.0.0/8', 'bogus::'])).toEqual({
      domain: ['domain:ya.ru'],
      ip: ['geoip:ru', '10.0.0.0/8'],
    });
  });
});

describe('the entry chain draws the addresses', () => {
  const { policies, ruleSets } = chainPoliciesOf([
    { ordinal: 1, directDomains: ['domain:gosuslugi.ru', 'geoip:ru', '198.51.100.0/24'], blockDomains: ['geosite:category-ads-all'] },
  ]);

  it('as their own rules, block before direct, resolved for the policy holder only', () => {
    expect(policies[0]).toMatchObject({
      directIp: { ip_cidr: ['198.51.100.0/24'], rule_set: ['geo-geoip-ru'] },
    });
    expect(ruleSets.map((r) => r.tag)).toEqual(['geo-geoip-ru', 'geo-geosite-category-ads-all']);
    const cfg = renderChainConfig({
      role: 'entry',
      socksPassword: 'chain-socks-fixture-password-0000',
      directionTags: [1],
      out: [],
      policies,
      ruleSets: ruleSets.map((r) => ({ tag: r.tag, path: r.path })),
    }) as { route: { rules: Record<string, unknown>[] } };
    const p1 = cfg.route.rules.filter((r) => Array.isArray(r.auth_user) && (r.auth_user as string[])[0] === chainSocksUser(1));
    expect(p1.map((r) => r.action)).toEqual(['reject', 'resolve', 'route', 'route']);
    expect(p1[1]).toEqual({ auth_user: [chainSocksUser(1)], action: 'resolve' });
    expect(p1[3]).toEqual({
      auth_user: [chainSocksUser(1)],
      ip_cidr: ['198.51.100.0/24'],
      rule_set: ['geo-geoip-ru'],
      action: 'route',
      outbound: 'direct',
    });
  });

  it.skipIf(!SINGBOX_BIN)('is a config sing-box will load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iceslab-e55-'));
    const rs = ruleSets.map((r) => {
      const file = join(dir, r.file);
      writeFileSync(file, JSON.stringify({ version: 2, rules: [] }));
      return { tag: r.tag, path: file };
    });
    const file = join(dir, 'config.json');
    writeFileSync(
      file,
      JSON.stringify(
        renderChainConfig({
          role: 'entry',
          socksPassword: 'chain-socks-fixture-password-0000',
          directionTags: [1],
          out: [],
          foreign: [{ tag: 1, type: 'socks', config: { server: '127.0.0.1', port: 1 } }],
          policies,
          ruleSets: rs,
        }),
      ),
    );
    execFileSync(SINGBOX_BIN, ['check', '-c', file]);
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

/** The DIRECTION's way out: a socks5 proxy that counts what it carries. */
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
      if (buf.length < 10 || buf[3] !== 1) return;
      const host = [...buf.subarray(4, 8)].join('.');
      const port = buf.readUInt16BE(8);
      const rest = buf.subarray(10);
      client.off('data', onData);
      client.pause();
      const up = connect(port, host, () => {
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

/** One GET to `ip`:`target` through the entry's socks, as `user`. */
function get(socksPort: number, user: string, password: string, ip: [number, number, number, number], target: number): Promise<string> {
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
        const u = Buffer.from(user);
        const p = Buffer.from(password);
        sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]));
        buf = buf.subarray(2);
        stage = 1;
      }
      if (stage === 1 && buf.length >= 2) {
        if (buf[1] !== 0) return sock.destroy(new Error('socks auth refused'));
        const port = Buffer.alloc(2);
        port.writeUInt16BE(target);
        sock.write(Buffer.concat([Buffer.from([5, 1, 0, 1, ...ip]), port]));
        buf = buf.subarray(2);
        stage = 2;
      }
      if (stage === 2 && buf.length >= 10) {
        if (buf[1] !== 0) return sock.destroy(new Error(`socks connect refused, code ${buf[1]}`));
        sock.write(`GET / HTTP/1.1\r\nHost: ${ip.join('.')}:${target}\r\nConnection: close\r\n\r\n`);
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

describe('an address in the policy geoip set leaves from the entry, live', () => {
  it.skipIf(!SINGBOX_BIN)(
    'in the set: direct; outside it: the direction; the plain profile: the direction',
    async () => {
      let pageHits = 0;
      const nonce = randomBytes(8).toString('hex');
      const http: Server = createHttpServer((_req, res) => {
        pageHits += 1;
        res.end(nonce);
      });
      // Every loopback address, so 127.0.0.1 (in the set) and 127.0.0.2
      // (outside it) reach the same page.
      await new Promise<void>((r) => http.listen(0, '0.0.0.0', () => r()));
      const httpPort = (http.address() as AddressInfo).port;
      const direction = await countingSocks(httpPort);

      // The policy as the operator writes it: direct geoip:e55test. The set's
      // rule-set file is the one the node would be laid out, made here: one
      // address, 127.0.0.1.
      const { policies, ruleSets } = chainPoliciesOf([{ ordinal: 1, directDomains: ['geoip:e55test'], blockDomains: [] }]);
      const dir = mkdtempSync(join(tmpdir(), 'iceslab-e55-live-'));
      const rs = ruleSets.map((r) => {
        const file = join(dir, r.file);
        writeFileSync(file, JSON.stringify({ version: 2, rules: [{ ip_cidr: ['127.0.0.1/32'] }] }));
        return { tag: r.tag, path: file };
      });

      const password = randomBytes(12).toString('hex');
      const socksPort = await freePort();
      const entry = renderChainConfig({
        role: 'entry',
        socksPassword: password,
        directionTags: [1],
        out: [],
        foreign: [{ tag: 1, type: 'socks', config: { server: '127.0.0.1', port: direction.port } }],
        policies,
        ruleSets: rs,
      }) as { inbounds: { type: string; listen_port: number }[] };
      for (const i of entry.inbounds) if (i.type === 'socks') i.listen_port = socksPort;

      const file = join(dir, 'entry.json');
      writeFileSync(file, JSON.stringify(entry, null, 2));
      const child = spawn(SINGBOX_BIN, ['run', '-c', file], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      let log = '';
      child.stderr!.on('data', (d: Buffer) => (log += d.toString()));
      try {
        const p1 = chainSocksUser(1);
        const p0 = chainSocksUser(0);
        expect(await eventually(() => get(socksPort, p1, password, [127, 0, 0, 1], httpPort), 15000)).toContain(nonce);
        const inSet = { direction: direction.hits(), page: pageHits };
        expect(inSet).toEqual({ direction: 0, page: 1 });

        expect(await get(socksPort, p1, password, [127, 0, 0, 2], httpPort)).toContain(nonce);
        const outside = { direction: direction.hits(), page: pageHits };
        expect(outside).toEqual({ direction: 1, page: 2 });

        expect(await get(socksPort, p0, password, [127, 0, 0, 1], httpPort)).toContain(nonce);
        const plain = { direction: direction.hits(), page: pageHits };
        expect(plain).toEqual({ direction: 2, page: 3 });
        console.log(
          `E55 live: p1 -> 127.0.0.1 (in geoip set): direct, direction ${inSet.direction}, page ${inSet.page}; ` +
            `p1 -> 127.0.0.2 (outside): direction ${outside.direction}, page ${outside.page}; ` +
            `p0 -> 127.0.0.1 (no policy): direction ${plain.direction}, page ${plain.page}`,
        );
      } catch (err) {
        throw new Error(`${(err as Error).message}\n${log.replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(-15).join('\n')}`);
      } finally {
        child.kill('SIGKILL');
        direction.close();
        http.close();
      }
    },
    60000,
  );
});
