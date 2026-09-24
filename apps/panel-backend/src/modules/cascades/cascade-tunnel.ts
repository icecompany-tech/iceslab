import { randomInt } from 'node:crypto';
import { LINK_TUNNEL_IFACE_PREFIX, type LinkUnderlay } from '@iceslab/shared';
import { generateWireguardKeyPair } from '../../lib/auth/credentials.js';
import type { LegParams } from './direction-merge.js';

/**
 * Phase 8: the AmneziaWG tunnel under a cascade leg (`linkParams.underlay:
 * 'awg'`).
 *
 * The leg's cell is unchanged and goes INSIDE the tunnel, to the tunnel's
 * inner address on the receiving hop, so the chain process there stays in the
 * path. The tunnel is one per node PAIR of a cascade (CascadeTunnel), and
 * everything a machine could collide on is derived from its panel-wide index:
 * the interface name, the inner /30 and the UDP port.
 */

/**
 * The inner network of every leg tunnel: 10.67.0.0/16, cut into /30s.
 *
 * Its own block, apart from the users' AmneziaWG subnet (10.66.66.0/24 by
 * default, see the Aeza gotcha that moved it off 10.0.0.0/24): a leg tunnel
 * and a user interface on one node must never route each other's addresses,
 * and one /16 for the legs keeps the two apart by construction. A /30 per
 * tunnel is exactly the two ends it has.
 */
export const LINK_TUNNEL_NET_PREFIX = '10.67';

/**
 * The UDP port of a tunnel's receiving end: LINK_TUNNEL_PORT_BASE + index.
 *
 * Above the other ranges a hop already holds, so it meets none of them: legs
 * at LINK_PORT_BASE (24000) + step, the chain's tproxy listener at 25000, its
 * socks listeners at 26000 + tag (tag <= 255). MAX_LINK_TUNNELS keeps it
 * below 28000.
 */
export const LINK_TUNNEL_PORT_BASE = 27000;

/** How many leg tunnels the panel can hold at once, all cascades together. */
export const MAX_LINK_TUNNELS = 1000;

/** The interface name: awg-l<index>, at most 10 characters (Linux allows 15). */
export function tunnelIface(index: number): string {
  return `${LINK_TUNNEL_IFACE_PREFIX}${index}`;
}

export function tunnelPort(index: number): number {
  return LINK_TUNNEL_PORT_BASE + index;
}

/**
 * The two inner addresses of a tunnel's /30: `.1` on the dialling end, `.2`
 * on the receiving one. 64 /30s per third octet: index 0 is 10.67.0.0/30,
 * index 64 is 10.67.1.0/30.
 */
export function tunnelAddresses(index: number): { network: string; from: string; to: string } {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_LINK_TUNNELS) {
    throw new RangeError(`leg tunnel index ${index} is out of range`);
  }
  const third = Math.floor(index / 64);
  const base = (index % 64) * 4;
  const net = `${LINK_TUNNEL_NET_PREFIX}.${third}`;
  return { network: `${net}.${base}/30`, from: `${net}.${base + 1}`, to: `${net}.${base + 2}` };
}

/**
 * The obfuscation of one tunnel, AmneziaWG 1.x, every field set.
 *
 * ⚠ S3 and S4 are NON-ZERO here, and that is deliberate against what the
 * users' AWG does. The users' presets force S3=S4=0 because the AmneziaVPN
 * CLIENT (4.8.15.x) drops traffic when they are set (upstream issue #2582).
 * A leg tunnel has no client app at either end: both ends are the kernel
 * module of our own nodes, which takes them, so the leg gets the full set.
 */
export interface TunnelObfuscation {
  jc: number;
  jmin: number;
  jmax: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
}

/** One end of the tunnel: its key pair. The address follows from the index. */
export interface TunnelEnd {
  privateKey: string;
  publicKey: string;
}

/** What CascadeTunnel.config holds. */
export interface TunnelCred {
  from: TunnelEnd;
  to: TunnelEnd;
  obfuscation: TunnelObfuscation;
}

/**
 * Fresh obfuscation within the bounds the users' schema checks against
 * (inbounds.schemas.ts, AmneziaWG 2.0 ranges the fleet module accepts): Jc
 * 0..10, Jmin/Jmax 64..1024, S1-S3 0..64, S4 0..32, H1-H4 > 4 and pairwise
 * distinct, and S1 + 56 != S2 (that is the vanilla WireGuard handshake length).
 */
