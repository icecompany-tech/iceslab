import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:tls';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { REALITY_RECORD_LIMIT, REALITY_TARGET_SUGGESTIONS } from '@iceslab/shared';
import {
  buildClientHello,
  measureRealityFlight,
  parseServerFlight,
  realityFlightRefusal,
} from './reality-dest-flight.js';
import { withFlight, type ProbeResult } from './test-connect.service.js';
import { generateLinkTls } from '../cascades/link-tls.js';

/**
 * The dest probe measures what a REALITY listener has to relay, E23.
 *
 * Two halves. The verdict is checked on bytes built here, so every rule has a
 * case that fails it. The measuring is checked against a real TLS 1.3 server on
 * loopback holding a short chain and a long one, so the sizes are the ones a
 * TLS stack actually puts on the wire, not the ones this file expects.
 */

const HRR = Buffer.from('cf21ad74e59a6111be1d8c021e65b891c2a211167abb8c5e079e09e2c8a8339c', 'hex');
const u16 = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const record = (type: number, body: Buffer) => Buffer.concat([Buffer.from([type, 3, 3]), u16(body.length), body]);

function serverHello(opts: { group?: number; share?: number; version?: number; retry?: boolean } = {}): Buffer {
  const { group = 0x001d, share = 32, version = 0x0304, retry = false } = opts;
  const keyShare = retry ? u16(group) : Buffer.concat([u16(group), u16(share), randomBytes(share)]);
  const exts = Buffer.concat([
    u16(0x002b), u16(2), u16(version),
    u16(0x0033), u16(keyShare.length), keyShare,
  ]);
  const body = Buffer.concat([
    u16(0x0303),
    retry ? HRR : randomBytes(32),
    Buffer.from([32]), randomBytes(32),
    u16(0x1302),
    Buffer.from([0]),
    u16(exts.length), exts,
  ]);
  const msg = Buffer.concat([Buffer.from([2, 0, body.length >> 8, body.length & 0xff]), body]);
  return record(22, msg);
}

/** A first flight whose encrypted records have these payload sizes. */
function flight(payloads: number[], hello = serverHello()): Buffer {
  return Buffer.concat([hello, record(20, Buffer.from([1])), ...payloads.map((n) => record(23, randomBytes(n)))]);
}

describe('the verdict on a first flight', () => {
  it('refuses the flight www.microsoft.com sends, and names a target that works', () => {
    // The E23 sizes as sing-box logged them: Certificate 8268 + 5.
    const f = parseServerFlight(flight([48, 8268, 281, 69]));
    expect(Math.max(...f.records.map((r) => r.length))).toBe(8273);
    const why = realityFlightRefusal(f);
    expect(why).toContain('8273');
    expect(why).toContain(String(REALITY_RECORD_LIMIT));
    for (const target of REALITY_TARGET_SUGGESTIONS) expect(why).toContain(target);
  });

  it('accepts the flight www.apple.com sends', () => {
    expect(realityFlightRefusal(parseServerFlight(flight([48, 4733, 281, 69])))).toBeUndefined();
  });

  it('draws the line exactly where the listener does: 8192 with the header passes, 8193 does not', () => {
    expect(realityFlightRefusal(parseServerFlight(flight([8192 - 5])))).toBeUndefined();
    expect(realityFlightRefusal(parseServerFlight(flight([8193 - 5])))).toContain('8193');
  });

  it('refuses a HelloRetryRequest, a group that is not X25519, and TLS 1.2', () => {
    expect(realityFlightRefusal(parseServerFlight(flight([100], serverHello({ retry: true }))))).toContain(
      'HelloRetryRequest',
    );
    expect(
      realityFlightRefusal(parseServerFlight(flight([100], serverHello({ group: 0x0017, share: 65 })))),
    ).toContain('X25519');
    expect(realityFlightRefusal(parseServerFlight(flight([100], serverHello({ version: 0x0303 }))))).toContain(
      'TLS 1.3',
    );
  });

  it('refuses an answer that is an alert, or nothing', () => {
    expect(realityFlightRefusal(parseServerFlight(record(21, Buffer.from([2, 40]))))).toContain('alert 40');
    expect(realityFlightRefusal(parseServerFlight(Buffer.alloc(0)))).toContain('no ServerHello');
  });

  it('ignores a record still arriving rather than guessing its size', () => {
    const whole = flight([48, 4000]);
    const f = parseServerFlight(whole.subarray(0, whole.length - 10));
    expect(f.records.map((r) => r.length)).toEqual([6, 53]);
  });
});

