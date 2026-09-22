import type { LinkCell } from '@iceslab/shared';
import { LINK_PORT_BASE, type LinkCred } from './cascade.config.js';
import { chainSocksPort } from './chain.ports.js';
import { LINK_TLS_SERVER_NAME, pemLines, type LinkTls } from './link-tls.js';

/**
 * The chain as its own process: one sing-box config per node, rendered here.
 *
 * Phase 4. The user's core stops drawing the chain and hands traffic to a
 * loopback socks listener instead; this process owns the stages, the ways out
 * and the protections. The PANEL renders it, verbatim JSON, for the same
 * reason it has always rendered the xray cascade fragments: one renderer, one
 * chain engine, and a described shape in the middle would only go stale
 * against the engine's own schema.
 *
 * ⚠ Every shape below was checked against the pinned sing-box v1.13.14 with
 * `sing-box check`, not read off a document: the rule ACTIONS (sniff,
 * hijack-dns, reject+method, route+outbound), the socks inbound with users,
 * the vless link with REALITY on both ends, the SS2022 link, and matching a
 * transit's traffic by the link user it arrived on. The tests re-ask the
 * binary, so this comment cannot quietly become false.
 */

/** The loopback ports the user's core hands traffic over on. Shared with the
 *  xray side of the handover, which is why they live in their own file. */
export { CHAIN_SOCKS_BASE, chainSocksPort } from './chain.ports.js';

export type ChainRole = 'entry' | 'transit' | 'exit';

/**
 * How the chain chooses between several ways of getting somewhere.
 *
 * The numbers are NOT sing-box defaults: they are the ones the xray entry has
 * been measuring with, moved across unchanged, so the handover does not quietly
 * change how fast a dead hop is noticed. `interval` IS the failure-detection
 * window (a leg that fails its probe drops out of the group), and it was
 * shortened to a minute on 2026-08-15 after a stopped Dutch exit kept receiving
 * traffic from one entry while the other had already moved on.
 *
 * `tolerance` has no counterpart on the xray side, where `leastPing` simply
 * takes the lowest number. 50ms of hysteresis keeps two legs that measure the
 * same within noise from swapping on every probe, which costs a reconnect each
 * time for no gain.
 */
export const CHAIN_PROBE_URL = 'https://www.gstatic.com/generate_204';
export const CHAIN_PROBE_INTERVAL = '1m';
export const CHAIN_PROBE_TOLERANCE_MS = 50;

/** A leg out of this node, towards the next hop, carrying one direction. */
export interface ChainLegOut {
  /** Direction this leg serves. 0 = the Auto line. */
  tag: number;
  /** Public host of the node on the other end. */
  host: string;
  cred: LinkCred;
}

/** The leg this node RECEIVES on, with one credential per direction. */
export interface ChainLegIn {
  cred: LinkCred;
  /**
   * Which direction each arriving credential belongs to.
   *
   * `shortId` is the REALITY short id of THAT leg. The keypair belongs to this
   * node (one listener, one `private_key`, which is all the engine takes), and
   * the short ids are per leg and travel as a list: measured against sing-box
   * 1.13.14, `short_id` on an inbound is a list and on an outbound a single
   * string, which is exactly this shape.
   */
  clients: { tag: number; uuid?: string; shortId?: string }[];
}

export interface ChainRenderInput {
  role: ChainRole;
  /** Password for every socks listener. Generated panel-side, kept on the node. */
  socksPassword: string;
  /** Direction tags this node offers the user core. Entry only. */
  directionTags?: number[];
  /** Legs out of here, one per direction. Empty on an exit. */
  out?: ChainLegOut[];
  /** The leg arriving here. Absent on an entry. */
  in?: ChainLegIn;
  /** The node-level policy, already resolved. */
  policy?: { directDomains?: string[]; blockDomains?: string[] } | null;
}

type Json = Record<string, unknown>;

/** Outbound tag for a direction. Names the DIRECTION, so it survives the node
 *  behind it being replaced. */
function outTag(tag: number): string {
  return `out-d${tag}`;
}

/** Inbound tag for the socks listener of a direction. */
function socksTag(tag: number): string {
  return `in-d${tag}`;
}

/** One leg INSIDE a pooled direction. Only used when a direction has more than
 *  one, so a direction with a single way on keeps `out-d<tag>` on the leg
 *  itself and its config does not change shape for a feature it does not use. */
function poolLegTag(tag: number, idx: number): string {
  return `${outTag(tag)}-${idx}`;
}

/** The Auto line's direction tag. Zero by construction: direction tags are
 *  issued from a counter starting at 1, so nothing else can claim it. */
