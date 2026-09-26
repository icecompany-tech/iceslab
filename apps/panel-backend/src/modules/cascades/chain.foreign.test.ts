import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, connect, type AddressInfo, type Socket } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { renderChainConfig, type ChainForeignOut, type ChainRenderInput } from './chain.config.js';
import { LINK_PORT_BASE, type LinkCred } from './cascade.config.js';
import { CHAIN_SOCKS_USER } from './chain.ports.js';

/**
 * Phase 10: a direction that goes out through a server that is not ours.
 *
 * The node of the LAST position dials the named outbound from its chain as
 * `out-d<tag>`, beside the legs of the other directions, and Auto spans it with
 * them. Three questions, in the order a node asks them: is it the shape we
 * mean (golden), will the engine load it (`sing-box check`), and does a request
 * actually come out of the foreign server (live, below).
 */
const SINGBOX_BIN =
  process.env.SINGBOX_BIN ??
  ['/usr/local/bin/sing-box', '/usr/bin/sing-box'].find((p) => existsSync(p)) ??
  '';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__testdata__');

/** Allowed by value in .gitleaks.toml, like the other chain goldens. */
const FIXTURE_SOCKS_PASSWORD = 'chain-socks-fixture-password-0000';

const uuidFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const REALITY = {
  privateKey: 'k'.repeat(43),
  publicKey: 'p'.repeat(43),
  shortId: '0123abcd',
  serverName: 'www.apple.com',
  dest: 'www.apple.com:443',
};

/** One of each shape the set allows: vless with REALITY, vless with plain TLS
 *  and no fingerprint, socks5 with a login. As the panel stores them. */
const FOREIGN: ChainForeignOut[] = [
  {
    tag: 2,
    type: 'vless',
    config: {
      server: 'ch.example.net',
      port: 443,
      uuid: uuidFor(20),
      flow: 'xtls-rprx-vision',
      security: 'reality',
      sni: 'www.apple.com',
      fingerprint: 'chrome',
      realityPublicKey: 'p'.repeat(43),
      realityShortId: 'abcd',
    },
  },
  {
    tag: 3,
    type: 'socks',
    config: { server: '203.0.113.7', port: 1080, username: 'op', password: FIXTURE_SOCKS_PASSWORD },
  },
  {
    tag: 4,
    type: 'vless',
    config: { server: 'tr.example.net', port: 8443, uuid: uuidFor(21), flow: null, security: 'tls', sni: 'tr.example.net', alpn: ['h2'] },
  },
];

/** A cascade of ONE position: the entry is the last position and dials the
 *  outbounds itself, beside a direction of our own nodes. */
const entryInput: ChainRenderInput = {
  role: 'entry',
  socksPassword: FIXTURE_SOCKS_PASSWORD,
  directionTags: [0, 1, 2, 3, 4],
  out: [{ tag: 1, host: 'nl-1.example.com', cred: { protocol: 'vless', port: LINK_PORT_BASE, uuid: uuidFor(2), reality: REALITY } }],
  foreign: FOREIGN,
};

/** The same ways out from a transit on the last position: the entry's legs
 *  arrive per direction, and each goes on by the credential it came in on. */
const transitInput: ChainRenderInput = {
  role: 'transit',
  socksPassword: FIXTURE_SOCKS_PASSWORD,
  in: {
    cred: { protocol: 'vless', port: LINK_PORT_BASE, uuid: uuidFor(2), reality: REALITY },
    clients: [1, 2, 3, 4].map((tag) => ({ tag, uuid: uuidFor(tag + 1), shortId: REALITY.shortId })),
  },
  out: [{ tag: 1, host: 'nl-1.example.com', cred: { protocol: 'vless', port: LINK_PORT_BASE + 1, uuid: uuidFor(9), reality: REALITY } }],
  foreign: FOREIGN,
};

const ROLES = [
  ['entry', entryInput],
  ['transit', transitInput],
] as const;

type Cfg = {
  inbounds: Record<string, unknown>[];
  outbounds: Record<string, unknown>[];
  route: { rules: Record<string, unknown>[] };
};

