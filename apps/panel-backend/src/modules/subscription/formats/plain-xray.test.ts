import { describe, it, expect } from 'vitest';
import type { SubscriptionEndpoint, XrayPlainSubscriptionEndpoint } from '../subscription.formats.js';
import { buildClashYaml } from './clash.js';
import { buildSingboxJson } from './singbox.js';
import { buildXrayJson, buildXrayJsonArray } from './xrayjson.js';
import { buildSurgeConf } from './surge.js';
import { buildQuantumultXConf } from './quantumultx.js';
import { buildLoonConf } from './loon.js';

/**
 * The SOCKS5 / HTTP doors (23.09) in each structured format. Carried by clash,
 * sing-box and xray-json; left out of surge, quantumult x and loon by decision,
 * and left out QUIETLY there, never rendered as a VLESS line with no uuid, which
 * is what a builder that had never heard of them used to do with an xray
 * endpoint.
 */
const base = {
  protocol: 'xray' as const,
  nodeId: 'n-1',
  host: 'de-1.example.com',
  username: 'alice',
  password: '11111111-1111-4111-8111-111111111111',
};
const socks: XrayPlainSubscriptionEndpoint = {
  ...base,
  subprotocol: 'socks',
  key: 'k-socks',
  nodeName: 'DE socks',
  port: 1080,
  uri: 'socks://x@de-1.example.com:1080#DE',
};
const http: XrayPlainSubscriptionEndpoint = {
  ...base,
  subprotocol: 'http',
  key: 'k-http',
  nodeName: 'DE http',
  port: 3128,
  uri: 'http://alice:x@de-1.example.com:3128#DE',
};
const both: SubscriptionEndpoint[] = [socks, http];

describe('socks and http in the structured formats', () => {
  it('clash: socks5 and http proxies with the login, udp off on socks', () => {
    const yaml = buildClashYaml(both);
    expect(yaml).toMatch(/- name: "DE socks-socks"\n\s+type: socks5\n\s+server: de-1\.example\.com\n\s+port: 1080\n\s+username: "?alice"?\n\s+password: "?11111111-1111-4111-8111-111111111111"?\n\s+udp: false/);
    expect(yaml).toContain('name: "DE http-http"');
    expect(yaml).toMatch(/type: http\n\s+server: de-1\.example\.com\n\s+port: 3128/);
    expect(yaml).not.toContain('type: vless');
  });

  it('sing-box: socks version 5 and http outbounds', () => {
    const cfg = JSON.parse(buildSingboxJson(both)) as { outbounds: Record<string, unknown>[] };
    const s = cfg.outbounds.find((o) => o.type === 'socks');
    const h = cfg.outbounds.find((o) => o.type === 'http');
    expect(s).toMatchObject({ server: 'de-1.example.com', server_port: 1080, version: '5', username: 'alice', password: base.password });
    expect(h).toMatchObject({ server: 'de-1.example.com', server_port: 3128, username: 'alice', password: base.password });
    expect(cfg.outbounds.some((o) => o.type === 'vless')).toBe(false);
  });

  it('xray-json: socks and http outbounds in the servers form with one user', () => {
    const configs = JSON.parse(buildXrayJsonArray(both)) as { outbounds: Record<string, unknown>[] }[];
    const outs = configs.flatMap((c) => c.outbounds);
    for (const [protocol, port] of [['socks', 1080], ['http', 3128]] as const) {
      const o = outs.find((x) => x.protocol === protocol);
      expect(o, protocol).toBeDefined();
      expect(o!.settings).toEqual({
        servers: [{ address: 'de-1.example.com', port, users: [{ user: 'alice', pass: base.password }] }],
      });
    }
    expect(buildXrayJson(both)).not.toContain('"vless"');
  });

  it('surge, quantumult x and loon leave them out rather than guess', () => {
    for (const out of [buildSurgeConf(both), buildQuantumultXConf(both), buildLoonConf(both)]) {
      expect(out).not.toContain('de-1.example.com');
    }
  });
});