export function newTunnelObfuscation(): TunnelObfuscation {
  const jmin = randomInt(64, 257);
  const jmax = randomInt(jmin + 64, Math.min(jmin + 512, 1024) + 1);
  const s1 = randomInt(16, 65);
  let s2 = randomInt(16, 65);
  if (s1 + 56 === s2) s2 = s2 === 64 ? 63 : s2 + 1;
  const headers = new Set<number>();
  while (headers.size < 4) headers.add(randomInt(5, 2 ** 31));
  const [h1, h2, h3, h4] = [...headers] as [number, number, number, number];
  return {
    jc: randomInt(3, 9),
    jmin,
    jmax,
    s1,
    s2,
    s3: randomInt(8, 65),
    s4: randomInt(1, 33),
    h1,
    h2,
    h3,
    h4,
  };
}

export function newTunnelCred(): TunnelCred {
  return { from: generateWireguardKeyPair(), to: generateWireguardKeyPair(), obfuscation: newTunnelObfuscation() };
}

/** The stored cred, or null when it is not whole: half a tunnel is no tunnel. */
export function parseTunnelCred(raw: unknown): TunnelCred | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const end = (e: unknown): TunnelEnd | null => {
    const x = e as Record<string, unknown> | null;
    return x && typeof x.privateKey === 'string' && typeof x.publicKey === 'string'
      ? { privateKey: x.privateKey, publicKey: x.publicKey }
      : null;
  };
  const from = end(o.from);
  const to = end(o.to);
  const ob = o.obfuscation as Record<string, unknown> | null;
  const keys = ['jc', 'jmin', 'jmax', 's1', 's2', 's3', 's4', 'h1', 'h2', 'h3', 'h4'] as const;
  if (!from || !to || !ob || !keys.every((k) => typeof ob[k] === 'number')) return null;
  const obfuscation = Object.fromEntries(keys.map((k) => [k, ob[k] as number])) as unknown as TunnelObfuscation;
  return { from, to, obfuscation };
}

/**
 * The node pairs of a topology whose leg rides an AWG tunnel.
 *
 * The same walk as the cells (generateTopologyLinks, walkReceivingLegs) and the
 * same fallback, read off `linkParams.underlay`: a position's leg by its own
 * params, the last leg by the direction's, and a direction that names no
 * underlay takes the last position's. Absent everywhere is `direct`.
 *
 * Deduplicated per pair: every direction crossing A to B rides one tunnel. A
 * pair with an `awg` leg and a `direct` one (two directions over the same exit
 * node, choosing differently) still gets its tunnel, and each leg goes the way
 * it chose.
 */