const AUTO_TAG = 0;

/**
 * A group that picks the fastest of what it is given.
 *
 * This is what the xray entry's `observatory` + `leastPing` pair becomes once
 * the choosing moves into the chain process. Two shapes use it and they mean
 * different things: across the legs of ONE direction it answers "which of these
 * interchangeable nodes is fastest", and across directions it is the Auto line,
 * "fastest way out of here at all".
 */
function urltestOutbound(tag: string, over: string[]): Json {
  return {
    type: 'urltest',
    tag,
    outbounds: over,
    url: CHAIN_PROBE_URL,
    interval: CHAIN_PROBE_INTERVAL,
    tolerance: CHAIN_PROBE_TOLERANCE_MS,
  };
}

/** The name a link credential carries, which is how a TRANSIT tells directions
 *  apart: it sees an internal link, not a user, so the only thing that says
 *  "this is headed for direction 7" is which credential it arrived on. */
export function chainLinkUser(tag: number): string {
  return `lnk-d${tag}`;
}

/**
 * Which CELL a stored credential is, as the renderer branches on it.
 *
 * ⚠ A cell is not the same dictionary as a protocol, and this function is the
 * one place the two meet: `LinkCred.protocol` is what the panel stored when the
 * leg was generated, `LinkCell` is what this file renders. Today they coincide
 * on the two cells that exist; phase 5 adds `hy2` and `tuic`, which have no
 * `LinkCred` variants yet, and this is where they will be recognised.
 *
 * Written as a function rather than read inline so the switches below branch on
 * ONE vocabulary. They used to ask `cred.protocol === 'shadowsocks'` and treat
 * everything else as vless, which is the shape that silently turns an unknown
 * cell into a vless leg.
 */
function cellOf(cred: LinkCred): LinkCell {
  return cred.protocol;
}

/**
 * The TLS block a QUIC leg wears, on either end.
 *
 * ⚠ INLINE PEM, no path on the node, and `insecure: false` on the dialling
 * side with the SAME certificate as a pin. Both halves of that are the point:
 * a path means the key lives outside the panel, and `insecure: true` means the
 * next hop is whoever answers on that address first. Asked of sing-box 1.13.14
 * with `check`: inline `certificate` / `key` are accepted on both sides.
 *
 * The name is a constant, not a domain: a leg has no name to verify, so the
 * trust anchor IS the certificate, and the SNI exists because TLS insists.
 */
function legTlsIn(tls: LinkTls): Json {
  return {
    enabled: true,
    server_name: LINK_TLS_SERVER_NAME,
    certificate: pemLines(tls.certPem),
    key: pemLines(tls.keyPem),
  };
}

function legTlsOut(tls: LinkTls): Json {
  return {
    enabled: true,
    // Never true. See above.
    insecure: false,
    server_name: LINK_TLS_SERVER_NAME,
    certificate: pemLines(tls.certPem),
  };
}

function hy2Outbound(tag: number, host: string, cred: Extract<LinkCred, { protocol: 'hy2' }>): Json {
  return {
    type: 'hysteria2',
    tag: outTag(tag),
    server: host,
    server_port: cred.port,
    password: cred.authPassword,
    // Salamander, so the leg does not look like QUIC-with-a-hat-on. Both ends
    // carry the same salt or neither end sees the other's packets as valid.
    obfs: { type: 'salamander', password: cred.obfsPassword },
    tls: legTlsOut(cred.tls),
  };
}

function tuicOutbound(
  tag: number,
  host: string,
  cred: Extract<LinkCred, { protocol: 'tuic' }>,
): Json {
  return {
    type: 'tuic',
    tag: outTag(tag),
    server: host,
    server_port: cred.port,
    uuid: cred.uuid,
    password: cred.password,
    congestion_control: cred.congestion,
    tls: legTlsOut(cred.tls),
  };
}

function hy2Inbound(cred: Extract<LinkCred, { protocol: 'hy2' }>): Json {
  return {
    type: 'hysteria2',
    tag: 'link-in',
    listen: '0.0.0.0',
    listen_port: cred.port,
    users: [{ password: cred.authPassword }],
    obfs: { type: 'salamander', password: cred.obfsPassword },
    tls: legTlsIn(cred.tls),
  };
}

function tuicInbound(cred: Extract<LinkCred, { protocol: 'tuic' }>): Json {
  return {
    type: 'tuic',
    tag: 'link-in',
    listen: '0.0.0.0',
    listen_port: cred.port,
    users: [{ uuid: cred.uuid, password: cred.password }],
    congestion_control: cred.congestion,
    tls: legTlsIn(cred.tls),
  };
}

