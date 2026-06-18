import { randomBytes, randomUUID } from 'node:crypto';

/**
 * C2/C3b - cascade config generation for the native inter-hop link cells the
 * node-agent realises in C3. Pure + testable: maps an ordered hop list +
 * pre-generated inter-hop link creds into per-node xray inbound/outbound/
 * routing fragments by role (entry / transit / exit).
 *
 * Topology (proxy-chain, terminate-at-each-hop so the entry can split-route):
 *   entry:   user-inbound (already deployed via the node's profile) + a
 *            link-OUT to hop[1]; route user traffic -> link-out.
 *   transit: link-IN (from prev) + link-OUT (to next); link-in -> link-out.
 *   exit:    link-IN (from prev) + freedom; link-in -> direct.
 *
 * Native link cells realised here: vless->vless (C3) and shadowsocks/SS2022
 * (C3b). Both ride the node's xray binary (xray has native SS inbound +
 * outbound), so the node-agent stays protocol-agnostic and just merges the
 * fragments. The link is a trusted node-to-node channel (datacenter to
 * datacenter), so the cell choice is about wire shape, not DPI evasion: the
 * ENTRY does the evasion. wg / hy2 / naive link cells need cross-adapter key
 * management or a bridge process and are deferred (fall back to vless).
 */

// Inter-hop link port base. The link from hop[i] to hop[i+1] listens on the
// RECEIVING node at LINK_PORT_BASE + i. High to dodge user inbounds; the
// node-agent (C3) firewalls it to peer nodes and ensures it's free.
export const LINK_PORT_BASE = 24000;

// SS2022 cipher for shadowsocks link cells. 32-byte key -> aes-256-gcm, the
// same default the standalone SS adapter uses (apps/node/.../shadowsocks).
const SS_LINK_METHOD = '2022-blake3-aes-256-gcm';

/** Native inter-hop link protocols realised by buildCascadeConfigs. Any other
 *  hop.linkProtocol (hy2/naive/wg/...) falls back to vless until its cell or
 *  bridge ships, which is non-regressive (vless was the only realised cell). */
export type LinkProtocol = 'vless' | 'shadowsocks';

interface VlessLinkCred {
  protocol: 'vless';
  /** Port the receiving (next) hop listens on for this link. */
  port: number;
  /** VLESS user id shared by the originating outbound and the next inbound. */
  uuid: string;
}

interface Ss2022LinkCred {
  protocol: 'shadowsocks';
  port: number;
  /** SS2022 pre-shared key (base64), shared by both sides of the link. */
  psk: string;
  /** SS cipher. */
  method: string;
}

export type LinkCred = VlessLinkCred | Ss2022LinkCred;

/** Map a hop's stored linkProtocol (free string, full 7-core enum) to a
 *  realised native cell. Only 'shadowsocks' has a dedicated cell beyond vless;
 *  everything else rides the proven vless link (unchanged from C3). */
export function normalizeLinkProtocol(p: string | null | undefined): LinkProtocol {
  return p === 'shadowsocks' ? 'shadowsocks' : 'vless';
}

/** Pre-generate link creds for the N-1 inter-hop links of an N-hop cascade,
 *  one per link in order. `linkProtocols[i]` is the protocol of the link from
 *  hop[i] to hop[i+1] (the originating hop's linkProtocol). */
export function generateLinkCreds(linkProtocols: LinkProtocol[]): LinkCred[] {
  return linkProtocols.map((proto, i) => {
    const port = LINK_PORT_BASE + i;
    if (proto === 'shadowsocks') {
      return {
        protocol: 'shadowsocks',
        port,
        psk: randomBytes(32).toString('base64'),
        method: SS_LINK_METHOD,
      };
    }
    return { protocol: 'vless', port, uuid: randomUUID() };
  });
}

/** Serialise a link cred to the plain JSON persisted in CascadeHop.linkConfig
 *  (a typed LinkCred lacks the index signature Prisma's Json input needs). */
export function serializeLinkCred(cred: LinkCred): Record<string, string | number> {
  return cred.protocol === 'shadowsocks'
    ? { protocol: 'shadowsocks', port: cred.port, psk: cred.psk, method: cred.method }
    : { protocol: 'vless', port: cred.port, uuid: cred.uuid };
}

/** Parse a persisted linkConfig back into a LinkCred, or null if malformed. A
 *  legacy linkConfig with no `protocol` field is read as vless (the only cell
 *  that existed before C3b), so cascades created earlier keep working. */
export function parseLinkCred(raw: unknown): LinkCred | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.port !== 'number') return null;
  if (o.protocol === 'shadowsocks') {
    if (typeof o.psk !== 'string' || typeof o.method !== 'string') return null;
    return { protocol: 'shadowsocks', port: o.port, psk: o.psk, method: o.method };
  }
  if (typeof o.uuid !== 'string') return null;
  return { protocol: 'vless', port: o.port, uuid: o.uuid };
}

export type HopRole = 'entry' | 'transit' | 'exit';

