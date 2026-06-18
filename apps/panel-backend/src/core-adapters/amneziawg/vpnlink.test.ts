import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { buildAmneziaVpnLink, encodeAmneziaVpnKey } from './vpnlink.js';

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
    // obfuscation params at the awg level, as strings
    expect(awg.Jc).toBe('4');
    expect(awg.S3).toBe('0');

    // last_config is a STRINGIFIED inner JSON (double-encoded), not an object.
    expect(typeof awg.last_config).toBe('string');
    const inner = JSON.parse(awg.last_config as string) as Record<string, unknown>;

    // The .conf text is required and non-empty; this is the other half of 900.
    const conf = inner.config as string;
    expect(conf).toContain('[Interface]');
    expect(conf).toContain('[Peer]');
    expect(conf).toContain('Endpoint = de.example.com:51820');
    expect(conf).toContain('PrivateKey = cliPriv64');

    expect(inner.client_priv_key).toBe('cliPriv64');
    expect(inner.server_pub_key).toBe('srvPub64');
    expect(inner.client_ip).toBe('10.66.66.2/32');
    expect(inner.port).toBe(51820); // inner port is an INT (unlike the server-level string)
    expect(inner.allowed_ips).toEqual(['0.0.0.0/0', '::/0']);
    expect(inner.psk_key).toBe(''); // no preshared key by default
  });

  it('emits I1-I5 only when set, OMITTING empty slots (empty strings break the rebuilt [Interface])', () => {
    const withI = buildAmneziaVpnLink({ ...baseOpts, i1: 'aabb', i3: 'ccdd' });
    const env = decodeVpnKey(withI) as { containers: Array<{ awg: Record<string, unknown> }> };
    const awg = env.containers[0]!.awg;
    expect(awg.I1).toBe('aabb');
    expect(awg.I3).toBe('ccdd');
    // Unset slots are ABSENT, not ''. On connect the AmneziaVPN daemon rebuilds
    // the [Interface] from these structured keys and treats '' as a present
    // (blank) value, injecting `I2 = ` lines that break the AmneziaWG handshake.
    expect('I2' in awg).toBe(false);
    expect('I4' in awg).toBe(false);
    expect('I5' in awg).toBe(false);
    const inner = JSON.parse(awg.last_config as string) as Record<string, unknown>;
    expect(inner.I1).toBe('aabb');
    expect('I2' in inner).toBe(false);
    // the inline .conf likewise carries only the non-empty I-lines
    expect(inner.config as string).toContain('I1 = aabb');
    expect(inner.config as string).not.toContain('I2 =');
  });
});
