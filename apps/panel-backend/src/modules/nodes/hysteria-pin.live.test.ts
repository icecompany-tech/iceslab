import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, connect, type AddressInfo, type Socket } from 'node:net';
import { createSocket } from 'node:dgram';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mintHysteriaTls } from './hysteria-tls.js';
import type { StoredHysteriaTls } from './hysteria-tls-shape.js';
import { buildHysteriaUri } from '../../core-adapters/hysteria/uri.js';
import { buildSingboxJson } from '../subscription/formats/singbox.js';
import { buildXrayJsonArray } from '../subscription/formats/xrayjson.js';
import type { HysteriaSubscriptionEndpoint } from '../subscription/subscription.formats.js';

/**
 * E30a, live: native hysteria serving the panel's self-signed pair, and a real
 * client of each kind dialling it with what the subscription hands it.
 *
 *   client socks -> client engine -> QUIC to hysteria (the pair) -> local HTTP
 *
 * For each client, the pin from the subscription connects, and a pin for ANY
 * OTHER certificate is refused: a test that only saw the first half could not
 * tell pinning from "accepts everything" (insecure).
 *
 *   hysteria's own client  the hy2 link: insecure=1 + pinSHA256
 *   sing-box               tls.certificate (the PEM) + server_name, insecure off
 *   xray                   tlsSettings.pinnedPeerCertSha256 + serverName
 *
 * The server config is the agent's render for a node addressed by IP (tls:
 * instead of acme:), with password auth in place of the agent's callback.
 * Skips without HYSTERIA_BIN; each client without its own binary.
 */
const HYSTERIA_BIN = process.env.HYSTERIA_BIN ?? '';
const SINGBOX_BIN = process.env.SINGBOX_BIN ?? '';
const XRAY_BIN = process.env.XRAY_BIN ?? '';

const children: ChildProcess[] = [];
afterAll(() => {
  for (const c of children) c.kill('SIGKILL');
});

async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const s = createTcpServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    const udpFree = await new Promise<boolean>((resolve) => {
      const u = createSocket('udp4');
      u.once('error', () => resolve(false));
      u.bind(port, '127.0.0.1', () => u.close(() => resolve(true)));
    });
    if (udpFree) return port;
  }
  throw new Error('no free port');
}

