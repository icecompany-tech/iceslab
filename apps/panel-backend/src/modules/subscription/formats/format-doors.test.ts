import { describe, it, expect } from 'vitest';
import { DOORS, FORMAT_DOORS, FORMAT_NAMES, formatCarries, type SubscriptionFormat } from '@iceslab/shared';
import {
  endpointDoor,
  endpointsForFormat,
  type SubscriptionEndpoint,
} from '../subscription.formats.js';
import { expandEndpointUris } from '../subscription.service.js';
import { buildClashYaml } from './clash.js';
import { buildSingboxJson } from './singbox.js';
import { buildWgQuickConf } from './wgconf.js';
import { buildAwgVpnLink } from './amneziavpn.js';
import { buildXrayJson, buildXrayJsonArray } from './xrayjson.js';
import { buildOutlineJson } from './outline.js';
import { buildSurgeConf } from './surge.js';
import { buildQuantumultXConf } from './quantumultx.js';
import { buildLoonConf } from './loon.js';

/**
 * FORMAT_DOORS against the files, one door at a time.
 *
 * The table is what the screens read (the page's download rows, GET
 * /api/profiles/:id/formats); the files are what a client receives. They are
 * one decision only if every CARRIED cell is a door the builder really emits,
 * and every file is built through endpointsForFormat, which is what the route
 * does. So for every format and every door: the endpoint goes through the same
 * gate as in the route, then through the format's builder, and its host shows
 * up in the file exactly when the table says the door is carried.
 *
 * A builder that silently drops a door the table promises fails here. A door
 * the table does not promise never reaches a builder at all.
 */

const base = { nodeId: 'n', port: 443 } as const;
const host = (door: string, variant = '') => `door-${door}${variant}.example`;

const xray = (sub: 'vless' | 'vmess' | 'trojan', securityLayer: 'default' | 'tls' | 'none') => {
  const h = host(sub, securityLayer === 'default' ? '' : `-${securityLayer}`);
  return {
    ...base,
    protocol: 'xray',
    nodeName: `x-${sub}-${securityLayer}`,
    host: h,
    uri: `${sub}://u@${h}:443`,
    uuid: '11111111-1111-4111-8111-111111111111',
    publicKey: 'PUB',
    shortId: 'ab',
    sni: 'www.example.com',
    flow: sub === 'vless' ? 'xtls-rprx-vision' : '',
    fingerprint: 'chrome',
    network: 'raw',
    subprotocol: sub,
    securityLayer,
  } as SubscriptionEndpoint;
};

/** One endpoint per door, shaped the way the subscription service builds it:
 *  a share link where one exists, '' where the service has none to give. */
const SAMPLES: SubscriptionEndpoint[] = [
  xray('vless', 'default'),
  xray('vmess', 'none'),
  xray('trojan', 'default'),
  xray('trojan', 'tls'),
  {
    ...base,
    protocol: 'xray',
    subprotocol: 'socks',
    nodeName: 'x-socks',
    host: host('socks'),
    uri: `socks://${host('socks')}`,
    username: 'bob',
    password: 'pw',
  },
  {
    ...base,
    protocol: 'xray',
    subprotocol: 'http',
    nodeName: 'x-http',
    host: host('http'),
    uri: `http://bob:pw@${host('http')}`,
    username: 'bob',
    password: 'pw',
  },
  { ...base, protocol: 'hysteria', nodeName: 'hy', host: host('hysteria'), uri: `hysteria2://p@${host('hysteria')}`, password: 'p' },
  {
    ...base,
    protocol: 'shadowsocks',
    nodeName: 'ss',
    host: host('shadowsocks'),
    uri: `ss://x@${host('shadowsocks')}`,
    method: '2022-blake3-aes-128-gcm',
    password: 'p',
  },
  {
    ...base,
    protocol: 'tuic',
    nodeName: 'tuic',
    host: host('tuic'),
    uri: `tuic://u@${host('tuic')}`,
    uuid: '11111111-1111-4111-8111-111111111111',
    password: 'p',
    serverName: 'www.example.com',
    congestionControl: 'bbr',
  },
  { ...base, protocol: 'anytls', nodeName: 'anytls', host: host('anytls'), uri: `anytls://p@${host('anytls')}`, password: 'p', serverName: 'www.example.com' },
  {
    ...base,
    protocol: 'shadowtls',
    nodeName: 'stls',
    host: host('shadowtls'),
    uri: '',
    shadowtlsPassword: 'p',
    handshake: 'www.example.com',
    ssMethod: '2022-blake3-aes-128-gcm',
    ssPassword: 'p',
  },
  { ...base, protocol: 'mieru', nodeName: 'mieru', host: host('mieru'), uri: `mierus://u:p@${host('mieru')}`, username: 'u', password: 'p', mtu: 1400 },
  { ...base, protocol: 'naive', nodeName: 'naive', host: host('naive'), uri: `naive+https://u:p@${host('naive')}`, username: 'u', password: 'p' },
  {
    ...base,
    protocol: 'mtproto',
    nodeName: 'mt',
    host: host('mtproto'),
    uri: `tg://proxy?server=${host('mtproto')}`,
    secret: 'ee00',
    domain: 'www.example.com',
    tmeUri: `https://t.me/proxy?server=${host('mtproto')}`,
  },
  {
    ...base,
    protocol: 'amneziawg',
    nodeName: 'awg',
    host: host('amneziawg'),
    uri: '',
    privateKey: 'cHJpdmF0ZQ==',
    allowedIp: '10.66.66.2/32',
    serverPublicKey: 'cHVibGlj',
    jc: 4, jmin: 40, jmax: 70, s1: 0, s2: 0, s3: 0, s4: 0, h1: 1, h2: 2, h3: 3, h4: 4,
    i1: '', i2: '', i3: '', i4: '', i5: '',
  },
];

