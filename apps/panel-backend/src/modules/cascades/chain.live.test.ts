import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, connect, type AddressInfo, type Socket } from 'node:net';
import { createSocket } from 'node:dgram';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { LINK_CELLS, type LinkCell } from '@iceslab/shared';
import { renderChainConfig } from './chain.config.js';
import { CHAIN_SOCKS_USER } from './chain.ports.js';
import { newLinkCred } from './cascade.config.js';

/**
 * Every leg cell, carrying a real request between two real sing-box processes.
 *
 * ⚠ `sing-box check` on both ends is not a leg test, and E23 is the proof: a
 * vless leg whose REALITY target sent a certificate record over the engine's
 * 8192-byte limit loaded on both nodes, passed `check` on both, and refused
 * every handshake on the stand. Nothing short of a packet going through finds
 * that class, so this file sends one per cell:
 *
 *   curl-like client -> socks of the ENTRY -> leg -> EXIT -> local HTTP server
 *
 * Both configs are the panel's own render of freshly minted credentials, the
 * same call a save makes. Only the ports are moved to free ones, so a run does
 * not depend on 24000 or 26001 being idle on the machine.
 *
 * The vless cell dials its camouflage target FOR REAL (the listener relays the
 * handshake to it), so it needs the internet; that is the point, a target is
 * only known to work by asking it. The other cells stay on loopback.
 *
 * Skips without SINGBOX_BIN like the other engine tests. CI installs the binary.
 */
const SINGBOX_BIN =
  process.env.SINGBOX_BIN ??
  ['/usr/local/bin/sing-box', '/usr/bin/sing-box'].find((p) => existsSync(p)) ??
  '';

const children: ChildProcess[] = [];
afterAll(() => {
  for (const c of children) c.kill('SIGKILL');
});

/** A TCP port nobody holds right now, also free on UDP for the QUIC cells. */
async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const s = createTcpServer();
      s.once('error', reject);
      s.listen(0, '0.0.0.0', () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    const udpFree = await new Promise<boolean>((resolve) => {
      const u = createSocket('udp4');
      u.once('error', () => resolve(false));
      u.bind(port, '0.0.0.0', () => u.close(() => resolve(true)));
    });
    if (udpFree) return port;
  }
  throw new Error('no free port');
}

/** Runs one sing-box on a config, keeping its output for the failure message. */
function run(name: string, config: unknown): { log: () => string } {
  const dir = mkdtempSync(join(tmpdir(), `iceslab-live-${name}-`));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  const child = spawn(SINGBOX_BIN, ['run', '-c', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr!.on('data', (d: Buffer) => (out += d.toString()));
  return { log: () => `--- ${name}\n${out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(-15).join('\n')}` };
}

/**
 * One HTTP GET through a socks5 listener with username/password, by IP, so the
 * request does not depend on any resolver. Node has no socks client and this
 * is the whole protocol the test needs.
 */
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
        if (buf[1] !== 2) return sock.destroy(new Error(`socks method ${buf[1]}`));
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

async function eventually(fn: () => Promise<string>, ms: number): Promise<string> {
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

describe('a leg carries a request between two engines', () => {
  let http: Server;
  let httpPort = 0;
  const nonce = randomBytes(8).toString('hex');

  it.skipIf(!SINGBOX_BIN)('has a destination to reach', async () => {
    http = createHttpServer((_req, res) => res.end(nonce));
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()));
    httpPort = (http.address() as AddressInfo).port;
    expect(httpPort).toBeGreaterThan(0);
  });

  for (const cell of LINK_CELLS as readonly LinkCell[]) {
    it.skipIf(!SINGBOX_BIN)(
      `through ${cell}`,
      async () => {
        const linkPort = await freePort();
        const socksPort = await freePort();
        const password = randomBytes(12).toString('hex');
        const cred = await newLinkCred(cell, linkPort);
        const shortId = cred.protocol === 'vless' ? cred.reality?.shortId : undefined;
        const uuid = cred.protocol === 'vless' ? cred.uuid : undefined;

        const entry = renderChainConfig({
          role: 'entry',
          socksPassword: password,
          directionTags: [1],
          out: [{ tag: 1, host: '127.0.0.1', cred }],
          policy: null,
        }) as { inbounds: { type: string; listen_port: number }[] };
        for (const i of entry.inbounds) if (i.type === 'socks') i.listen_port = socksPort;

        const exit = renderChainConfig({
          role: 'exit',
          socksPassword: password,
          in: { cred, clients: [{ tag: 1, uuid, shortId }] },
          policy: null,
        });

        const exitRun = run(`${cell}-exit`, exit);
        const entryRun = run(`${cell}-entry`, entry);
        try {
          const body = await eventually(() => getThroughSocks(socksPort, password, httpPort), 15000);
          expect(body, `${exitRun.log()}\n${entryRun.log()}`).toContain(nonce);
        } catch (err) {
          throw new Error(`${cell}: ${(err as Error).message}\n${exitRun.log()}\n${entryRun.log()}`);
        } finally {
          for (const c of children.splice(0)) c.kill('SIGKILL');
        }
      },
      30000,
    );
  }

  afterAll(() => http?.close());
});