function run(bin: string, args: (file: string) => string[], name: string, body: string): { log: () => string; child: ChildProcess } {
  const dir = mkdtempSync(join(tmpdir(), `iceslab-hy-${name}-`));
  const ext = body.trimStart().startsWith('{') ? 'json' : 'yaml';
  const file = join(dir, `config.${ext}`);
  writeFileSync(file, body);
  const child = spawn(bin, args(file), { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr!.on('data', (d: Buffer) => (out += d.toString()));
  return { child, log: () => `--- ${name}\n${out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(-12).join('\n')}` };
}

const stop = (c: ChildProcess) => new Promise<void>((r) => (c.exitCode !== null ? r() : (c.once('exit', () => r()), c.kill('SIGKILL'))));

/** One HTTP GET through a socks5 listener with username/password. */
function getThroughSocks(socksPort: number, target: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock: Socket = connect(socksPort, '127.0.0.1');
    sock.setTimeout(6000, () => sock.destroy(new Error('socks timeout')));
    let stage = 0;
    let buf = Buffer.alloc(0);
    sock.on('error', reject);
    sock.on('connect', () => sock.write(Buffer.from([5, 1, 2])));
    sock.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 2) {
        if (buf[1] !== 2) return sock.destroy(new Error(`socks method ${buf[1]}`));
        sock.write(Buffer.concat([Buffer.from([1, 1]), Buffer.from('u'), Buffer.from([1]), Buffer.from('p')]));
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

async function eventually(fn: () => Promise<string>, ms: number): Promise<string> {
  const until = Date.now() + ms;
  let last: unknown;
  while (Date.now() < until) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw last;
}

describe.runIf(HYSTERIA_BIN !== '')('native hysteria with the panel pair, pinned by each client', () => {
  const password = randomBytes(12).toString('hex');
  const marker = `hy-pin-${randomBytes(6).toString('hex')}`;
  let pair: StoredHysteriaTls;
  let other: StoredHysteriaTls;
  let hyPort = 0;
  let httpPort = 0;
  let http: Server;
  let server: { log: () => string };

  beforeAll(async () => {
    http = createHttpServer((_req, res) => res.end(marker));
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()));
    httpPort = (http.address() as AddressInfo).port;
    // Minted for 127.0.0.1: on a node the SAN is the node's IP, here the
    // address the clients dial.
    pair = await mintHysteriaTls('127.0.0.1');
    other = await mintHysteriaTls('127.0.0.1');
    hyPort = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'iceslab-hy-pair-'));
    writeFileSync(join(dir, 'iceslab-tls.crt'), pair.certPem);
    writeFileSync(join(dir, 'iceslab-tls.key'), pair.keyPem);
    server = run(
      HYSTERIA_BIN,
      (f) => ['server', '-c', f],
      'server',
      [
        `listen: 127.0.0.1:${hyPort}`,
        '',
        'tls:',
        `  cert: ${join(dir, 'iceslab-tls.crt').replace(/\\/g, '/')}`,
        `  key: ${join(dir, 'iceslab-tls.key').replace(/\\/g, '/')}`,
        '',
        'auth:',
        '  type: password',
        `  password: ${password}`,
        '',
      ].join('\n'),
    );
    await eventually(async () => {
      if (!server.log().includes('server up and running')) throw new Error(`hysteria not up\n${server.log()}`);
      return '';
    }, 10000);
  }, 20000);

  afterAll(() => {
    http?.close();
  });

  const endpoint = (pin: StoredHysteriaTls): HysteriaSubscriptionEndpoint => ({
    protocol: 'hysteria',
    engine: 'hysteria',
    nodeName: 'live',
    nodeId: 'live',
    host: '127.0.0.1',
    port: hyPort,
    uri: '',
    password,
    tlsPin: { certSha256: pin.certSha256, certPem: pin.certPem, serverName: '127.0.0.1' },
  });

  /** Runs one client, asks once through it, stops it. */
  async function through(name: string, start: (socksPort: number) => { log: () => string; child: ChildProcess }): Promise<string> {
    const socksPort = await freePort();
    const client = start(socksPort);
    try {
      const body = await eventually(() => getThroughSocks(socksPort, httpPort), 8000);
      return body;
    } catch (err) {
      // The client's own log only: the refusals below are matched against what
      // the CLIENT said, and the server's words must not satisfy them.
      throw new Error(`${(err as Error).message}\n${client.log()}`);
    } finally {
      await stop(client.child);
    }
  }

  function hysteriaClient(link: string, socksPort: number) {
    const u = new URL(link);
    return run(
      HYSTERIA_BIN,
      (f) => ['client', '-c', f],
      'hy-client',
      [
        `server: ${u.hostname}:${u.port}`,
        `auth: ${decodeURIComponent(u.username)}`,
        'tls:',
        `  insecure: ${u.searchParams.get('insecure') === '1'}`,
        `  pinSHA256: ${u.searchParams.get('pinSHA256')}`,
        'socks5:',
        `  listen: 127.0.0.1:${socksPort}`,
        '  username: u',
        '  password: p',
        '',
      ].join('\n'),
    );
  }

  it('hysteria client, the hy2 link: its pin connects, another pin is refused', async () => {
    const link = (pin: StoredHysteriaTls) =>
      buildHysteriaUri({ password, host: '127.0.0.1', port: hyPort, name: 'live', pinSha256: pin.certSha256 });
    expect(await through('hy-ok', (s) => hysteriaClient(link(pair), s))).toContain(marker);
    await expect(through('hy-bad', (s) => hysteriaClient(link(other), s))).rejects.toThrow(/no certificate matches the pinned hash/);
  }, 40000);

  function singboxClient(pin: StoredHysteriaTls, socksPort: number) {
    const cfg = JSON.parse(buildSingboxJson([endpoint(pin)])) as { outbounds: { type: string; tag: string }[] };
    const hy = cfg.outbounds.find((o) => o.type === 'hysteria2')!;
    return run(
      SINGBOX_BIN,
      (f) => ['run', '-c', f],
      'sb-client',
      JSON.stringify({
        log: { level: 'warn' },
        inbounds: [{ type: 'socks', listen: '127.0.0.1', listen_port: socksPort, users: [{ username: 'u', password: 'p' }] }],
        outbounds: [hy],
        route: { final: hy.tag },
      }),
    );
  }

  it.runIf(SINGBOX_BIN !== '')('sing-box, tls.certificate: the pair connects, another certificate is refused', async () => {
    expect(await through('sb-ok', (s) => singboxClient(pair, s))).toContain(marker);
    await expect(through('sb-bad', (s) => singboxClient(other, s))).rejects.toThrow(/failed to verify certificate/);
  }, 40000);

  function xrayClient(pin: StoredHysteriaTls, socksPort: number) {
    const configs = JSON.parse(buildXrayJsonArray([endpoint(pin)])) as { outbounds: { protocol: string }[] }[];
    const hy = configs.flatMap((c) => c.outbounds).find((o) => o.protocol === 'hysteria')!;
    return run(
      XRAY_BIN,
      (f) => ['run', '-c', f],
      'xray-client',
      JSON.stringify({
        // debug: xray says why an outbound failed only there, and the refusal
        // below is matched against those words.
        log: { loglevel: 'debug' },
        inbounds: [
          {
            listen: '127.0.0.1',
            port: socksPort,
            protocol: 'socks',
            settings: { auth: 'password', accounts: [{ user: 'u', pass: 'p' }], udp: false },
          },
        ],
        outbounds: [{ ...hy, tag: 'proxy' }],
      }),
    );
  }

  it.runIf(XRAY_BIN !== '')('xray, pinnedPeerCertSha256: the pin connects, another pin is refused', async () => {
    expect(await through('xray-ok', (s) => xrayClient(pair, s))).toContain(marker);
    await expect(through('xray-bad', (s) => xrayClient(other, s))).rejects.toThrow(/peer cert is/);
  }, 40000);
});