function engineAccepts(config: unknown): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'iceslab-foreign-'));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  try {
    return { ok: true, output: execFileSync(SINGBOX_BIN, ['check', '-c', file], { encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}` };
  }
}

describe('a named outbound in the chain', () => {
  for (const [role, input] of ROLES) {
    it(`matches the golden for the ${role}`, () => {
      const got = `${JSON.stringify(renderChainConfig(input), null, 2)}\n`;
      const path = join(GOLDEN_DIR, `chain-foreign-${role}.json`);
      if (process.env.UPDATE_GOLDEN) {
        writeFileSync(path, got);
        return;
      }
      expect(got).toBe(readFileSync(path, 'utf8'));
    });

    it.skipIf(!SINGBOX_BIN)(`is a config sing-box will load, ${role}`, () => {
      const verdict = engineAccepts(renderChainConfig(input));
      expect(verdict.ok, verdict.output).toBe(true);
    });
  }

  it('draws each outbound as the way out of its direction, from the stored fields', () => {
    const cfg = renderChainConfig(entryInput) as Cfg;
    const by = new Map(cfg.outbounds.map((o) => [o.tag as string, o]));
    expect(by.get('out-d2')).toEqual({
      type: 'vless',
      tag: 'out-d2',
      server: 'ch.example.net',
      server_port: 443,
      uuid: uuidFor(20),
      flow: 'xtls-rprx-vision',
      tls: {
        enabled: true,
        server_name: 'www.apple.com',
        utls: { enabled: true, fingerprint: 'chrome' },
        reality: { enabled: true, public_key: 'p'.repeat(43), short_id: 'abcd' },
      },
    });
    expect(by.get('out-d3')).toEqual({
      type: 'socks',
      tag: 'out-d3',
      server: '203.0.113.7',
      server_port: 1080,
      version: '5',
      username: 'op',
      password: FIXTURE_SOCKS_PASSWORD,
    });
    // Plain TLS without a fingerprint gets none: nothing the operator did not
    // write, the REALITY default below is the one exception the engine forces.
    expect(by.get('out-d4')!.tls).toEqual({ enabled: true, server_name: 'tr.example.net', alpn: ['h2'] });
  });

  it('gives REALITY a fingerprint when the operator left it out, because sing-box refuses one without', () => {
    const { fingerprint: _f, ...cfg } = FOREIGN[0]!.config;
    const out = renderChainConfig({ ...entryInput, foreign: [{ ...FOREIGN[0]!, config: cfg }] }) as Cfg;
    const d2 = out.outbounds.find((o) => o.tag === 'out-d2') as { tls: { utls: unknown } };
    expect(d2.tls.utls).toEqual({ enabled: true, fingerprint: 'firefox' });
  });

  it('routes each socks listener of the entry to its own way out, Auto over all of them', () => {
    const cfg = renderChainConfig(entryInput) as Cfg;
    const routed = cfg.route.rules.filter((r) => r.action === 'route' && Array.isArray(r.inbound));
    expect(routed.map((r) => [(r.inbound as string[])[0], r.outbound])).toEqual([
      ['in-d0', 'out-d0'],
      ['in-d1', 'out-d1'],
      ['in-d2', 'out-d2'],
      ['in-d3', 'out-d3'],
      ['in-d4', 'out-d4'],
    ]);
    const auto = cfg.outbounds.find((o) => o.tag === 'out-d0')!;
    expect(auto.type).toBe('urltest');
    expect(auto.outbounds).toEqual(['out-d1', 'out-d2', 'out-d3', 'out-d4']);
  });

  it('sends each direction on from the transit by the credential it arrived on', () => {
    const cfg = renderChainConfig(transitInput) as Cfg;
    const byUser = cfg.route.rules.filter((r) => Array.isArray(r.auth_user));
    expect(byUser.map((r) => [(r.auth_user as string[])[0], r.outbound])).toEqual([
      ['lnk-d1', 'out-d1'],
      ['lnk-d2', 'out-d2'],
      ['lnk-d3', 'out-d3'],
      ['lnk-d4', 'out-d4'],
    ]);
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
  const dir = mkdtempSync(join(tmpdir(), `iceslab-foreign-${name}-`));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  const child = spawn(SINGBOX_BIN, ['run', '-c', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr!.on('data', (d: Buffer) => (out += d.toString()));
  return { log: () => `--- ${name}\n${out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(-15).join('\n')}` };
}

async function stopAll(): Promise<void> {
  await Promise.all(
    children.splice(0).map(
      (c) =>
        new Promise<void>((resolve) => {
          if (c.exitCode !== null || c.signalCode !== null) return resolve();
          c.once('exit', () => resolve());
          c.kill('SIGKILL');
        }),
    ),
  );
}

/**
 * The "foreign" server: a socks5 proxy with a login, written here so the test
 * can COUNT what came through it. A reply with the nonce proves the request
 * reached the page; the count proves it went through this server and not out
 * of the chain's own `direct`, which on loopback reaches the page just as well.
 */
async function foreignSocks(
  user: string,
  pass: string,
  /** Only connections to the page count: Auto's probe to its URL goes out
   *  through the same outbounds and would otherwise count as a request. */
  targetPort: number,
): Promise<{ port: number; hits: () => number; close: () => void }> {
  let hits = 0;
  const server = createTcpServer((client: Socket) => {
    let buf = Buffer.alloc(0);
    let stage = 0;
    client.on('error', () => client.destroy());
    const onData = (d: Buffer): void => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (stage === 0) {
          if (buf.length < 2 || buf.length < 2 + buf[1]!) return;
          const methods = buf.subarray(2, 2 + buf[1]!);
          buf = buf.subarray(2 + buf[1]!);
          if (!methods.includes(2)) return void client.end(Buffer.from([5, 0xff]));
          client.write(Buffer.from([5, 2]));
          stage = 1;
          continue;
        }
        if (stage === 1) {
          if (buf.length < 2) return;
          const ul = buf[1]!;
          if (buf.length < 3 + ul) return;
          const pl = buf[2 + ul]!;
          if (buf.length < 3 + ul + pl) return;
          const u = buf.subarray(2, 2 + ul).toString();
          const p = buf.subarray(3 + ul, 3 + ul + pl).toString();
          buf = buf.subarray(3 + ul + pl);
          if (u !== user || p !== pass) return void client.end(Buffer.from([1, 1]));
          client.write(Buffer.from([1, 0]));
          stage = 2;
          continue;
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
        const up = connect(port, host, () => {
          if (port === targetPort) hits += 1;
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          if (rest.length > 0) up.write(rest);
          client.pipe(up);
          up.pipe(client);
          client.resume();
        });
        up.on('error', () => client.destroy());
        return;
      }
    };
    client.on('data', onData);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { port: (server.address() as AddressInfo).port, hits: () => hits, close: () => server.close() };
}

/** One GET through a socks5 listener of the entry, as the hand-off user. */
function getThroughSocks(socksPort: number, password: string, target: number): Promise<string> {
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
        sock.write(Buffer.concat([Buffer.from([5, 1, 0, 1, 127, 0, 0, 1]), port]));
        buf = buf.subarray(2);
        stage = 2;
      }
      if (stage === 2 && buf.length >= 10) {
        if (buf[1] !== 0) return sock.destroy(new Error(`socks connect refused, code ${buf[1]}`));
        sock.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${target}\r\nConnection: close\r\n\r\n`);
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

/**
 * Live, phase 10: a request leaves the chain through a server that is not
 * ours, one per type the set allows.
 *
 *   client -> socks of the ENTRY -> [leg -> TRANSIT] -> foreign -> local HTTP
 *
 * The socks foreign server is the counting proxy above. The vless one is a
 * sing-box vless listener whose only way on is a second counting proxy, so a
 * count there proves the request crossed the vless hop. Everything is on
 * loopback, the leg included (vless without REALITY, the shape a leg stored
 * before 5b has): no internet needed.
 */
describe('a request through a named outbound, live', () => {
  let http: Server;
  let httpPort = 0;
  const nonce = randomBytes(8).toString('hex');
  const login = { user: 'op', pass: randomBytes(8).toString('hex') };

  async function setup() {
    http = createHttpServer((_req, res) => res.end(nonce));
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()));
    httpPort = (http.address() as AddressInfo).port;
    const viaSocks = await foreignSocks(login.user, login.pass, httpPort);
    const behindVless = await foreignSocks(login.user, login.pass, httpPort);
    const vlessPort = await freePort();
    const vlessUuid = randomUUID();
    const vlessServer = {
      log: { level: 'warn' },
      inbounds: [{ type: 'vless', tag: 'in', listen: '127.0.0.1', listen_port: vlessPort, users: [{ uuid: vlessUuid }] }],
      outbounds: [
        {
          type: 'socks',
          tag: 'up',
          server: '127.0.0.1',
          server_port: behindVless.port,
          version: '5',
          username: login.user,
          password: login.pass,
        },
      ],
      route: { final: 'up' },
    };
    const foreign: ChainForeignOut[] = [
      { tag: 1, type: 'socks', config: { server: '127.0.0.1', port: viaSocks.port, username: login.user, password: login.pass } },
      { tag: 2, type: 'vless', config: { server: '127.0.0.1', port: vlessPort, uuid: vlessUuid, flow: null, security: 'none' } },
    ];
    return { viaSocks, behindVless, vlessServer, foreign };
  }

  /** The entry's socks listeners moved to free ports, by tag. */
  async function entryWithPorts(input: ChainRenderInput) {
    const cfg = renderChainConfig(input) as { inbounds: { type: string; tag: string; listen_port: number }[] };
    const ports = new Map<number, number>();
    for (const i of cfg.inbounds) {
      if (i.type !== 'socks') continue;
      const port = await freePort();
      ports.set(Number(i.tag.replace('in-d', '')), port);
      i.listen_port = port;
    }
    return { cfg, ports };
  }

  async function ask(ports: Map<number, number>, tag: number, password: string) {
    const body = await eventually(() => getThroughSocks(ports.get(tag)!, password, httpPort), 15000);
    expect(body).toContain(nonce);
  }

  it.skipIf(!SINGBOX_BIN)(
    'from the entry itself, when it is the last position',
    async () => {
      const s = await setup();
      const password = randomBytes(12).toString('hex');
      const { cfg, ports } = await entryWithPorts({ role: 'entry', socksPassword: password, directionTags: [0, 1, 2], out: [], foreign: s.foreign });
      const logs = [run('vless-foreign', s.vlessServer), run('entry', cfg)];
      try {
        await ask(ports, 1, password);
        expect(s.viaSocks.hits()).toBe(1);
        await ask(ports, 2, password);
        expect(s.behindVless.hits()).toBe(1);
        // Auto picks one of the two, and it is one of the two: never `direct`.
        await ask(ports, 0, password);
        expect(s.viaSocks.hits() + s.behindVless.hits()).toBe(3);
      } catch (err) {
        throw new Error(`${(err as Error).message}\n${logs.map((l) => l.log()).join('\n')}`);
      } finally {
        await stopAll();
        s.viaSocks.close();
        s.behindVless.close();
        http.close();
      }
    },
    60000,
  );

  it.skipIf(!SINGBOX_BIN)(
    'from a transit on the last position, each direction by the leg it arrived on',
    async () => {
      const s = await setup();
      const password = randomBytes(12).toString('hex');
      const linkPort = await freePort();
      const legs: LinkCred[] = [1, 2].map(() => ({ protocol: 'vless', port: linkPort, uuid: randomUUID() }));
      const { cfg: entry, ports } = await entryWithPorts({
        role: 'entry',
        socksPassword: password,
        directionTags: [1, 2],
        out: legs.map((cred, i) => ({ tag: i + 1, host: '127.0.0.1', cred })),
      });
      const transit = renderChainConfig({
        role: 'transit',
        socksPassword: password,
        in: {
          cred: legs[0]!,
          clients: legs.map((cred, i) => ({ tag: i + 1, uuid: (cred as { uuid: string }).uuid })),
        },
        out: [],
        foreign: s.foreign,
      });
      const logs = [run('vless-foreign', s.vlessServer), run('transit', transit), run('entry', entry)];
      try {
        await ask(ports, 1, password);
        expect([s.viaSocks.hits(), s.behindVless.hits()]).toEqual([1, 0]);
        await ask(ports, 2, password);
        expect([s.viaSocks.hits(), s.behindVless.hits()]).toEqual([1, 1]);
      } catch (err) {
        throw new Error(`${(err as Error).message}\n${logs.map((l) => l.log()).join('\n')}`);
      } finally {
        await stopAll();
        s.viaSocks.close();
        s.behindVless.close();
        http.close();
      }
    },
    60000,
  );
});