export interface CascadeConfigHopInput {
  nodeId: string;
  position: number;
  /** Public host the PREVIOUS hop dials to reach this node's link inbound. */
  nodeHost: string;
}

export interface HopConfig {
  nodeId: string;
  position: number;
  role: HopRole;
  inbounds: Record<string, unknown>[];
  outbounds: Record<string, unknown>[];
  routingRules: Record<string, unknown>[];
  /** Link-IN port this hop listens on (transit/exit). The node-agent firewalls
   *  it to the previous hop. Undefined on the entry hop (no link-in). */
  linkIngressPort?: number;
  /** Address(es) of the previous hop allowed to reach linkIngressPort. */
  linkAllowFrom?: string[];
}

const LINK_IN_TAG = 'cascade-link-in';
const LINK_OUT_TAG = 'cascade-link-out';
const DIRECT_TAG = 'direct';

function vlessLinkInbound(cred: VlessLinkCred): Record<string, unknown> {
  return {
    tag: LINK_IN_TAG,
    port: cred.port,
    listen: '0.0.0.0',
    protocol: 'vless',
    settings: { clients: [{ id: cred.uuid }], decryption: 'none' },
    streamSettings: { network: 'raw', security: 'none' },
  };
}

function vlessLinkOutbound(host: string, cred: VlessLinkCred): Record<string, unknown> {
  return {
    tag: LINK_OUT_TAG,
    protocol: 'vless',
    settings: {
      vnext: [{ address: host, port: cred.port, users: [{ id: cred.uuid, encryption: 'none' }] }],
    },
    streamSettings: { network: 'raw', security: 'none' },
  };
}

// SS2022 link cell (C3b). Single shared PSK point-to-point, so no per-user
// `clients` array (unlike the multi-user SS inbound the standalone adapter
// renders). No streamSettings: SS carries its own transport over plain TCP/UDP.
function ssLinkInbound(cred: Ss2022LinkCred): Record<string, unknown> {
  return {
    tag: LINK_IN_TAG,
    port: cred.port,
    listen: '0.0.0.0',
    protocol: 'shadowsocks',
    settings: { method: cred.method, password: cred.psk, network: 'tcp,udp' },
  };
}

function ssLinkOutbound(host: string, cred: Ss2022LinkCred): Record<string, unknown> {
  return {
    tag: LINK_OUT_TAG,
    protocol: 'shadowsocks',
    settings: {
      servers: [{ address: host, port: cred.port, method: cred.method, password: cred.psk }],
    },
  };
}

function linkInbound(cred: LinkCred): Record<string, unknown> {
  return cred.protocol === 'shadowsocks' ? ssLinkInbound(cred) : vlessLinkInbound(cred);
}

function linkOutbound(host: string, cred: LinkCred): Record<string, unknown> {
  return cred.protocol === 'shadowsocks'
    ? ssLinkOutbound(host, cred)
    : vlessLinkOutbound(host, cred);
}

const freedomOutbound: Record<string, unknown> = { tag: DIRECT_TAG, protocol: 'freedom' };

export function buildCascadeConfigs(
  hops: CascadeConfigHopInput[],
  linkCreds: LinkCred[],
): HopConfig[] {
  const sorted = [...hops].sort((a, b) => a.position - b.position);
  const n = sorted.length;
  return sorted.map((hop, i) => {
    const role: HopRole = i === 0 ? 'entry' : i === n - 1 ? 'exit' : 'transit';
    const linkIn = i > 0 ? linkCreds[i - 1] : null;
    const linkOut = i < n - 1 ? linkCreds[i] : null;

    const inbounds = linkIn ? [linkInbound(linkIn)] : [];
    const outbounds: Record<string, unknown>[] = [];
    if (linkOut) outbounds.push(linkOutbound(sorted[i + 1]!.nodeHost, linkOut));
    outbounds.push(freedomOutbound);

    const routingRules: Record<string, unknown>[] = [];
    if (role === 'entry') {
      // User traffic -> link-out. Split-routing presets can prepend
      // direct/block rules ahead of this later (E).
      routingRules.push({ type: 'field', network: 'tcp,udp', outboundTag: LINK_OUT_TAG });
    } else if (role === 'transit') {
      routingRules.push({ type: 'field', inboundTag: [LINK_IN_TAG], outboundTag: LINK_OUT_TAG });
    } else {
      routingRules.push({ type: 'field', inboundTag: [LINK_IN_TAG], outboundTag: DIRECT_TAG });
    }

    // The link-in (when present) is dialed by the PREVIOUS hop, so the agent
    // firewalls this hop's link port to that hop's host.
    const linkIngressPort = linkIn ? linkIn.port : undefined;
    const linkAllowFrom = linkIn ? [sorted[i - 1]!.nodeHost] : undefined;

    return {
      nodeId: hop.nodeId,
      position: hop.position,
      role,
      inbounds,
      outbounds,
      routingRules,
      linkIngressPort,
      linkAllowFrom,
    };
  });
}
