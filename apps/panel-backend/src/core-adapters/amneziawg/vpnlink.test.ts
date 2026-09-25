import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AMNEZIA_QR_MAGIC,
  amneziaQrChunkFromKey,
  buildAmneziaVpnLink,
  encodeAmneziaQrChunk,
  encodeAmneziaVpnKey,
} from './vpnlink.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__testdata__');

// Mirror of Qt qUncompress: strip "vpn://", base64url-decode, read the 4-byte
// big-endian uncompressed-length header, inflate from byte 4, and verify the
// length matches (the exact integrity check the app performs). Returns the
// parsed JSON envelope.
function decodeVpnKey(key: string): unknown {
  expect(key.startsWith('vpn://')).toBe(true);
  const buf = Buffer.from(key.slice('vpn://'.length), 'base64url');
  const expectedLen = buf.readUInt32BE(0);
  const json = inflateSync(buf.subarray(4));
  expect(json.length).toBe(expectedLen); // app rejects a mismatch as "corrupted"
  return JSON.parse(json.toString('utf8'));
}

const baseOpts = {
  privateKey: 'cliPriv64',
  allowedIp: '10.66.66.2/32',
  serverPublicKey: 'srvPub64',
  host: 'de.example.com',
  port: 51820,
  jc: 4,
  jmin: 40,
  jmax: 70,
  s1: 0,
  s2: 0,
  s3: 0,
  s4: 0,
  h1: 1111111111,
  h2: 2222222222,
  h3: 3333333333,
  h4: 4444444444,
};

