import { connect as netConnect } from 'node:net';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { REALITY_RECORD_LIMIT, REALITY_TARGET_SUGGESTIONS } from '@iceslab/shared';

/**
 * What a REALITY target sends back to one ClientHello, measured record by
 * record, and whether a REALITY listener could relay it.
 *
 * ⚠ The rule this exists for is invisible from outside, and E23 is what it
 * cost: the listener relays the target's first flight and gives up on any
 * handshake record over 8192 bytes, header included. metacubex/utls v1.8.4
 * reality.go:72 and :473 in sing-box 1.13.14, xtls/reality tls.go:140 and :334
 * in xray 26.3.27. www.microsoft.com sends its Certificate as one 8273-byte
 * record: the target resolves, speaks TLS 1.3 and h2, passes every check the
 * dest probe had, and not one handshake completes.
 *
 * The ordinary TLS probe cannot see this: past the ServerHello every record is
 * encrypted, and a TLS library hands back the decrypted messages, not the
 * records they came in. So this speaks TLS by hand up to the point where the
 * sizes are visible, and never further: it sends a ClientHello, reads what
 * comes back until the server stops (it is waiting for our Finished, which
 * never comes), and closes.
 *
 * The ClientHello carries ONE key share, X25519, like the check the listener
 * makes on the ServerHello: a target that answers with anything else, or asks
 * for another share (HelloRetryRequest), fails the listener too. It offers no
 * certificate compression, which is the conservative case: a client
 * fingerprint that does not offer it (firefox, the panel's default) gets the
 * uncompressed chain, and that is the size the listener has to relay.
 *
 * The limit and the targets named in a refusal live in @iceslab/shared
 * (reality.ts), with the anchors on both engines, so the screen reads the same
 * number the probe judges by.
 */

const X25519 = 0x001d;
const X25519MLKEM768 = 0x11ec;
const TLS13 = 0x0304;
/** The ServerHello.random a HelloRetryRequest carries (RFC 8446 4.1.3). */
const HRR_RANDOM = Buffer.from('cf21ad74e59a6111be1d8c021e65b891c2a211167abb8c5e079e09e2c8a8339c', 'hex');

export interface ServerFlight {
  /** Absent when no ServerHello arrived at all. */
  serverHello?: { version: number | null; group: number | null; shareLen: number; cipher: number; retry: boolean };
  /** Every record after the ServerHello record, full length with the 5-byte header. */
  records: { type: number; length: number }[];
  /** The ServerHello record itself, same measure. */
  helloLength?: number;
  /** Description byte of an alert, if the server sent one. */
  alert?: number;
}

const u16 = (b: number) => Buffer.from([(b >> 8) & 0xff, b & 0xff]);
const vec8 = (b: Buffer) => Buffer.concat([Buffer.from([b.length]), b]);
const vec16 = (b: Buffer) => Buffer.concat([u16(b.length), b]);
const ext = (type: number, body: Buffer) => Buffer.concat([u16(type), vec16(body)]);

/** A TLS 1.3 ClientHello for `sni`, as a complete record. */
export function buildClientHello(sni: string): Buffer {
  const { publicKey } = generateKeyPairSync('x25519');
  const share = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  const name = Buffer.from(sni, 'ascii');
  const extensions = Buffer.concat([
    ext(0x0000, vec16(Buffer.concat([Buffer.from([0]), vec16(name)]))),
    ext(0x0017, Buffer.alloc(0)),
    ext(0xff01, Buffer.from([0])),
    ext(0x000a, vec16(Buffer.concat([u16(X25519), u16(0x0017), u16(0x0018)]))),
    ext(0x000b, vec8(Buffer.from([0]))),
    ext(0x0023, Buffer.alloc(0)),
    // ⚠ MEASURED, not decoration: both browser fingerprints ask for the OCSP
    // staple and the SCTs, and a target that has them puts them INSIDE the
    // Certificate record. Without these two, www.microsoft.com measures 5924
    // bytes and passes; with them it is the 8273 that kills the handshake.
    ext(0x0005, Buffer.from([1, 0, 0, 0, 0])),
    ext(0x0012, Buffer.alloc(0)),
    // What browsers offer, so a target holding an ECDSA and an RSA chain picks
    // the one it would pick for a real client.
    ext(
      0x000d,
      vec16(
        Buffer.concat(
          [0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0501, 0x0806, 0x0601].map(u16),
        ),
      ),
    ),
    ext(0x0010, vec16(Buffer.concat([vec8(Buffer.from('h2')), vec8(Buffer.from('http/1.1'))]))),
    ext(0x002b, vec8(Buffer.concat([u16(TLS13), u16(0x0303)]))),
    ext(0x002d, vec8(Buffer.from([1]))),
    ext(0x0033, vec16(Buffer.concat([u16(X25519), vec16(share)]))),
  ]);
  const body = Buffer.concat([
    u16(0x0303),
    randomBytes(32),
    vec8(randomBytes(32)),
    vec16(Buffer.concat([0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9, 0xcca8].map(u16))),
    vec8(Buffer.from([0])),
    vec16(extensions),
  ]);
  const handshake = Buffer.concat([Buffer.from([1, body.length >> 16, (body.length >> 8) & 0xff, body.length & 0xff]), body]);
  return Buffer.concat([Buffer.from([0x16, 0x03, 0x01]), u16(handshake.length), handshake]);
}