describe('the ClientHello the probe sends', () => {
  it('asks for the OCSP staple and the SCTs, or the Certificate record is measured short', () => {
    /**
     * ⚠ The finding the probe rests on. Both browser fingerprints ask for
     * these, and a target that has them puts them INSIDE the Certificate
     * record: www.microsoft.com measured 5924 bytes without them and 8273 with
     * them, 2026-09-24. A probe without these two would have passed E23.
     */
    const hello = buildClientHello('www.example.com');
    const types: number[] = [];
    const h = hello.subarray(5);
    let p = 4 + 2 + 32;
    p += 1 + h[p]!;
    p += 2 + h.readUInt16BE(p);
    p += 1 + h[p]!;
    const end = p + 2 + h.readUInt16BE(p);
    p += 2;
    while (p < end) {
      types.push(h.readUInt16BE(p));
      p += 4 + h.readUInt16BE(p + 2);
    }
    expect(types).toContain(0x0005);
    expect(types).toContain(0x0012);
    // One key share, X25519, as the listener requires of the answer.
    expect(types).toContain(0x0033);
    expect(hello.includes(Buffer.from('www.example.com'))).toBe(true);
  });
});

describe('measuring a real TLS 1.3 server', () => {
  let short: Server;
  let long: Server;
  const portOf = (s: Server) => (s.address() as AddressInfo).port;

  beforeAll(async () => {
    const tls = await generateLinkTls();
    // Concatenated PEMs need the newline between them, or OpenSSL reads a
    // "bad end line".
    const certPem = tls.certPem.endsWith('\n') ? tls.certPem : `${tls.certPem}\n`;
    const keyPem = tls.keyPem;
    const listen = (cert: string) =>
      new Promise<Server>((resolve) => {
        const s = createServer({ cert, key: keyPem, minVersion: 'TLSv1.3' });
        s.listen(0, '127.0.0.1', () => resolve(s));
      });
    short = await listen(certPem);
    // The same certificate sent ten more times as "chain": all a stack needs to
    // put a Certificate record over the limit, as a long real chain does.
    long = await listen(certPem + certPem.repeat(10));
  });

  afterAll(() => {
    short?.close();
    long?.close();
  });

  it('passes a server with a short chain', async () => {
    const m = await measureRealityFlight('127.0.0.1', portOf(short), 'localhost');
    expect(m.error).toBeUndefined();
    expect(realityFlightRefusal(m.flight!)).toBeUndefined();
  });

  it('refuses a server whose Certificate record is over the limit', async () => {
    const m = await measureRealityFlight('127.0.0.1', portOf(long), 'localhost');
    const largest = Math.max(...m.flight!.records.map((r) => r.length));
    expect(largest).toBeGreaterThan(REALITY_RECORD_LIMIT);
    expect(realityFlightRefusal(m.flight!)).toContain(String(largest));
  });

  it('says why when nothing answers, without throwing', async () => {
    const closed = await new Promise<number>((resolve) => {
      const s = createServer({});
      s.listen(0, '127.0.0.1', () => {
        const p = portOf(s);
        s.close(() => resolve(p));
      });
    });
    const m = await measureRealityFlight('127.0.0.1', closed, 'localhost', { timeoutMs: 2000 });
    expect(m.flight).toBeUndefined();
    expect(m.error).toBeTruthy();
  });
});

describe('the dest row of test-connect', () => {
  const row: ProbeResult = {
    bindingId: 'reality-dest',
    hostId: null,
    hostRemark: 'REALITY dest',
    protocol: 'xray',
    nodeName: '-',
    endpoint: 'www.microsoft.com',
    port: 443,
    probe: 'tls',
    kind: 'dest',
    ok: true,
    tlsVersion: 'TLSv1.3',
  };

  it('turns red on a flight the listener cannot relay, with the reason', () => {
    const r = withFlight(row, { flight: parseServerFlight(flight([48, 8268, 281, 69])) });
    expect(r.ok).toBe(false);
    expect(r.handshakeRecordMax).toBe(8273);
    expect(r.error).toContain('REALITY dest');
    expect(r.error).toContain(REALITY_TARGET_SUGGESTIONS[0]);
  });

  it('stays as the TLS probe left it when the flight could not be read', () => {
    expect(withFlight(row, { error: 'no answer within 5000ms' })).toEqual(row);
  });

  it('records the size on a flight that passes', () => {
    const r = withFlight(row, { flight: parseServerFlight(flight([48, 4733, 281, 69])) });
    expect(r.ok).toBe(true);
    expect(r.handshakeRecordMax).toBe(4738);
  });
});
