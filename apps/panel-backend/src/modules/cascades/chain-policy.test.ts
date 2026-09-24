import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chainPoliciesOf } from './chain-policy.js';
import { renderChainConfig } from './chain.config.js';
import { LINK_PORT_BASE } from './cascade.config.js';

/**
 * Route policy entries, stored as xray matcher strings since A4, as sing-box
 * matches them in the chain (phase 9.3).
 */
const SINGBOX_BIN =
  process.env.SINGBOX_BIN ?? ['/usr/local/bin/sing-box', '/usr/bin/sing-box'].find((p) => existsSync(p)) ?? '';

describe('route policy entries into sing-box matchers', () => {
  it('each spelling the way xray reads it', () => {
    const { policies, ruleSets } = chainPoliciesOf([
      {
        ordinal: 2,
        blockDomains: [
          'geosite:category-ads-all',
          'ext:mylist:Ads@cn',
          'domain:gosuslugi.ru',
          'full:exact.example',
          'keyword:tracker',
          'regexp:^ad[0-9]+\\.',
          'plain.example',
          'geoip:ru',
          'ext-ip:mylist:ru',
          '',
        ],
        directDomains: [],
      },
    ]);
    expect(policies).toEqual([
      {
        ordinal: 2,
        block: {
          domain: ['gosuslugi.ru', 'exact.example'],
          domain_suffix: ['.gosuslugi.ru', 'plain.example'],
          domain_keyword: ['tracker'],
          domain_regex: ['^ad[0-9]+\\.'],
          rule_set: ['geo-geosite-category-ads-all', 'geo-mylist-ads@cn'],
        },
        direct: {},
      },
    ]);
    // Each rule-set once, with the file the geo push lays out for it.
    expect(ruleSets).toEqual([
      {
        tag: 'geo-geosite-category-ads-all',
        file: 'iceslab-geosite.category-ads-all.json',
        path: '/etc/iceslab-node/geo/iceslab-geosite.category-ads-all.json',
        set: 'geosite',
        setTag: 'category-ads-all',
      },
      {
        tag: 'geo-mylist-ads@cn',
        file: 'iceslab-mylist.ads@cn.json',
        path: '/etc/iceslab-node/geo/iceslab-mylist.ads@cn.json',
        set: 'mylist',
        setTag: 'ads@cn',
      },
    ]);
  });

  it('in ordinal order, and a policy with nothing to match draws nothing', () => {
    const { policies } = chainPoliciesOf([
      { ordinal: 3, blockDomains: ['a.example'], directDomains: [] },
      { ordinal: 1, blockDomains: [], directDomains: [] },
    ]);
    expect(policies.map((p) => p.ordinal)).toEqual([1, 3]);
    const cfg = renderChainConfig({
      role: 'entry',
      socksPassword: 'p',
      directionTags: [1],
      out: [{ tag: 1, host: '192.0.2.1', cred: { protocol: 'shadowsocks', port: LINK_PORT_BASE, psk: 'x', method: '2022-blake3-aes-256-gcm' } }],
      policies,
    }) as { route: { rules: Record<string, unknown>[] }; inbounds: { users?: { username: string }[] }[] };
    expect(cfg.route.rules.filter((r) => 'auth_user' in r).map((r) => r.auth_user)).toEqual([['p3']]);
    // Every profile has its user, the empty one too: its clients are handed
    // over as p1 and must be let in.
    expect(cfg.inbounds[0]!.users!.map((u) => u.username)).toEqual(['p0', 'p1', 'p3']);
  });

  it.runIf(SINGBOX_BIN)('is a chain config the engine loads, with its rule-set file there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iceslab-chain-policy-'));
    const rs = join(dir, 'iceslab-geosite.category-ads-all.json');
    writeFileSync(rs, JSON.stringify({ version: 2, rules: [{ domain_suffix: ['.doubleclick.net'] }] }));
    const { policies, ruleSets } = chainPoliciesOf([
      { ordinal: 1, blockDomains: ['geosite:category-ads-all', 'ads.example'], directDomains: ['domain:gosuslugi.ru'] },
    ]);
    const cfg = renderChainConfig({
      role: 'entry',
      socksPassword: 'p',
      directionTags: [1],
      out: [
        {
          tag: 1,
          host: '192.0.2.1',
          cred: { protocol: 'shadowsocks', port: LINK_PORT_BASE, psk: 'aWNlc2xhYi1jaGFpbi1maXh0dXJlLXBzay0wMDAwMDA=', method: '2022-blake3-aes-256-gcm' },
        },
      ],
      policies,
      // The file where the test put it, the name the node would give it.
      ruleSets: ruleSets.map((r) => ({ tag: r.tag, path: rs })),
    });
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(cfg));
    expect(() => execFileSync(SINGBOX_BIN, ['check', '-c', file], { encoding: 'utf8' })).not.toThrow();
  });
});
