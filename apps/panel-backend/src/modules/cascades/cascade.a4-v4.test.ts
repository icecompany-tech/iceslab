import { describe, expect, it } from 'vitest';
import {
  autoRouteTag,
  buildTopologyFragmentsForNode,
  routeTag,
  type TopologyLinkRow,
} from './cascade.config.js';

/**
 * A4 ad-split on a v4 cascade entry.
 *
 * ⚠ THIS FILE IS EXPECTED TO FAIL until the ad-split is rendered on the v4
 * path. It is committed red on purpose, so that the fix is visibly a fix and
 * not a rewrite of what the test asserts.
 *
 * What is wrong today, measured on 2026-09-11: a v4 entry prints the QUIC block,
 * one rule per direction gated on vlessRoute, and the Auto rule. A policy
 * contributes ONLY extra tags to those vlessRoute lists. Its `directDomains` and
 * `blockDomains` are never rendered, so the ad-split does not happen at all.
 *
 * The domain rules exist in `buildCascadeConfigs`, the LEGACY chain builder, and
 * v4 does not go through it. This is the same class as the defect fixed on
 * 2026-07-30 ("policies reached balancer entries only"), reintroduced by the
 * rewrite, and it stayed invisible because the squad holding the policy on the
 * field stand has no members yet. On an operator's install it is a sold tariff.
 */
const ENTRY = 'e1111111-1111-1111-1111-111111111111';
const NL = 'a2222222-2222-2222-2222-222222222222';
const DE = 'b3333333-3333-3333-3333-333333333333';

const NO_ADS = {
  ordinal: 1,
  directDomains: ['geosite:google'],
  blockDomains: ['geosite:category-ads-all'],
};

function links(): TopologyLinkRow[] {
  return [
    {
      fromNodeId: ENTRY,
      toNodeId: NL,
      directionTag: 1,
      cred: { protocol: 'vless', port: 24000, uuid: 'u-nl' },
    },
    {
      fromNodeId: ENTRY,
      toNodeId: DE,
      directionTag: 2,
      cred: { protocol: 'vless', port: 24000, uuid: 'u-de' },
    },
  ];
}

function entryRules(): Record<string, unknown>[] {
  const hop = buildTopologyFragmentsForNode(ENTRY, {
    positions: [{ position: 0, nodeIds: [ENTRY] }],
    directions: [
      { tag: 1, nodeIds: [NL] },
      { tag: 2, nodeIds: [DE] },
    ],
    links: links(),
    hosts: new Map([
      [ENTRY, 'entry.example.com'],
      [NL, 'nl.example.com'],
      [DE, 'de.example.com'],
    ]),
    policies: [NO_ADS],
  });
  if (!hop) throw new Error('the entry built no fragments at all');
  return hop.routingRules;
}

/** The tags a rule is gated on, as a set. `vlessRoute` is a comma-separated
 *  STRING (an array fails the whole xray config), so membership has to be
 *  tested on the split list and not with a substring: "1" is inside "1257". */
function gatedOn(rule: Record<string, unknown>): Set<string> {
  const raw = rule['vlessRoute'];
  if (typeof raw !== 'string') return new Set();
  return new Set(raw.split(',').map((t) => t.trim()));
}

function indexOfDomainRule(
  rules: Record<string, unknown>[],
  domain: string,
): number {
  return rules.findIndex((r) => {
    const d = r['domain'];
    return Array.isArray(d) && d.includes(domain);
  });
}