function vlessOutbound(tag: number, host: string, cred: Extract<LinkCred, { protocol: 'vless' }>): Json {
  const out: Json = {
    type: 'vless',
    tag: outTag(tag),
    server: host,
    server_port: cred.port,
    uuid: cred.uuid,
    // Named only when the other end names it, see the listener. Asking for a
    // flow the server does not offer is refused at the handshake, and `check`
    // accepts the mismatch on both sides, so nothing but this rule prevents it.
    ...(cred.reality ? { flow: 'xtls-rprx-vision' } : {}),
  };
  if (cred.reality) {
    out.tls = {
      enabled: true,
      server_name: cred.reality.serverName,
      // ⚠ MEASURED, and not optional: sing-box 1.13.14 refuses a reality client
      // without it, "uTLS is required by reality client". `firefox` rather than
      // `chrome` so this renderer and the legacy xray one present the same
      // fingerprint: two engines drawing one leg should not be distinguishable
      // from each other by the thing whose whole job is to look ordinary.
      utls: { enabled: true, fingerprint: 'firefox' },
      // A single string here, a LIST on the listener. Measured: an array is
      // refused, "cannot unmarshal array into ... short_id of type string".
      reality: { enabled: true, public_key: cred.reality.publicKey, short_id: cred.reality.shortId },
    };
  }
  return out;
}

function ssOutbound(
  tag: number,
  host: string,
  cred: Extract<LinkCred, { protocol: 'shadowsocks' }>,
): Json {
  return {
    type: 'shadowsocks',
    tag: outTag(tag),
    server: host,
    server_port: cred.port,
    method: cred.method,
    password: cred.psk,
  };
}

/**
 * The listener this node receives a leg on, one branch per CELL.
 *
 * A switch and not an if, so that adding a cell to LINK_CELLS without a branch
 * here is a compile error rather than a leg quietly rendered as vless. The
 * guard beside this file reads these branch labels.
 */
function linkInbound(leg: ChainLegIn): Json {
  switch (cellOf(leg.cred)) {
    case 'shadowsocks':
      return ssInbound(leg.cred as Extract<LinkCred, { protocol: 'shadowsocks' }>);
    case 'hy2':
      return hy2Inbound(leg.cred as Extract<LinkCred, { protocol: 'hy2' }>);
    case 'tuic':
      return tuicInbound(leg.cred as Extract<LinkCred, { protocol: 'tuic' }>);
    case 'vless':
      return vlessInbound(leg);
    default: {
      // Unreachable while LINK_CELLS and the branches above agree, which is
      // what the composition guard exists to keep true. If it ever is reached,
      // rendering nothing beats rendering the wrong cell: a leg that does not
      // come up is visible, a leg that comes up as the wrong protocol is a
      // chain that silently carries traffic the operator did not choose.
      const cell: never = cellOf(leg.cred) as never;
      throw new Error(`chain: no inbound renderer for link cell ${String(cell)}`);
    }
  }
}

/** SS2022 carries one key per listener, so a shadowsocks leg cannot tell
 *  directions apart by credential. It is the cell the operator chose, and the
 *  routing falls back to the default way out for it. */
function ssInbound(cred: Extract<LinkCred, { protocol: 'shadowsocks' }>): Json {
  return {
    type: 'shadowsocks',
    tag: 'link-in',
    listen: '0.0.0.0',
    listen_port: cred.port,
    method: cred.method,
    password: cred.psk,
  };
}

function vlessInbound(leg: ChainLegIn): Json {
  const cred = leg.cred as Extract<LinkCred, { protocol: 'vless' }>;
  const reality = cred.reality;
  const inbound: Json = {
    type: 'vless',
    tag: 'link-in',
    listen: '0.0.0.0',
    listen_port: cred.port,
    users: leg.clients.map((c) => ({
      uuid: c.uuid ?? cred.uuid,
      name: chainLinkUser(c.tag),
      // ⚠ VISION is per USER and both ends must name it. The dialling side of
      // this very file used to set it unconditionally while the listener set it
      // for nobody, which is a pair that completes no handshake: the server
      // rejects a client that asks for a flow it does not offer. Tied to the
      // block on both sides now, so the two cannot drift apart again.
      ...(reality ? { flow: 'xtls-rprx-vision' } : {}),
    })),
  };
  if (reality) {
    const [handshakeServer, handshakePort] = splitDest(reality.dest, reality.serverName);
    inbound.tls = {
      enabled: true,
      server_name: reality.serverName,
      reality: {
        enabled: true,
        // From the STORED dest, not rebuilt from the server name. The two are
        // the same today and `check` accepts an inbound with no handshake block
        // at all, so nothing but this would notice them drifting apart.
        handshake: { server: handshakeServer, server_port: handshakePort },
        private_key: reality.privateKey,
        /**
         * Every short id that arrives on this listener, not just the first.
         *
         * One node, one listener, one `private_key`: that is all the engine
         * takes, so the keypair belongs to the RECEIVING node and the short ids
         * are per leg. Rendering only `[cred.shortId]` was right while a leg
         * had a listener of its own and silently drops every other direction's
         * leg the moment a step carries more than one.
         */
        short_id: shortIdsOf(leg),
      },
    };
  }
  return inbound;
}