const BUILD: Record<SubscriptionFormat, (eps: SubscriptionEndpoint[]) => string> = {
  plain: (eps) => eps.flatMap(expandEndpointUris).join('\n'),
  json: (eps) => JSON.stringify(eps),
  clash: (eps) => buildClashYaml(eps),
  singbox: (eps) => buildSingboxJson(eps),
  wgconf: (eps) => buildWgQuickConf(eps),
  amneziavpn: (eps) => {
    // The key is base64 of a compressed blob: decode the host out of it is not
    // this test's job, a non-empty key for the one AWG sample is.
    const key = buildAwgVpnLink(eps);
    return key ? eps.map((e) => e.host).join(' ') : '';
  },
  xrayjson: (eps) => buildXrayJson(eps),
  'xrayjson-array': (eps) => buildXrayJsonArray(eps),
  xkeen: (eps) => buildXrayJson(eps, { forRouter: true }),
  outline: (eps) => buildOutlineJson(eps),
  surge: (eps) => buildSurgeConf(eps),
  quantumultx: (eps) => buildQuantumultXConf(eps),
  loon: (eps) => buildLoonConf(eps),
};

describe('every door of every format: in the file exactly when the table says', () => {
  it('samples every door, so nothing below is vacuous', () => {
    expect([...new Set(SAMPLES.map(endpointDoor))].sort()).toEqual([...DOORS].sort());
  });

  const cases = FORMAT_NAMES.flatMap((format) => SAMPLES.map((e) => [format, e] as const));
  it.each(cases)('%s: %o', (format, e) => {
    const security = 'securityLayer' in e ? e.securityLayer : undefined;
    const { carried } = formatCarries(format, endpointDoor(e), security);
    const file = BUILD[format](endpointsForFormat(format, [e]));
    if (carried) {
      expect(file, `${format} is marked as carrying ${endpointDoor(e)} and its file lost it`).toContain(e.host);
    } else {
      expect(file).not.toContain(e.host);
    }
  });
});

describe('the table itself', () => {
  it('answers every door for every format, with a reason for every gap', () => {
    for (const format of FORMAT_NAMES) {
      for (const door of DOORS) {
        const cell = FORMAT_DOORS[format][door];
        expect(cell, `${format}/${door}`).toBeDefined();
        if (!cell.carried) expect(['client-lacks-protocol', 'no-uri-standard', 'not-yet']).toContain(cell.why);
      }
    }
  });

  it('keeps REALITY out of Surge and nothing else', () => {
    expect(formatCarries('surge', 'trojan', 'default')).toEqual({ carried: false, why: 'client-lacks-protocol' });
    expect(formatCarries('surge', 'trojan', 'tls')).toEqual({ carried: true, why: 'native' });
    expect(formatCarries('quantumultx', 'trojan', 'default')).toEqual({ carried: true, why: 'native' });
  });

  it('no longer claims plain carries what has no link', () => {
    expect(formatCarries('plain', 'amneziawg').why).toBe('no-uri-standard');
    expect(formatCarries('plain', 'shadowtls').why).toBe('no-uri-standard');
  });
});