describe('A4 ad-split reaches a v4 entry', () => {
  it('renders the BLOCK list as a rule of its own', () => {
    const rules = entryRules();
    const i = indexOfDomainRule(rules, 'geosite:category-ads-all');
    expect(
      i,
      `no rule carries the policy's blockDomains. The entry printed:\n` +
        JSON.stringify(rules, null, 2),
    ).toBeGreaterThanOrEqual(0);
    // WHERE it leads, not only that it exists. A rule with the right domains
    // pointing at the link would pass an existence check and block nothing.
    expect(
      rules[i]!['outboundTag'],
      'blockDomains must end in the blackhole, not travel anywhere',
    ).toBe('blocked');
  });

  it('renders the DIRECT list as a rule of its own', () => {
    // Checked separately from the block list on purpose: blocking without
    // direct looks like it works. Ads disappear, and the operator has no reason
    // to notice that the domains promised as direct are going through the
    // tunnel instead. Green on wrong behaviour, again.
    const rules = entryRules();
    const i = indexOfDomainRule(rules, 'geosite:google');
    expect(
      i,
      `no rule carries the policy's directDomains. The entry printed:\n` +
        JSON.stringify(rules, null, 2),
    ).toBeGreaterThanOrEqual(0);
    // And this is the one that matters most. The whole point of directDomains
    // at a cascade entry is to NOT enter the chain. A rule that exists, carries
    // the right domains and leads to a link-out means the operator sold "google
    // direct" and google goes through three countries: the rule looks right,
    // the screen is green, and the behaviour is the opposite of what was sold.
    expect(
      rules[i]!['outboundTag'],
      'directDomains must leave from HERE, not through a link-out',
    ).toBe('direct');
  });

  it('gates both on the POLICY, not on everybody', () => {
    // A grant belongs to the squad that was sold it. The plain profile
    // (ordinal 0) must not be caught by it: its tag is routeTag(0, ...).
    const rules = entryRules();
    for (const domain of ['geosite:category-ads-all', 'geosite:google']) {
      const i = indexOfDomainRule(rules, domain);
      expect(i, `missing rule for ${domain}`).toBeGreaterThanOrEqual(0);
      const tags = gatedOn(rules[i]!);
      expect(tags.size, `the rule for ${domain} is gated on nobody`).toBeGreaterThan(0);
      expect(
        tags.has(String(routeTag(NO_ADS.ordinal, 0))),
        `the rule for ${domain} does not carry the policy's tag for direction 1`,
      ).toBe(true);
      expect(
        tags.has(String(routeTag(0, 0))),
        `the rule for ${domain} also catches the PLAIN profile, which was not sold it`,
      ).toBe(false);
    }
  });

  it('puts the grant ABOVE the choice of direction', () => {
    // The narrow rule names a user AND a destination; the direction rule names
    // only a way out, so it is a door. Narrow above wide, or the door matches
    // first and the grant never fires. Stated by mutual indexes rather than
    // described, because the description is what was wrong before.
    const rules = entryRules();
    const block = indexOfDomainRule(rules, 'geosite:category-ads-all');
    const direct = indexOfDomainRule(rules, 'geosite:google');
    const door = rules.findIndex(
      (r) => r['domain'] === undefined && gatedOn(r).has(String(routeTag(NO_ADS.ordinal, 0))),
    );
    expect(block, 'no block rule').toBeGreaterThanOrEqual(0);
    expect(direct, 'no direct rule').toBeGreaterThanOrEqual(0);
    expect(door, 'no rule choosing the direction for this policy').toBeGreaterThanOrEqual(0);
    expect(block).toBeLessThan(door);
    expect(direct).toBeLessThan(door);
  });

  it('catches the Auto line of the same policy, and only it', () => {
    // The other half of the subscribers. A squad buys the ad-split and gets one
    // line per direction PLUS an Auto line; the Auto line carries a tag of its
    // own (0xffff - ordinal), which is not in the per-direction series. A grant
    // built only from the direction list would miss it, and the same tariff
    // would work for a user pinned to a country and silently not work for a
    // user on Auto. The legacy balancer builder already warns about exactly
    // this case in a comment; v4 has to hold the same line.
    const hop = buildTopologyFragmentsForNode(ENTRY, {
      positions: [{ position: 0, nodeIds: [ENTRY] }],
      directions: [
        { tag: 1, nodeIds: [NL] },
        { tag: 2, nodeIds: [DE] },
      ],
      links: links(),
      hosts: new Map([
        [ENTRY, 'entry.example.com'],
        [NL, 'nl.example.com'],
        [DE, 'de.example.com'],
      ]),
      policies: [NO_ADS],
      auto: true,
    });
    const rules = hop!.routingRules;

    for (const domain of ['geosite:category-ads-all', 'geosite:google']) {
      const i = indexOfDomainRule(rules, domain);
      expect(i, `missing rule for ${domain}`).toBeGreaterThanOrEqual(0);
      const tags = gatedOn(rules[i]!);
      expect(
        tags.has(String(autoRouteTag(NO_ADS.ordinal))),
        `the rule for ${domain} misses the policy's Auto tag, so a subscriber on ` +
          `the Auto line does not get the tariff they bought`,
      ).toBe(true);
      expect(
        tags.has(String(autoRouteTag(0))),
        `the rule for ${domain} catches the PLAIN Auto line, which was not sold it`,
      ).toBe(false);
    }

    // And it still sits above the Auto door, which is as wide as doors get.
    const autoDoor = rules.findIndex((r) => r['balancerTag'] === 'bal-auto');
    expect(autoDoor, 'no Auto rule at all').toBeGreaterThanOrEqual(0);
    expect(indexOfDomainRule(rules, 'geosite:category-ads-all')).toBeLessThan(autoDoor);
    expect(indexOfDomainRule(rules, 'geosite:google')).toBeLessThan(autoDoor);
  });

  it('still renders nothing extra when no policy is defined', () => {
    // The other half of the fix: a cascade with no A4 policy must keep printing
    // exactly what it prints today, or every existing node gets a rewritten
    // config for nothing.
    const hop = buildTopologyFragmentsForNode(ENTRY, {
      positions: [{ position: 0, nodeIds: [ENTRY] }],
      directions: [
        { tag: 1, nodeIds: [NL] },
        { tag: 2, nodeIds: [DE] },
      ],
      links: links(),
      hosts: new Map([
        [ENTRY, 'entry.example.com'],
        [NL, 'nl.example.com'],
        [DE, 'de.example.com'],
      ]),
    });
    expect(hop!.routingRules.some((r) => r['domain'] !== undefined)).toBe(false);
    expect(hop!.routingRules).toHaveLength(3); // QUIC block + one per direction
  });
});