describe('encodeAmneziaVpnKey', () => {
  it('round-trips a JSON object through the qCompress-compatible pipeline', () => {
    const obj = { a: 1, b: 'hello', nested: { c: [1, 2, 3] } };
    const key = encodeAmneziaVpnKey(obj);
    expect(key).toMatch(/^vpn:\/\/[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(key).not.toContain('='); // OmitTrailingEquals
    expect(decodeVpnKey(key)).toEqual(obj);
  });
});

describe('buildAmneziaVpnLink', () => {
  it('produces a vpn:// key with the container envelope the app requires', () => {
    const key = buildAmneziaVpnLink(baseOpts);
    const env = decodeVpnKey(key) as Record<string, unknown>;

    // Outer envelope: the structure whose absence is half of "error 900".
    expect(env.defaultContainer).toBe('amnezia-awg');
    expect(env.hostName).toBe('de.example.com');
    const containers = env.containers as Array<Record<string, unknown>>;
    expect(containers).toHaveLength(1);
    expect(containers[0]!.container).toBe('amnezia-awg');

    const awg = containers[0]!.awg as Record<string, unknown>;
    expect(awg.port).toBe('51820'); // server-level port is a STRING
    expect(awg.transport_proto).toBe('udp');
    expect(awg.isThirdPartyConfig).toBe(true);
    // No server-level copy of the obfuscation params: the connection reads
    // last_config only (docs/plan/amnezia-key-recon.md, section 3).
    expect(Object.keys(awg).sort()).toEqual(['isThirdPartyConfig', 'last_config', 'port', 'transport_proto']);

    // last_config is a STRINGIFIED inner JSON (double-encoded), not an object.
    expect(typeof awg.last_config).toBe('string');
    const inner = JSON.parse(awg.last_config as string) as Record<string, unknown>;
    // obfuscation params live here, as strings
    expect(inner.Jc).toBe('4');
    // S3/S4 are omitted at 0. The AmneziaVPN iOS network extension cannot parse
    // those keys at all, even when zero, and aborts with ParseError 9.
    expect('S3' in inner).toBe(false);
    expect('S4' in inner).toBe(false);
    // Dead weight the app never reads, or overwrites on import. `config`, the
    // .conf text, is among them: import checks only `containers`, the tunnel
    // is built from the fields below, and it was what made the QR too dense to
    // scan (stand, 25.09).
    for (const dead of ['mtu', 'isThirdPartyConfig', 'clientId', 'client_pub_key', 'config']) {
      expect(dead in inner, dead).toBe(false);
    }

    expect(inner.client_priv_key).toBe('cliPriv64');
    expect(inner.server_pub_key).toBe('srvPub64');
    expect(inner.client_ip).toBe('10.66.66.2/32');
    expect(inner.port).toBe(51820); // inner port is an INT (unlike the server-level string)
    expect(inner.allowed_ips).toEqual(['0.0.0.0/0', '::/0']);
    // psk_key is ABSENT (not '') without a preshared key: a blank one made the
    // app rebuild an empty `PresharedKey = ` line that the iOS parser rejects.
    expect('psk_key' in inner).toBe(false);
  });

  it('emits I1-I5 only when set, OMITTING empty slots (empty strings break the rebuilt [Interface])', () => {
    const withI = buildAmneziaVpnLink({ ...baseOpts, i1: 'aabb', i3: 'ccdd' });
    const env = decodeVpnKey(withI) as { containers: Array<{ awg: Record<string, unknown> }> };
    const awg = env.containers[0]!.awg;
    const inner = JSON.parse(awg.last_config as string) as Record<string, unknown>;
    expect(inner.I1).toBe('aabb');
    expect(inner.I3).toBe('ccdd');
    // Unset slots are ABSENT, not ''. On connect the AmneziaVPN daemon builds
    // the tunnel from these structured keys, and releases before the current one
    // took '' as a present (blank) value, injecting `I2 = ` lines that broke the
    // AmneziaWG handshake.
    expect('I2' in inner).toBe(false);
    expect('I4' in inner).toBe(false);
    expect('I5' in inner).toBe(false);
  });

  it('emits S3/S4 and psk_key when they carry a real value', () => {
    // (golden below pins the whole key for both cases)
    const key = buildAmneziaVpnLink({ ...baseOpts, s3: 12, s4: 34, pskKey: 'pskBase64' });
    const env = decodeVpnKey(key) as { containers: Array<{ awg: Record<string, unknown> }> };
    const awg = env.containers[0]!.awg;
    const inner = JSON.parse(awg.last_config as string) as Record<string, unknown>;
    expect(inner.S3).toBe('12');
    expect(inner.S4).toBe('34');
    expect(inner.psk_key).toBe('pskBase64');
  });
});

/**
 * The whole key, pinned: what the AmneziaVPN app receives, decoded.
 *
 * Why a golden and not more `toBe`s: the key's JSON was cut down twice (23.09
 * and 25.09, docs/plan/amnezia-key-recon.md: which of last_config the import
 * actually reads, since the key's size is what makes the QR too dense to scan
 * off a screen), and the one thing that must not happen along the way is a
 * quiet change to a key the app does read. With a golden every change is a
 * diff somebody reads.
 *
 * Two cases, because S3/S4 are the question the stand asked on 23.09 ("S3/S4
 * did not make it into the key at all"):
 *   awg1-s3s4-zero  the fleet today (AmneziaWG 1.x, S3 = S4 = 0): S3/S4 are
 *                   ABSENT, on purpose. The AmneziaVPN iOS network extension
 *                   (4.8.19) cannot parse the keys even at 0 and aborts with
 *                   ParseError 9, the tunnel never starts; desktop and Android
 *                   accept the absence. The .conf builder follows the same rule
 *                   (wgconf.ts), so the key and the file never disagree.
 *   awg2-s3s4-set   non-zero S3/S4 (a 2.0-shaped profile): both appear in
 *                   last_config (the key carries no .conf since 25.09).
 *
 * `keyLength` is pinned beside the JSON: it decides the QR version, and the QR
 * is where the length is felt.
 */
describe('the AmneziaVPN key, whole', () => {
  function golden(name: string, key: string): void {
    const envelope = decodeVpnKey(key) as {
      containers: Array<{ awg: Record<string, unknown> }>;
    };
    const lastConfig = JSON.parse(envelope.containers[0]!.awg.last_config as string) as Record<string, unknown>;
    const got = `${JSON.stringify({ keyLength: key.length, envelope, lastConfig }, null, 2)}\n`;
    const path = join(GOLDEN_DIR, `vpnlink-${name}.json`);
    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(path, got);
      return;
    }
    // CRLF folded: `*.json` is `text` in .gitattributes, so a Windows checkout
    // hands this file back with CRLF, which is not a change to the key.
    expect(got, `golden ${name} is out of date; retake with UPDATE_GOLDEN=1 and read the diff`).toBe(
      readFileSync(path, 'utf8').replace(/\r\n/g, '\n'),
    );
  }

  it('awg1-s3s4-zero: the fleet today, S3/S4 absent', () => {
    golden('awg1-s3s4-zero', buildAmneziaVpnLink(baseOpts));
  });

  it('awg2-s3s4-set: non-zero S3/S4 travel everywhere the app reads them', () => {
    golden('awg2-s3s4-set', buildAmneziaVpnLink({ ...baseOpts, s1: 15, s2: 18, s3: 24, s4: 20 }));
  });
});

/**
 * A model of the app's scanner, amnezia-client importController.cpp
 * parseQrCodeChunk (:321-379) and extractConfigFromQr (:261-311): base64url,
 * a QDataStream (big-endian) of qint16 magic, quint8 count, quint8 id and a
 * QByteArray (quint32 length, bytes), the chunks joined, then qUncompress.
 * Returns the chunk's header and the JSON the app ends up with.
 */
function scanAsTheApp(text: string): { magic: number; count: number; id: number; data: Buffer; json: unknown } {
  const buf = Buffer.from(text, 'base64url');
  const magic = buf.readInt16BE(0);
  const count = buf.readUInt8(2);
  const id = buf.readUInt8(3);
  const len = buf.readUInt32BE(4);
  const data = buf.subarray(8);
  expect(data.length).toBe(len); // QDataStream reads exactly `len` bytes
  const inflated = inflateSync(data.subarray(4));
  expect(inflated.length).toBe(data.readUInt32BE(0)); // qUncompress checks its header
  return { magic, count, id, data, json: JSON.parse(inflated.toString('utf8')) };
}

/**
 * E39, stand 25.09: the phone camera read the vpn:// QR and AmneziaVPN's scanner
 * sat at "0 of 0". The scanner takes the app's own chunk format; vpn:// is the
 * PASTE format. The QR carries a chunk now, the copy button keeps the key.
 */
describe('the AmneziaVPN QR text', () => {
  const key = buildAmneziaVpnLink(baseOpts);
  const qr = amneziaQrChunkFromKey(key);

  it('is not a vpn:// string', () => {
    expect(qr.startsWith('vpn://')).toBe(false);
    expect(qr).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
  });

  it('reads, the way the app reads it, as one chunk of the same bytes and the same JSON as the key', () => {
    const got = scanAsTheApp(qr);
    expect(got.magic).toBe(AMNEZIA_QR_MAGIC);
    expect(got.magic).toBe(1984);
    expect(Buffer.from(qr, 'base64url').subarray(0, 2).toString('hex')).toBe('07c0');
    expect(got.count).toBe(1);
    expect(got.id).toBe(0);
    // The key's body IS the qCompress bytes: one payload, two wrappings.
    expect(got.data.equals(Buffer.from(key.slice('vpn://'.length), 'base64url'))).toBe(true);
    expect(got.json).toEqual(decodeVpnKey(key));
    // 8 bytes of chunk header over the key body: 10 or 11 base64 characters
    // more, depending on where the body's last group ended.
    expect(qr.length - (key.length - 'vpn://'.length)).toBeGreaterThanOrEqual(10);
    expect(qr.length - (key.length - 'vpn://'.length)).toBeLessThanOrEqual(11);
  });

  it('is the same built from the config and from the key', () => {
    const env = decodeVpnKey(key);
    expect(encodeAmneziaQrChunk(env)).toBe(qr);
  });

  it('refuses a string that is not a vpn:// key rather than draw a code the app cannot read', () => {
    expect(() => amneziaQrChunkFromKey('https://example.com')).toThrow(/vpn:\/\//);
  });

  // The text, pinned like the key: a change to what the scanner receives is a
  // diff somebody reads. The key goldens above do not move.
  for (const [name, opts] of [
    ['awg1-s3s4-zero', baseOpts],
    ['awg2-s3s4-set', { ...baseOpts, s1: 15, s2: 18, s3: 24, s4: 20 }],
  ] as const) {
    it(`golden ${name}.qr`, () => {
      const text = amneziaQrChunkFromKey(buildAmneziaVpnLink(opts));
      const got = `${JSON.stringify({ qrLength: text.length, qrText: text }, null, 2)}\n`;
      const path = join(GOLDEN_DIR, `vpnlink-${name}.qr.json`);
      if (process.env.UPDATE_GOLDEN) {
        writeFileSync(path, got);
        return;
      }
      expect(got, `golden ${name}.qr is out of date; retake with UPDATE_GOLDEN=1 and read the diff`).toBe(
        readFileSync(path, 'utf8').replace(/\r\n/g, '\n'),
      );
    });
  }
});