/**
 * The short ids arriving on one listener, deduplicated and in a stable order.
 *
 * The cred's own is included because a leg that carries a single direction has
 * its short id there and nowhere else. An empty result is impossible while the
 * block exists, and would be refused by the engine if it were.
 */
function shortIdsOf(leg: ChainLegIn): string[] {
  const cred = leg.cred as Extract<LinkCred, { protocol: 'vless' }>;
  const ids = [
    ...leg.clients.map((c) => c.shortId),
    ...(cred.reality ? [cred.reality.shortId] : []),
  ].filter((s): s is string => typeof s === 'string' && s.length > 0);
  return [...new Set(ids)];
}

/**
 * `host:port` as the credential stores it, with the server name as the fallback.
 *
 * ⚠ MEASURED: sing-box 1.13.14 accepts a reality inbound with NO handshake
 * block at all, so a missing or malformed target is not a config error, it is a
 * leg that comes up and fails every handshake. The fallback is therefore the
 * camouflage name rather than nothing.
 */
function splitDest(dest: string, serverName: string): [string, number] {
  const at = dest.lastIndexOf(':');
  if (at <= 0) return [serverName, 443];
  const port = Number.parseInt(dest.slice(at + 1), 10);
  return [dest.slice(0, at), Number.isFinite(port) && port > 0 ? port : 443];
}

/**
 * The rules, in the order the traffic meets them, and by ACTION.
 *
 * The order is the design. Sniffing first, because every rule after it that
 * names a domain or a protocol has nothing to match on until it has run.
 * DNS next, so a user's lookups are answered by this node's resolver instead
 * of leaving the chain. Then the two protections, then the operator's policy,
 * then the ways out.
 *
 * The protections come BEFORE the policy on purpose: an operator's rule must
 * not be able to route port 25 or a torrent handshake out of an exit, whatever
 * else it says. They are on every role, not only the exit, because a transit
 * that forwards them has already carried them across a border.
 */
function protectionRules(): Json[] {
  return [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' },
    // `drop` rather than the default refusal: a refused connection tells the
    // other end something is filtering, a dropped one looks like the internet.
    { port: [25], action: 'reject', method: 'drop' },
    { protocol: 'bittorrent', action: 'reject', method: 'drop' },
  ];
}

/** How many rules of the block above every role must carry. Exported so the
 *  test counts the same number the renderer writes, and a change has to be
 *  made in one place with a reason. */
export const CHAIN_PROTECTION_RULES = 4;

function policyRules(policy: ChainRenderInput['policy']): Json[] {
  const rules: Json[] = [];
  const block = policy?.blockDomains?.filter((d) => d.length > 0) ?? [];
  const direct = policy?.directDomains?.filter((d) => d.length > 0) ?? [];
  if (block.length > 0) {
    rules.push({ domain_suffix: block, action: 'reject', method: 'drop' });
  }
  if (direct.length > 0) {
    rules.push({ domain_suffix: direct, action: 'route', outbound: 'direct' });
  }
  return rules;
}

/**
 * One node's chain config.
 *
 * Pure: everything it needs arrives in the input, and the same input renders
 * the same bytes. That is what makes a golden meaningful and what lets the
 * test ask the engine about the result without a database or a node.
 */