/**
 * Split what the server sent into records and read the ServerHello. Pure, so
 * the verdict can be tested on bytes rather than on somebody's website.
 * A trailing partial record is ignored: it is the flight still arriving.
 */
export function parseServerFlight(buf: Buffer): ServerFlight {
  const flight: ServerFlight = { records: [] };
  let p = 0;
  while (p + 5 <= buf.length) {
    const type = buf[p]!;
    const len = buf.readUInt16BE(p + 3);
    if (p + 5 + len > buf.length) break;
    const body = buf.subarray(p + 5, p + 5 + len);
    if (type === 21 && body.length >= 2) flight.alert = body[1];
    if (!flight.serverHello && type === 22 && body[0] === 2) {
      flight.serverHello = readServerHello(body);
      flight.helloLength = 5 + len;
    } else if (flight.serverHello) {
      flight.records.push({ type, length: 5 + len });
    }
    p += 5 + len;
  }
  return flight;
}

function readServerHello(msg: Buffer): NonNullable<ServerFlight['serverHello']> {
  const out = { version: null as number | null, group: null as number | null, shareLen: 0, cipher: 0, retry: false };
  try {
    let p = 4 + 2;
    out.retry = msg.subarray(p, p + 32).equals(HRR_RANDOM);
    p += 32;
    p += 1 + msg[p]!;
    out.cipher = msg.readUInt16BE(p);
    p += 2 + 1;
    const end = p + 2 + msg.readUInt16BE(p);
    p += 2;
    while (p + 4 <= end) {
      const t = msg.readUInt16BE(p);
      const l = msg.readUInt16BE(p + 2);
      if (t === 0x002b) out.version = msg.readUInt16BE(p + 4);
      if (t === 0x0033) {
        out.group = msg.readUInt16BE(p + 4);
        // A HelloRetryRequest names only the group, with no share after it.
        if (l >= 4) out.shareLen = msg.readUInt16BE(p + 6);
      }
      p += 4 + l;
    }
  } catch {
    // A ServerHello too short to read: the checks below refuse it as such.
  }
  return out;
}

/**
 * Whether a REALITY listener can relay this flight, and if not, why, in words
 * an operator can act on. Undefined means it can.
 */
export function realityFlightRefusal(flight: ServerFlight): string | undefined {
  const sh = flight.serverHello;
  if (!sh) {
    return flight.alert !== undefined
      ? `the target answered with TLS alert ${flight.alert} instead of a ServerHello`
      : 'the target sent no ServerHello';
  }
  if (sh.retry) {
    return 'the target asked for another key share (HelloRetryRequest); REALITY needs it to answer X25519 at once';
  }
  if (sh.version !== TLS13) return 'the target did not negotiate TLS 1.3';
  const x25519 = sh.group === X25519 && sh.shareLen === 32;
  const hybrid = sh.group === X25519MLKEM768;
  if (!x25519 && !hybrid) {
    return `the target answered with key share group 0x${(sh.group ?? 0).toString(16)}, REALITY needs X25519`;
  }
  const largest = Math.max(flight.helloLength ?? 0, ...flight.records.map((r) => r.length));
  if (largest > REALITY_RECORD_LIMIT) {
    return (
      `the target sends a handshake record of ${largest} bytes and REALITY gives up above ` +
      `${REALITY_RECORD_LIMIT} (sing-box 1.13.14 and xray 26.3.27 alike): every handshake through it fails. ` +
      `Pick another target, for example one of ${REALITY_TARGET_SUGGESTIONS.join(', ')} (measured to pass).`
    );
  }
  return undefined;
}

/**
 * Send one ClientHello to `host:port` and collect the flight: until the server
 * falls quiet for `idleMs`, sends an alert, or `timeoutMs` passes. Never
 * throws; a network failure comes back as `error`.
 */
export function measureRealityFlight(
  host: string,
  port: number,
  sni: string,
  opts: { timeoutMs?: number; idleMs?: number } = {},
): Promise<{ flight?: ServerFlight; error?: string }> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const idleMs = opts.idleMs ?? 700;
  return new Promise((resolve) => {
    const sock = netConnect({ host, port });
    let buf = Buffer.alloc(0);
    let idle: NodeJS.Timeout | undefined;
    let settled = false;
    const done = (r: { flight?: ServerFlight; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      if (idle) clearTimeout(idle);
      sock.destroy();
      resolve(r);
    };
    const finish = () => done({ flight: parseServerFlight(buf) });
    const overall = setTimeout(() => (buf.length > 0 ? finish() : done({ error: `no answer within ${timeoutMs}ms` })), timeoutMs);
    sock.once('connect', () => sock.write(buildClientHello(sni)));
    sock.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length > 256 * 1024) return finish();
      if (idle) clearTimeout(idle);
      idle = setTimeout(finish, idleMs);
    });
    sock.once('end', finish);
    sock.once('error', (err) => (buf.length > 0 ? finish() : done({ error: err.message })));
  });
}