export function topologyTunnelPairs(
  positions: { position?: number; nodeIds: string[]; linkParams?: LegParams | null }[],
  directions: { nodeIds: string[]; linkParams?: LegParams | null }[],
): { fromNodeId: string; toNodeId: string }[] {
  const ordered =
    positions.every((p) => typeof p.position === 'number')
      ? [...positions].sort((a, b) => a.position! - b.position!)
      : positions;
  const seen = new Set<string>();
  const out: { fromNodeId: string; toNodeId: string }[] = [];
  const add = (from: string, to: string, underlay: LinkUnderlay | undefined): void => {
    if (underlay !== 'awg' || from === to) return;
    const key = `${from}|${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ fromNodeId: from, toNodeId: to });
  };
  for (let step = 0; step < ordered.length - 1; step++) {
    const underlay = ordered[step]!.linkParams?.underlay;
    for (const from of ordered[step]!.nodeIds) {
      for (const to of ordered[step + 1]!.nodeIds) add(from, to, underlay);
    }
  }
  const last = ordered[ordered.length - 1];
  if (last) {
    for (const d of directions) {
      const underlay = d.linkParams?.underlay ?? last.linkParams?.underlay;
      for (const from of last.nodeIds) {
        for (const to of d.nodeIds) add(from, to, underlay);
      }
    }
  }
  return out;
}

/**
 * What ONE leg rides on, by the same fallback as topologyTunnelPairs: the last
 * leg (last position into a direction's pool) by the direction, else by the
 * last position; a leg between two positions by the position it leaves.
 */
export function legUnderlay(
  positions: { position: number; nodeIds: string[]; linkParams?: LegParams | null }[],
  directions: { tag: number; nodeIds: string[]; linkParams?: LegParams | null }[],
  from: string,
  to: string,
  tag: number,
): LinkUnderlay {
  const ordered = [...positions].sort((a, b) => a.position - b.position);
  const last = ordered[ordered.length - 1];
  const direction = directions.find((d) => d.tag === tag);
  if (last && direction && last.nodeIds.includes(from) && direction.nodeIds.includes(to)) {
    return direction.linkParams?.underlay ?? last.linkParams?.underlay ?? 'direct';
  }
  for (let step = 0; step < ordered.length - 1; step++) {
    if (ordered[step]!.nodeIds.includes(from) && ordered[step + 1]!.nodeIds.includes(to)) {
      return ordered[step]!.linkParams?.underlay ?? 'direct';
    }
  }
  return 'direct';
}

/**
 * Where a node's link-in listens, given the legs that arrive on it.
 *
 * The inner addresses of its tunnels ONLY when every leg into it rides one: then
 * the leg's port is not open to the internet at all. One leg over the internet
 * (a direction reaching the node directly beside one reaching it through a
 * tunnel) keeps the single 0.0.0.0 listener for all of them, because a wildcard
 * and a specific address cannot share a port; the tunnelled leg still arrives
 * through its tunnel, at an inner address the wildcard includes.
 *
 * `undefined` is that wildcard. ONE rule for the renderer (chainInputFor) and
 * for the screen (publicLinkPortOpen on the cascade DTO), so the screen cannot
 * promise a closed port the node keeps open.
 */
export function linkInListen<L>(
  incoming: L[],
  tunnelUnder: (leg: L) => { index: number } | undefined,
): string[] | undefined {
  if (incoming.length === 0) return undefined;
  const under = incoming.map(tunnelUnder);
  if (under.some((t) => t === undefined)) return undefined;
  return [...new Set(under.map((t) => tunnelAddresses(t!.index).to))];
}

/** A stored tunnel as the renderers take it. */
export interface TopologyTunnel {
  fromNodeId: string;
  toNodeId: string;
  index: number;
  port: number;
  cred: TunnelCred;
}

/**
 * The awg-quick config of one END of a tunnel, verbatim as the agent writes it.
 *
 *   dialling end   Address .1/30, one [Peer] with the receiving end's public
 *                  host and the tunnel's port, keepalive so the NAT on a
 *                  hosting provider does not forget it;
 *   receiving end  Address .2/30, ListenPort, one [Peer] without an endpoint
 *                  (it learns it from the first handshake).
 *
 * `Table = off`: awg-quick adds no routes and no policy rules. The /30 on
 * the interface is all the routing a leg needs, since it dials the other
 * end's inner address and nothing else. No PostUp and no PostDown: nothing is
 * forwarded or NATed through the tunnel, and the agent refuses them anyway.
 */
export function renderTunnelConf(t: TopologyTunnel, end: 'from' | 'to', peerHost?: string): string {
  const addr = tunnelAddresses(t.index);
  const me = end === 'from' ? t.cred.from : t.cred.to;
  const peer = end === 'from' ? t.cred.to : t.cred.from;
  const o = t.cred.obfuscation;
  const lines = [
    '[Interface]',
    `PrivateKey = ${me.privateKey}`,
    `Address = ${end === 'from' ? addr.from : addr.to}/30`,
    ...(end === 'to' ? [`ListenPort = ${t.port}`] : []),
    'Table = off',
    `Jc = ${o.jc}`,
    `Jmin = ${o.jmin}`,
    `Jmax = ${o.jmax}`,
    `S1 = ${o.s1}`,
    `S2 = ${o.s2}`,
    `S3 = ${o.s3}`,
    `S4 = ${o.s4}`,
    `H1 = ${o.h1}`,
    `H2 = ${o.h2}`,
    `H3 = ${o.h3}`,
    `H4 = ${o.h4}`,
    '',
    '[Peer]',
    `PublicKey = ${peer.publicKey}`,
    `AllowedIPs = ${end === 'from' ? addr.to : addr.from}/32`,
    ...(end === 'from' && peerHost
      ? [`Endpoint = ${peerHost.includes(':') ? `[${peerHost}]` : peerHost}:${t.port}`, 'PersistentKeepalive = 25']
      : []),
    '',
  ];
  return lines.join('\n');
}

/** The smallest indexes not in `used`, as many as asked for. */
export function freeTunnelIndexes(used: ReadonlySet<number>, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < MAX_LINK_TUNNELS && out.length < count; i++) {
    if (!used.has(i)) out.push(i);
  }
  if (out.length < count) {
    throw new Error(`no free leg tunnel index: the panel holds ${MAX_LINK_TUNNELS} already`);
  }
  return out;
}
