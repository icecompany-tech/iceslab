import { GEO_BUILTIN_NAMES, type GeoSetUse } from '@iceslab/shared';
import { prisma } from '../../prisma.js';

/**
 * Where rules name geo sets. Three places and only three (checked by ARCH over
 * the tree, 24.09; geo-contract.md section 6): the rules of node policies, the
 * domain lists of route policies, and a node's resolver. Nothing the panel or
 * the agent renders carries a hard-coded `geosite:`/`geoip:`.
 */

/** Which list of a rule an entry sits in: xray reads the two differently. */
export type GeoRefField = 'domain' | 'ip';

export interface GeoRef {
  /** The set's name: `geosite`, `geoip` or the `<name>` of `ext:`. */
  set: string;
  /** The tag as the rule spells it, attributes and `!` included. */
  tag: string;
  /** The tag the set has to contain: lower case, no `@attr`, no leading `!`. */
  baseTag: string;
  field: GeoRefField;
  entry: string;
}

/**
 * The geo reference in one rule entry, or null for an entry that names none
 * (a domain, a CIDR, `regexp:`, `keyword:`...). Spellings as xray takes them:
 * `geosite:`, `geoip:`, `ext:<file>:<tag>` and its qualified forms
 * `ext-domain:` and `ext-ip:` (infra/conf/router.go:370-402, 440-504).
 */
export function parseGeoRef(entry: string, field: GeoRefField): GeoRef | null {
  const e = entry.trim();
  let set: string;
  let tag: string;
  if (e.startsWith('geosite:')) {
    set = GEO_BUILTIN_NAMES.geosite;
    tag = e.slice('geosite:'.length);
  } else if (e.startsWith('geoip:')) {
    set = GEO_BUILTIN_NAMES.geoip;
    tag = e.slice('geoip:'.length);
  } else {
    const prefix = ['ext:', 'ext-domain:', 'ext-ip:'].find((p) => e.startsWith(p));
    if (!prefix) return null;
    const parts = e.slice(prefix.length).split(':');
    if (parts.length !== 2) return null;
    [set, tag] = parts as [string, string];
  }
  const baseTag = tag.replace(/^!/, '').split('@')[0]!.toLowerCase();
  if (set === '' || baseTag === '') return null;
  return { set, tag, baseTag, field, entry: e };
}

export interface GeoUseSite {
  ref: GeoRef;
  owner: GeoSetUse;
  /** The nodes this entry reaches. */
  nodeIds: string[];
}

function refs(entries: readonly string[] | undefined, field: GeoRefField): GeoRef[] {
  return (entries ?? []).flatMap((e) => parseGeoRef(e, field) ?? []);
}

/**
 * Every geo reference the panel holds, with who owns it and which nodes it
 * reaches. Read whole: three small tables, and every caller (the list, the
 * delete guard, the rollout plan) needs the full picture anyway.
 *
 * Which nodes:
 *   node policy    the nodes that run it;
 *   route policy   the ENTRY nodes of enabled cascades, because every policy
 *                  is rendered on every entry (cascade.service.ts:2398-2413);
 *   node DNS       that node.
 * Disabled policy rules count: switching one back on must not find its list
 * missing.
 */
export async function collectGeoUses(): Promise<GeoUseSite[]> {
  const [policies, routePolicies, dnsNodes, entryNodeIds] = await Promise.all([
    prisma.nodePolicy.findMany({
      select: {
        id: true,
        name: true,
        rules: { select: { matchDomain: true, matchIp: true } },
        nodes: { where: { deletedAt: null }, select: { id: true } },
      },
    }),
    prisma.routePolicy.findMany({ select: { id: true, name: true, directDomains: true, blockDomains: true } }),
    // Filtered here, not in the query: "no resolver" is stored both as SQL
    // NULL and as JSON null (nodes.service.ts, the dns write).
    prisma.node.findMany({ where: { deletedAt: null }, select: { id: true, name: true, dns: true } }),
    cascadeEntryNodeIds(),
  ]);

  const out: GeoUseSite[] = [];
  for (const p of policies) {
    const owner: GeoSetUse = { kind: 'node-policy', id: p.id, name: p.name };
    const nodeIds = p.nodes.map((n) => n.id);
    for (const r of p.rules) {
      for (const ref of [...refs(r.matchDomain, 'domain'), ...refs(r.matchIp, 'ip')]) {
        out.push({ ref, owner, nodeIds });
      }
    }
  }
  for (const p of routePolicies) {
    const owner: GeoSetUse = { kind: 'route-policy', id: p.id, name: p.name };
    for (const ref of refs([...p.directDomains, ...p.blockDomains], 'domain')) {
      out.push({ ref, owner, nodeIds: entryNodeIds });
    }
  }
  for (const n of dnsNodes) {
    const owner: GeoSetUse = { kind: 'node-dns', id: n.id, name: n.name };
    const servers = (n.dns as { servers?: { domains?: string[]; expectIps?: string[] }[] } | null)?.servers ?? [];
    for (const s of servers) {
      for (const ref of [...refs(s.domains, 'domain'), ...refs(s.expectIps, 'ip')]) {
        out.push({ ref, owner, nodeIds: [n.id] });
      }
    }
  }
  return out;
}

/** Entry nodes of enabled cascades: position 0 of the topology tables, and
 *  hop 0 of a cascade from before them. Deleted nodes left out. */
async function cascadeEntryNodeIds(): Promise<string[]> {
  const [positions, hops] = await Promise.all([
    prisma.cascadePositionNode.findMany({
      where: { position: { position: 0, cascade: { enabled: true } }, node: { deletedAt: null } },
      select: { nodeId: true },
    }),
    prisma.cascadeHop.findMany({
      where: { position: 0, cascade: { enabled: true }, node: { deletedAt: null } },
      select: { nodeId: true },
    }),
  ]);
  return [...new Set([...positions, ...hops].map((r) => r.nodeId))];
}

/** The owners of references to `setName`, each once, in a stable order. */
export function usesOf(sites: GeoUseSite[], setName: string): GeoSetUse[] {
  const seen = new Map<string, GeoSetUse>();
  for (const s of sites) {
    if (s.ref.set !== setName) continue;
    seen.set(`${s.owner.kind}:${s.owner.id}`, s.owner);
  }
  return [...seen.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