export function renderChainConfig(input: ChainRenderInput): Json {
  const inbounds: Json[] = [];
  const outbounds: Json[] = [];
  const rules: Json[] = [...protectionRules(), ...policyRules(input.policy)];

  if (input.role === 'entry') {
    for (const tag of input.directionTags ?? []) {
      inbounds.push({
        type: 'socks',
        tag: socksTag(tag),
        listen: '127.0.0.1',
        listen_port: chainSocksPort(tag),
        // Authenticated even on loopback: a VPS has other users, and an open
        // proxy on 127.0.0.1 is an open relay for anyone with a shell.
        users: [{ username: 'chain', password: input.socksPassword }],
      });
    }
  } else if (input.in) {
    inbounds.push(linkInbound(input.in));
  }

  /**
   * The ways out, one entry per DIRECTION whatever it takes to get there.
   *
   * Three shapes, and the rules above them cannot tell which they got:
   *   - one leg: the leg carries `out-d<tag>` itself, exactly as before, so a
   *     plain direction's config does not change for a feature it does not use;
   *   - several legs (a pool on the next step): each leg gets its own tag and
   *     `out-d<tag>` becomes the group that picks the fastest of them;
   *   - the Auto line: no leg of its own, `out-d0` is the group over every
   *     other direction's way out.
   */
  const legsByDirection = new Map<number, ChainLegOut[]>();
  for (const leg of input.out ?? []) {
    const list = legsByDirection.get(leg.tag) ?? [];
    list.push(leg);
    legsByDirection.set(leg.tag, list);
  }
  /** One leg out, one branch per CELL. Same switch as the inbound side, for the
   *  same reason: a new cell must not fall through into vless. */
  const renderLeg = (tag: string, leg: ChainLegOut): Json => {
    switch (cellOf(leg.cred)) {
      case 'shadowsocks':
        return {
          ...ssOutbound(leg.tag, leg.host, leg.cred as Extract<LinkCred, { protocol: 'shadowsocks' }>),
          tag,
        };
      case 'hy2':
        return {
          ...hy2Outbound(leg.tag, leg.host, leg.cred as Extract<LinkCred, { protocol: 'hy2' }>),
          tag,
        };
      case 'tuic':
        return {
          ...tuicOutbound(leg.tag, leg.host, leg.cred as Extract<LinkCred, { protocol: 'tuic' }>),
          tag,
        };
      case 'vless':
        return {
          ...vlessOutbound(leg.tag, leg.host, leg.cred as Extract<LinkCred, { protocol: 'vless' }>),
          tag,
        };
      default: {
        const cell: never = cellOf(leg.cred) as never;
        throw new Error(`chain: no outbound renderer for link cell ${String(cell)}`);
      }
    }
  };

  const directionsWithLegs: number[] = [];
  for (const [tag, legs] of [...legsByDirection.entries()].sort((a, b) => a[0] - b[0])) {
    directionsWithLegs.push(tag);
    if (legs.length === 1) {
      outbounds.push(renderLeg(outTag(tag), legs[0]!));
      continue;
    }
    const legTags = legs.map((_, i) => poolLegTag(tag, i));
    legs.forEach((leg, i) => outbounds.push(renderLeg(legTags[i]!, leg)));
    outbounds.push(urltestOutbound(outTag(tag), legTags));
  }

  // The Auto line, when the entry offers one. It spans the ways out rather than
  // the raw legs, so a pooled direction is entered through its own group and
  // the choice stays "fastest way out", not "fastest single node anywhere".
  const wantsAuto =
    input.role === 'entry' &&
    (input.directionTags ?? []).includes(AUTO_TAG) &&
    !legsByDirection.has(AUTO_TAG);
  if (wantsAuto && directionsWithLegs.length > 0) {
    outbounds.push(urltestOutbound(outTag(AUTO_TAG), directionsWithLegs.map(outTag)));
  }
  // The way out of the last hop, and the target of the policy's direct rules
  // everywhere else. No `block` and no `dns` outbound anywhere: those are the
  // legacy way of expressing what the actions above now say, and having both
  // is how a config comes to refuse traffic in two places with two answers.
  outbounds.push({ type: 'direct', tag: 'direct' });

  if (input.role === 'entry') {
    for (const tag of input.directionTags ?? []) {
      // Asked of the OUTBOUNDS, not of the legs: the Auto line has no leg of
      // its own and still has a way out, and a rule pointing at a tag nothing
      // defines is a config sing-box refuses to load.
      const hasWayOut = outbounds.some((o) => o.tag === outTag(tag));
      if (!hasWayOut) continue;
      rules.push({ inbound: [socksTag(tag)], action: 'route', outbound: outTag(tag) });
    }
  } else if (input.role === 'transit' && input.in?.cred.protocol === 'vless') {
    // A transit sees links, not users: which credential the traffic arrived on
    // is the only thing that says which way out it was headed for.
    for (const client of input.in.clients) {
      const leg = (input.out ?? []).find((l) => l.tag === client.tag);
      if (!leg) continue;
      rules.push({
        user: [chainLinkUser(client.tag)],
        action: 'route',
        outbound: outTag(client.tag),
      });
    }
  }

  return {
    log: { level: 'warn' },
    inbounds,
    outbounds,
    route: { rules },
  };
}

/** The link port a receiving step listens on. Re-exported so a caller building
 *  a chain input does not have to import two modules to know one number. */
export { LINK_PORT_BASE };
