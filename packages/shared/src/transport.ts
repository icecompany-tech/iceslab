/**
 * DTOs for the panel→node REST+mTLS API.
 *
 * These types are the wire-format contract. The Go node-agent reimplements
 * matching structs with json tags; the panel-backend imports them directly.
 *
 * Byte counts are typed as `number` for ergonomics, values comfortably fit
 * in a JS double for any realistic single-period traffic. Lifetime totals
 * may eventually need string encoding; revisit when quotas exceed ~8 PB.
 */

/**
 * Every protocol name that can appear on the wire.
 *
 * Declared as an array and the type derived from it, rather than as a union of
 * literals, so the COMPOSITION can be checked at runtime. A hand-written union
 * of literals is invisible to anything but the compiler, and the compiler is
 * blind here by construction: JSON arrives parsed as whatever it was declared
 * to be, so a name the agent sends and this list omits is simply mistyped and
 * nobody notices. See contract-mirror.test.ts.
 */
export const PROTOCOL_NAMES = [
  'hysteria',
  'xray',
  'amneziawg',
  'naive',
  'shadowsocks',
  'mtproto',
  'mieru',
  'tuic',
  'anytls',
  'shadowtls',
] as const;

export type ProtocolName = (typeof PROTOCOL_NAMES)[number];

/**
 * The cells a LEG between two hops can be made of.
 *
 * ⚠ A DIFFERENT DICTIONARY from ProtocolName, sharing two of its words. A cell
 * is what one step of the path says to the next; a protocol is what a node
 * serves users with. `hy2` is the cell, `hysteria` is the protocol, and they
 * are the same wire format worn by two different jobs. The overlap on `vless`
 * and `shadowsocks` is real and is the reason this needs saying: one stored
 * column has carried both vocabularies since the cascade was written, which is
 * how "hysteria" once quietly became a vless leg.
 */
export const LINK_CELLS = ['vless', 'shadowsocks', 'hy2', 'tuic'] as const;

export type LinkCell = (typeof LINK_CELLS)[number];

/**
 * Which engine can RECEIVE a leg of this cell.
 *
 * Since phase 4 the receiving side is always the chain process, so all four
 * cells name sing-box and the table looks like it says nothing. It says two
 * things.
 *
 * The first is the transitional fleet: an agent that predates the chain still
 * terminates `vless` and `shadowsocks` legs inside its xray, and a panel that
 * forgot that would refuse a cascade which works today.
 *
 * The second is the shape of the refusal. "This node cannot receive an hy2 leg"
 * is a sentence about ENGINES, and without a table naming them it would have to
 * be inferred from a protocol list, which is the mistake that refused 23
 * working pairs on 2026-09-11.
 */
export const LINK_CELL_ENGINES: Record<LinkCell, readonly EngineName[]> = {
  vless: ['singbox', 'xray'],
  shadowsocks: ['singbox', 'xray'],
  hy2: ['singbox'],
  tuic: ['singbox'],
};

/**
 * What a leg of this cell occupies on the wire.
 *
 * Derived from the cell rather than stored beside it: the port a leg listens on
 * is 24000 + step whatever the cell, so the only thing that tells a UDP leg
 * from a TCP one is which cell it is. The port check compares (port, transport)
 * pairs, and a leg that arrived without a transport would be compared against
 * the wrong half of every binding.
 */
export const LINK_CELL_TRANSPORT: Record<LinkCell, Transport> = {
  vless: 'tcp',
  shadowsocks: 'tcp',
  hy2: 'udp',
  tuic: 'udp',
};

/**
 * What a cascade ENTRY may serve users with today.
 *
 * Not a list of what the panel can deploy, which is the whole of PROTOCOL_NAMES
 * above, but of what the CHAIN can take traffic from. A cascade is stored with
 * the entry protocol the operator picked, and until phase 4 nothing read that
 * value: an entry saved as hysteria2 or AmneziaWG looked finished and either
 * sent those users straight out of the entry node, past every exit and every
 * protection while the panel showed them a cascade, or dropped the whole chain
 * with one line in a log.
 *
 * ⚠ ONE LIST, read by the save that refuses (ENTRY_NOT_CHAINABLE) and by the
 * screen that offers the choices. A second copy on the frontend is how the two
 * come to disagree, and the disagreement shows up as a form that offers an
 * option the server rejects.
 *
 * It grows with the phases: hysteria2 in 6, amneziawg in 7.
 */
export const CHAIN_ENTRY_PROTOCOLS = ['xray'] as const;

/**
 * The formats a subscription can be served in.
 *
 * ⚠ ONE LIST, and it earns that the way PROTOCOL_TRANSPORT did. There were
 * THREE: the subscription route accepted thirteen names, the host schema
 * eleven (missing `xrayjson-array` and `amneziavpn`, carrying `mieru-json`
 * which the subscription has never served), and the frontend's host editor
 * offered five of its own. An operator picking a format the editor showed got a
 * 400 from a schema that had never heard of it, and the panel looked broken for
 * a reason no screen could explain (issue #41, reported 2026-08-17).
 *
 * A name here is what `?format=` takes and what a host's `disableForFormats`
 * may name. It is not one-to-one with the builders in
 * `subscription/formats/`: `plain` and `json` are rendered inline, `xkeen` and
 * `xrayjson-array` are shapes of the xray builder. What the composition test
 * holds is the other direction: every builder is reachable by a name in this
 * list, and every name in this list is handled by the route.
 */
export const FORMAT_NAMES = [
  'plain',
  'json',
  'clash',
  'singbox',
  'wgconf',
  'amneziavpn',
  'xrayjson',
  'xrayjson-array',
  'xkeen',
  'outline',
  'surge',
  'quantumultx',
  'loon',
] as const;

export type SubscriptionFormat = (typeof FORMAT_NAMES)[number];

/**
 * Which protocols each format actually carries.
 *
 * ⚠ Read off the BUILDERS, one branch at a time, not off what a client's
 * documentation claims to support. The page used to decide this with
 * `protocols.some(p => p !== 'amneziawg')`, which reads as "anything that is
 * not a tunnel is a proxy, so every proxy format applies". MTProto is not
 * amneziawg and appears in NO builder: `surge.ts` skips it, and so do clash,
 * sing-box, xray-json, Quantumult X and Loon. A subscription with an MTProto
 * node was therefore offered five files, every one of which came back without
 * its only server (issue #41).
 *
 * `plain` and `json` carry everything by construction: one is the raw URI list
 * the clients subscribe to, the other is this panel's own dump.
 *
 * When a builder learns a protocol, the entry here moves with it. The test
 * beside the builders is what keeps the two together.
 */
export const FORMAT_PROTOCOLS: Record<SubscriptionFormat, readonly ProtocolName[]> = {
  plain: PROTOCOL_NAMES,
  json: PROTOCOL_NAMES,
  clash: ['hysteria', 'xray', 'shadowsocks', 'tuic', 'anytls', 'shadowtls', 'mieru'],
  singbox: ['hysteria', 'xray', 'shadowsocks', 'tuic', 'anytls', 'shadowtls'],
  wgconf: ['amneziawg'],
  amneziavpn: ['amneziawg'],
  xrayjson: ['xray', 'hysteria'],
  'xrayjson-array': ['xray', 'hysteria'],
  xkeen: ['xray', 'hysteria'],
  outline: ['shadowsocks'],
  surge: ['shadowsocks', 'hysteria', 'xray'],
  quantumultx: ['shadowsocks', 'xray'],
  loon: ['shadowsocks', 'hysteria', 'xray'],
};

/**
 * What the bare link may be set to answer with.
 *
 * Narrower than FORMAT_NAMES, and the reason is what a DEFAULT has to survive:
 * it is served to a client that asked for nothing, about a subscription whose
 * contents the operator will change later.
 *
 *   - the per-node files are out (`wgconf`, `amneziavpn`): they carry ONE
 *     server and need `&node=` to say which. As a default they would hand every
 *     subscriber the first tunnel and silently drop the rest;
 *   - `outline` is out because it carries Shadowsocks only. The day the
 *     operator adds an xray node, every bare link would quietly stop including
 *     it, which is the failure mode this codebase refuses everywhere else.
 *
 * Everything else stays, including the three paid iOS formats and `xkeen`: they
 * carry the whole subscription across protocols, and an operator whose
 * subscribers are all on one client knows better than we do what to hand them.
 *
 * ⚠ The five-name list this replaced (`plain`, `xrayjson`, `xrayjson-array`,
 * `clash`, `singbox`) was a UI shortlist that had leaked into validation: no
 * rule anywhere explained why Surge could not be a default while Clash could.
 */
export const DEFAULT_FORMAT_NAMES = [
  'plain',
  'json',
  'clash',
  'singbox',
  'xrayjson',
  'xrayjson-array',
  'xkeen',
  'surge',
  'quantumultx',
  'loon',
] as const;

export type DefaultSubscriptionFormat = (typeof DEFAULT_FORMAT_NAMES)[number];

/** Does this format carry anything a subscription with these protocols has?
 *  The question the page asks before offering a file. */
export function formatCarriesAny(
  format: SubscriptionFormat,
  protocols: readonly ProtocolName[],
): boolean {
  const carried = FORMAT_PROTOCOLS[format];
  return protocols.some((p) => carried.includes(p));
}

export type ChainEntryProtocol = (typeof CHAIN_ENTRY_PROTOCOLS)[number];

/** What a listener occupies on the wire. A port is only taken for one of these. */
export const TRANSPORTS = ['tcp', 'udp'] as const;
export type Transport = (typeof TRANSPORTS)[number];

/**
 * Which transport a protocol listens on, by default.
 *
 * The panel treated a port as one resource and refused a second binding on it,
 * which is not caution, it is a refusal of a standard configuration: 443/TCP
 * and 443/UDP are different sockets, and every browser on earth speaks H2 on
 * the first and H3 on the second at the same time. REALITY on 443/TCP next to
 * Hysteria2 on 443/UDP is the same shape.
 *
 * ⚠ DEFAULT, not gospel, and exactly one protocol has an exception: xray
 * carries its own stream transport, and `network: "kcp"` puts it on UDP. The
 * table cannot see that, because it is keyed on the protocol alone, so a
 * caller holding the profile config must ask `transportOf` instead. Everything
 * else here is fixed by the protocol: hysteria2 and tuic are QUIC, amneziawg
 * is WireGuard, and none of them has a knob that moves it.
 */
export const PROTOCOL_TRANSPORT: Record<ProtocolName, Transport> = {
  // QUIC.
  hysteria: 'udp',
  tuic: 'udp',
  // WireGuard, in its own obfuscated dialect.
  amneziawg: 'udp',
  // TCP by default; see transportOf for the kcp exception.
  xray: 'tcp',
  // TLS-shaped things, all of them TCP listeners.
  naive: 'tcp',
  anytls: 'tcp',
  shadowtls: 'tcp',
  // Shadowsocks listens on TCP; its UDP relay rides the same port number but
  // is not a separate listener anybody else can take.
  shadowsocks: 'tcp',
  // Both speak TCP in the shapes this panel deploys.
  mtproto: 'tcp',
  mieru: 'tcp',
};

/**
 * The transport of a concrete deployment, config included.
 *
 * The one place that knows about xray's `network`. Anything that has the
 * profile config in hand should come through here rather than read the table
 * directly, or a kcp inbound will be filed as TCP and collide with a REALITY
 * that is not actually in its way.
 */
export function transportOf(
  protocol: ProtocolName,
  config?: { network?: string } | null,
): Transport {
  if (protocol === 'xray' && config?.network === 'kcp') return 'udp';
  return PROTOCOL_TRANSPORT[protocol];
}

/**
 * Which proxy core renders something: the name an agent's adapter answers with.
 *
 * Two different questions live here and they have different answers.
 *
 * PINNABLE. On an inbound, only the cores that serve several protocols are
 * worth naming: the shared protocols (vless/vmess/trojan + ss on xray-core, hy2
 * on hysteria) can be moved to sing-box, and tuic/anytls/shadowtls are
 * sing-box only. Which pairs an operator may actually choose is enforced by
 * ENGINE_OPTIONS in the panel, not by this type.
 *
 * REPORTABLE. On a core the node lists in /healthz, the name is whatever that
 * adapter returns, and four of them are single-protocol cores with no engine
 * to choose: amneziawg, naive, mieru and mtproto. The union first carried only
 * the three pinnable names, which made the type lie about the wire the day the
 * node started reporting engines (2026-09-11); a node running AmneziaWG reports
 * "amneziawg", and nothing in TypeScript would have noticed.
 */
export const ENGINE_NAMES = [
  'xray',
  'hysteria',
  'singbox',
  'amneziawg',
  'naive',
  'mieru',
  'mtproto',
] as const;

export type EngineName = (typeof ENGINE_NAMES)[number];

export interface ProtocolCredentials {
  hysteriaPassword?: string;
  xrayUuid?: string;
  naivePassword?: string;
  amneziawgPublicKey?: string;
  /**
   * IP allocated to this user inside the AmneziaWG inbound's subnet
   * (e.g. "10.0.0.42"). Panel-backend assigns it via the IP allocator
   * service before issuing the addUser request; node-agent writes it
   * straight into the [Peer] AllowedIPs field as `<ip>/32`.
   */
  amneziawgAllowedIp?: string;
  /** TUIC v5 (sing-box engine): per-user UUID + password. */
  tuicUuid?: string;
  tuicPassword?: string;
  /** AnyTLS (sing-box engine): per-user password (password-only auth). */
  anytlsPassword?: string;
  /** ShadowTLS v3 (sing-box engine): per-user password for the shadowtls
   *  users[] (the inner shadowsocks key is server-wide, in the inbound config). */
  shadowtlsPassword?: string;
}

// ───── POST /addUser ─────

export interface AddUserRequest {
  userId: string;
  shortId: string;
  username: string;
  credentials: ProtocolCredentials;
}

export interface AddUserResponse {
  ok: true;
}

// ───── POST /applyInbounds ─────
//
// Panel pushes the FULL set of inbounds bound to this node every time any
// inbound is created/updated/deleted (or the node itself is registered).
// Node-agent diffs against current state and regenerates the protocol's
// config file accordingly. Idempotent: re-sending the same set is a no-op.
//
// Replaces the manual `/etc/iceslab-node/env` editing that admins had to
// do before slice 24. The XRAY_REALITY_*  / HY_DOMAIN env vars stay
// supported as a fallback for nodes that haven't received their first
// applyInbounds yet (or for air-gapped setups).

/** Per-protocol inbound config, discriminated by `protocol`. The shape
 *  mirrors `apps/panel-backend/src/modules/inbounds/inbounds.schemas.ts`
 *  but flattened (no Zod refinements). Panel sends, node decodes. */
export interface InboundDto {
  /** Stable UUID, node-agent uses it as the protocol-side `tag`. */
  id: string;
  /** Human-friendly name (becomes Xray inbound `tag`, Hysteria masquerade
   *  hint, etc, purely informational on the node side). */
  name: string;
  protocol: ProtocolName;
  /** Proxy core that renders this inbound. Omit -> the protocol's native core
   *  (xray for vless/vmess/trojan/ss, hysteria for hy2, singbox for
   *  tuic/anytls). Set to 'singbox' to serve a shared protocol via sing-box. */
  engine?: EngineName;
  /** Listen port (UDP for hysteria/awg, TCP for xray/naive). */
  port: number;
  /** Per-protocol settings. The discriminant is `protocol` above. */
  config:
    | XrayInboundCfg
    | HysteriaInboundCfg
    | AmneziawgInboundCfg
    | NaiveInboundCfg
    | ShadowsocksInboundCfg
    | MtprotoInboundCfg
    | MieruInboundCfg
    | TuicInboundCfg
    | AnytlsInboundCfg
    | ShadowtlsInboundCfg;
}

export interface XrayInboundCfg {
  /**
   * Identity of THIS inbound, so the agent can hold several at once.
   *
   * Rides inside the config rather than as an argument because `ApplyInbound`
   * is shared by all seven core adapters: widening its signature to carry an id
   * would touch every one of them for the benefit of a single core.
   *
   * The agent keys its stored inbounds on this. It must stay stable for the
   * life of the inbound: traffic counters are tagged with it, so a changed id
   * reads as a brand-new inbound and zeroes the accounting on that node.
   *
   * Optional for now: an agent from before multi-inbound ignores it, and a
   * panel that omits it keeps the old single-inbound behaviour.
   */
  inboundId?: string;
  /** Stream security. 'reality' (default), 'none' (plain transport, for
   *  ws/httpupgrade behind a CDN that terminates TLS, or local testing), or
   *  'tls' (node-terminated TLS with an operator-supplied certificate). The
   *  reality* fields are required only for 'reality'; the tls* fields only for
   *  'tls'. */
  security?: 'reality' | 'none' | 'tls';
  /** TLS (security='tls'): SNI / cert common name the node serves. */
  tlsServerName?: string;
  /** TLS cert chain (PEM). Operator-supplied; embedded inline in the xray
   *  config's tlsSettings.certificates (no ACME on the node). */
  tlsCert?: string;
  /** TLS private key (PEM), paired with tlsCert. */
  tlsKey?: string;
  /** Reject TLS handshakes whose SNI matches no served server name. */
  tlsRejectUnknownSni?: boolean;
  realityDest: string;            // e.g. "www.cloudflare.com:443"
  realityServerNames: string[];   // SNI candidates
  realityShortIds: string[];      // hex strings, 0..16 chars even-length
  realityPrivateKey: string;      // base64url (REALITY-style, NOT WireGuard base64)
  realityPublicKey: string;
  /** REALITY protocol version mirrored to the upstream dest (0|1|2). */
  realityXver?: number;
  /** Max client/node clock skew (ms) REALITY tolerates; 0 = xray default. */
  realityMaxTimeDiff?: number;
  /** G - throttle unverified REALITY fallback (probe) connections, bytes/sec; 0 = off. */
  realityLimitFallbackUploadBytesPerSec?: number;
  realityLimitFallbackDownloadBytesPerSec?: number;
  /** K9-B - how REALITY borrows a TLS identity:
   *   - 'steal-others' (default/empty): dest = an external camouflage site;
   *     works outside RU but SNI-IP-mismatches under RU-DPI.
   *   - 'self-steal': the node-agent runs a local TLS fallback and REALITY's
   *     dest points at it (127.0.0.1:8443), with serverNames = the node's own
   *     domain so SNI and IP stay consistent. Set serverNames to a domain that
   *     resolves to the node IP; the node ignores realityDest in this mode. */
  realityMode?: 'steal-others' | 'self-steal';
  /** G1 - real site the self-steal local TLS fallback reverse-proxies probe
   *  requests to (so a prober sees genuine content). Empty = static landing.
   *  Only used when realityMode is 'self-steal'. */
  realityFallbackUpstream?: string;
  flow: 'xtls-rprx-vision' | 'none';
  fingerprint: string;            // chrome / firefox / safari / etc
  network: 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp';
  path?: string;                  // ws/xhttp/httpupgrade
  host?: string;                  // ws/xhttp/httpupgrade Host header override
  serviceName?: string;           // grpc
  /** XHTTP packet mode; 'auto' (default) lets xray pick the framing. */
  xhttpMode?: 'auto' | 'packet-up' | 'stream-up' | 'stream-one';
  /** XHTTP request-padding byte range (e.g. "100-1000"); empty disables. */
  xhttpPaddingBytes?: string;
  /** gRPC multiMode: multiplex several streams per connection. */
  grpcMultiMode?: boolean;
  /** Subprotocol carried by the xray inbound. `vless` (default) → per-user
   *  UUID with optional Vision flow; `trojan` → per-user password (we reuse
   *  user.xrayUuid); `vmess` → per-user UUID, AEAD (no flow). VMess pairs with
   *  security 'none'/'tls' only (its share link cannot carry REALITY). */
  subprotocol?: 'vless' | 'trojan' | 'vmess';
  /**
   * C3 cascade chaining fragments for THIS node's hop.
   *
   * ⚠ TRANSITIONAL. The cascade belongs to the NODE, not to an inbound, and now
   * travels as ApplyInboundsRequest.cascade. This copy stays for one release
   * because a Go decoder ignores fields it does not know: an agent that has not
   * been updated would see no cascade at all if the panel stopped sending it
   * here, and would sit without one silently. The panel sends BOTH, from the
   * same object so the two cannot disagree, and a node that understands the
   * node-level block ignores this one. Remove it when the fleet is updated.
   */
  cascade?: XrayCascadeFragments;
  /** Cloudflare WARP egress (per-node v1). When present, the node renders a
   *  wireguard outbound to WARP and routes this inbound's user traffic through
   *  it. Registered + provisioned panel-side. Absent = direct egress (default).
   *  See docs/studies/STUDY-warp-native.md. */
  warp?: WarpCfg;
}

/**
 * The resolver a node uses for the names its users ask for (Э3 piece F).
 *
 * We render no `dns` section at all today, so xray's DNS-hijack rule hands the
 * client's queries to `dns-out`, which falls through to the NODE's system
 * resolver. On a cascade that is the wrong machine: the name is resolved by the
 * entry while the connection leaves from the exit (field observation E13). What
 * is DNS-poisoned in the entry's country stays poisoned though the subscriber
 * is paying to leave it, a geo-pinned CDN answers for the wrong country, and
 * the entry's resolver sees every name the user visits.
 *
 * Naming a resolver here fixes that WITHOUT touching the routing stages: xray's
 * built-in DNS dials its servers as ordinary connections, so on a cascade entry
 * those queries take the same road as the traffic and are answered from the
 * exit's vantage point. The Policy stage is not involved and its order does not
 * move.
 *
 * It belongs to the NODE (ApplyInboundsRequest.dns), not to a profile. Every
 * core we render to keeps one resolver per PROCESS and the process is one per
 * node, so a setting on the profile put a process-wide value behind a
 * per-profile switch: two profiles on one node could ask for different
 * resolvers, and the node had to refuse the config while the panel had to guard
 * the save that would create it. The same reasoning already puts the core
 * VERSION on the node. When multi-core lands this becomes one per core on the
 * node (sing-box has a dns block of its own); the shape below carries over.
 *
 * A MODEL, not raw xray JSON, for the same reasons as NodePolicy: a non-xray
 * core has to render the same intent its own way, and the panel has to be able
 * to show what a node is set to rather than a blob.
 *
 * The shape deliberately mirrors the split-DNS block the panel already emits
 * into CLIENT configs (RU_SPLIT_DNS in xrayjson.ts): same three ideas, an
 * address, the domains it is authoritative for, and whether other queries may
 * fall back to it. Mirrored rather than shared, because those constants live in
 * layer A (what the client does) and this is layer B (what the node does), and
 * the two must be able to diverge without dragging each other.
 */
export interface DnsCfg {
  /** Resolvers in order; the first one whose `domains` match answers. A bare
   *  address with no `domains` is the general resolver. */
  servers: DnsServer[];
  /** What the resolver is allowed to return. Omit for the core's default. */
  queryStrategy?: 'UseIP' | 'UseIPv4' | 'UseIPv6';
  /** Turn off the resolver's answer cache. Off is the sane default; this is
   *  here for the operator debugging a stale answer, not for everyday use. */
  disableCache?: boolean;
}

export interface DnsServer {
  /** Plain IP ("77.88.8.8"), or a DoH endpoint ("https://dns.google/dns-query").
   *  A plain IP dodges the bootstrap problem of resolving the resolver. */
  address: string;
  /** Names this server is authoritative for. Empty = it answers everything. */
  domains?: string[];
  /** Only accept answers inside these ranges, e.g. ["geoip:ru"]. */
  expectIps?: string[];
  /** Keep queries this server declined off the general resolver, so a name
   *  scoped here cannot quietly be answered by the fallback instead. */
  skipFallback?: boolean;
}

/**
 * Cloudflare WARP egress credentials the panel pushes to the node, which renders
 * them as an xray `wireguard` outbound. publicKey/endpoint/mtu fall back to
 * Cloudflare well-known defaults on the node when empty. reserved is the account
 * client_id as a 3-byte array (empty or exactly 3).
 */
export interface WarpCfg {
  /** WireGuard private key (base64). */
  secretKey: string;
  /** Assigned interface addresses, e.g. ["172.16.0.2/32", "<v6>/128"]. */
  address: string[];
  /** Cloudflare peer public key; node default if omitted. */
  publicKey?: string;
  /** Peer endpoint "host:port"; node default (162.159.192.1:2408) if omitted. */
  endpoint?: string;
  /** client_id first 3 bytes (xray/sing-box `reserved`); empty or exactly 3. */
  reserved?: number[];
  /** WireGuard MTU; node default 1280 if omitted. */
  mtu?: number;
}

/**
 * C3 cascade fragments: raw xray config objects the panel hands to a node so it
 * can chain entry→exit. The panel owns the exact xray shape (the node-agent
 * stays protocol-agnostic and just merges these into inbounds/outbounds/
 * routing.rules). Each element is a fully-formed xray config object.
 */
export interface XrayCascadeFragments {
  /** Link-IN inbounds (the previous hop dials these). Present on transit/exit
   *  nodes. */
  inbounds: unknown[];
  /** Link-OUT outbounds (this hop dials the next). Present on entry/transit
   *  nodes. */
  outbounds: unknown[];
  /** Per-role routing rules: entry routes user traffic → link-out; transit
   *  routes link-in → link-out; exit routes link-in → direct. Appended after
   *  the node's base block/DNS rules on the node side. */
  routingRules: unknown[];
  /** Inter-hop link-IN port this node listens on (the previous hop dials it).
   *  The node-agent opens UFW for it, restricted to linkAllowFrom, since this
   *  high port is not a top-level inbound and install-time rules miss it.
   *  Absent on the entry hop (no link-in). */
  linkIngressPort?: number;
  /** Source IP/CIDR/host allowed to reach linkIngressPort (the previous hop's
   *  address). Hostnames are resolved agent-side; empty → port opens to anyone
   *  (still UUID/PSK-gated). */
  linkAllowFrom?: string[];
  /** Latency-balanced ("auto") entry only: the top-level `observatory` block
   *  that probes the link-out outbounds by RTT. Present on the entry of a
   *  mode='balancer' cascade; absent otherwise. */
  observatory?: unknown;
  /** Latency-balanced entry only: `routing.balancers` entries. The entry's user
   *  routing rule targets one via `balancerTag`, so xray picks the lowest-ping
   *  exit per connection. Absent otherwise. */
  balancers?: unknown[];
}

export interface HysteriaInboundCfg {
  obfsPassword?: string;          // Salamander; empty = no obfuscation
  masqueradeUrl?: string;
  brutalUpMbps?: number;
  brutalDownMbps?: number;
}

export interface AmneziawgInboundCfg {
  /** Server WG private key (base64-standard, like `wg genkey`). */
  privateKey: string;
  /** Subnet in CIDR notation (e.g. "10.0.0.0/24"). Server takes .1, peers
   *  .2..N. Panel-side `amneziawg.service` does the per-user allocation. */
  subnet: string;
  /** AmneziaWG obfuscation params, see reference_amneziawg.md for ranges. */
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
  postUp?: string;                // optional iptables / sysctl tweaks
  postDown?: string;
}

export interface NaiveInboundCfg {
  hostname: string;               // public FQDN; Caddy ACME uses this
  tlsEmail: string;               // LE account
  masqueradeRoot?: string;        // dir served when probed (default: /var/www/empty)
}

/**
 * Shadowsocks 2022 inbound config (slice 24d). Method = AEAD/SS2022 cipher.
 * Per-user passwords are derived from `user.xrayUuid` on both sides, we
 * don't grow the credential surface for a fifth protocol.
 *
 * `serverPsk` (Server PSK) is auto-generated at inbound create on the
 * panel side and pushed over the wire. xray-core requires it at the
 * `settings.password` level for SS2022 multi-user; clients connect with
 * `base64url(method:ServerPSK:UserPSK)` joined.
 */
export interface ShadowsocksInboundCfg {
  method:
    | '2022-blake3-aes-128-gcm'
    | '2022-blake3-aes-256-gcm'
    | '2022-blake3-chacha20-poly1305'
    | 'chacha20-ietf-poly1305'
    | 'aes-256-gcm'
    | 'aes-128-gcm';
  serverPsk?: string;
}

/**
 * MTProto inbound config (slice 41). 9seconds/mtg upstream is single-
 * secret by design, so we model the inbound (not the user) as the unit
 * carrying the secret. The panel derives `secret` deterministically
 * from (inboundId, domain) and pushes it on the wire; the agent could
 * re-derive but trusts the panel's value to keep both sides in lock-step
 * even if the derivation logic ever changes.
 */
export interface MtprotoInboundCfg {
  domain: string;
  /** `ee<32-hex-bytes><hex-encoded-domain>`: Fake-TLS format. */
  secret: string;
}

/**
 * Mieru inbound config (slice 40). MTU caps the inner-payload size; per-
 * user creds derive from `user.xrayUuid`.
 */
export interface MieruInboundCfg {
  mtu: number;
}

/**
 * TUIC v5 inbound config (sing-box engine, slice singbox-S2). `serverName` is
 * the TLS SNI the node's cert is issued for; `congestionControl` tunes the QUIC
 * sender. TLS is the node's self-signed pair for the alpha (client connects
 * with allow-insecure + this SNI). Per-user uuid+password live in credentials.
 */
export interface TuicInboundCfg {
  serverName?: string;
  congestionControl?: 'bbr' | 'cubic' | 'new_reno';
}

/**
 * AnyTLS inbound config (sing-box engine). TCP+TLS, password-only auth (the
 * per-user password lives in credentials). `serverName` is the TLS SNI the
 * node's self-signed cert is issued for (client uses allow-insecure in alpha).
 */
export interface AnytlsInboundCfg {
  serverName?: string;
}

/**
 * ShadowTLS v3 inbound config (sing-box engine). TLS-camouflage wrapper: the
 * node fronts a real handshake to `handshake` (a whitelisted site) and detours
 * to an inner single-key shadowsocks. `ssMethod` is the inner cipher; `ssPassword`
 * is the inner ss server key (auto-generated panel-side, valid base64). Per-user
 * auth is the shadowtls password (credentials). No share-link (sing-box/clash).
 */
export interface ShadowtlsInboundCfg {
  handshake?: string;
  ssMethod?: string;
  ssPassword?: string;
}

/**
 * What a node does with traffic, decided by the node rather than by the client.
 *
 * A stage of its own, next to the inbounds and not inside them. Three reasons it
 * cannot be folded into the cascade fragments it superficially resembles:
 *
 *   - those hang off an INBOUND (`InboundDto.cascade`) and are absent on a plain
 *     node, while a policy is wanted on every node, most of all the plain ones;
 *   - they are N lists merged in a loop, and nobody owns the order between them.
 *     That is not a hypothetical: the per-inbound WARP rule below already never
 *     fires on a cascade node because the cascade rules matched first (see
 *     config.go). A second unordered list would buy a second such bug;
 *   - a rule has to be NAMEABLE. "Protection" is ours and immovable, "Policy" is
 *     the operator's, "the door out" is always last. Raw xray objects in one
 *     array cannot be told apart, so the panel could not say which stage a node
 *     has applied, and a non-xray core could not render them at all: on
 *     AmneziaWG the same policy is iptables in PostUp.
 *
 * Hence a model, not xray JSON: `{ match, action }`, where the action names a
 * destination the node resolves with whatever engine it runs.
 */
export interface NodePolicy {
  /** Evaluated top to bottom, first match wins, the way every routing engine
   *  we render to works. An empty list is the normal state of a node with no
   *  policy and must render exactly as if the field were absent. */
  rules: NodePolicyRule[];
}

export interface NodePolicyRule {
  match: NodePolicyMatch;
  action: NodePolicyAction;
}

/**
 * What a rule fires on. Every field is optional and they AND together; a match
 * with no fields at all is a catch-all, which is legitimate as the last rule and
 * a mistake anywhere else.
 *
 * Domain and IP entries carry the engine-neutral spelling the panel already uses
 * elsewhere (`geosite:category-ru`, `geoip:ru`, `domain:example.com`, plain
 * hostnames and CIDRs). The node translates; on a core that cannot match domains
 * at all, a domain-only rule is a rule that cannot be honoured, and the node
 * says so rather than dropping it quietly.
 */
export interface NodePolicyMatch {
  domain?: string[];
  ip?: string[];
  /** Single port or range, "443" / "1000-2000" / "80,443". */
  port?: string;
  /** Sniffed application protocol, e.g. ["bittorrent"]. */
  protocol?: string[];
  network?: 'tcp' | 'udp' | 'tcp,udp';
}

/**
 * Where matching traffic goes. A destination, not a direction: the node knows
 * how to reach each of these, and the panel does not have to know how the node
 * spells it.
 */
export type NodePolicyAction =
  /** Out of this node's own address. */
  | { kind: 'direct' }
  /** Dropped. */
  | { kind: 'block' }
  /** Through this node's Cloudflare WARP egress. The node must already have
   *  WARP provisioned; a rule naming it on a node without it is refused by the
   *  core's own config validation rather than silently skipped. */
  | { kind: 'warp' }
  /**
   * Out through a cascade exit this node dials.
   *
   * `exit` is the outbound name the panel itself generated in the cascade
   * fragments for this node, and the node treats it as opaque: it is the panel
   * that owns cascade naming (the fragments are already panel-authored), and a
   * name that is not there fails config validation loudly instead of producing
   * a rule that quietly never fires.
   */
  | { kind: 'cascade'; exit: string };

export interface ApplyInboundsRequest {
  inbounds: InboundDto[];
  /** Node-level routing policy. Absent or `{ rules: [] }` renders exactly as
   *  before, which is what makes it safe to ship ahead of the panel side. */
  policy?: NodePolicy;
  /** Who answers the name lookups of this node's users. Absent = the node's own
   *  system resolver, which is what every node does today. See DnsCfg for why
   *  this sits on the node and not on a profile. */
  dns?: DnsCfg;
  /** This node's hop in a cascade. Absent = not part of one, which renders
   *  exactly as before. See NodeCascade. */
  cascade?: NodeCascade;
  /**
   * The chain as its own process (phase 4). Absent = this node draws the chain
   * inside its user core, which is what every node does today.
   *
   * ⚠ Ships BEFORE anything renders it, deliberately, and for one transitional
   * release the panel sends BOTH this and `cascade`. An agent that understands
   * `chain` must then IGNORE the cascade fragments: two link-outs for one chain
   * would fight over the link port. An older agent sees no `chain` at all and
   * keeps reading `cascade`, so a half-updated fleet keeps serving. Same shape
   * of migration as the one that moved the cascade off the inbound.
   */
  chain?: NodeChain;
}

/**
 * The chain drawn by a separate process, rendered by the PANEL.
 *
 * Raw engine JSON rather than a described shape: there is one renderer and one
 * chain engine, so a second vocabulary in the middle would buy nothing and go
 * stale against the engine's own schema. The agent asks the engine whether it
 * loads (`sing-box check`), writes it, starts it. The same division as the xray
 * cascade fragments, which the panel has always authored.
 */
export interface NodeChain {
  /**
   * Which engine runs the chain. A union of one on purpose: the field exists so
   * a second engine is a value rather than a new block, and so an agent can
   * refuse a name it does not know instead of guessing at the JSON.
   */
  engine: 'singbox';
  /**
   * The engine's own config, verbatim. Opaque to the panel's transport layer
   * and to the agent alike.
   */
  config: Record<string, unknown>;
  /**
   * Where the user's core hands traffic over: one loopback socks listener per
   * WAY OUT, not per node. A pool of exits on a direction shares one, the same
   * way a pool shares one link port.
   *
   * The port is derived, never stored: CHAIN_SOCKS_BASE + tag, so both sides
   * compute it and cannot disagree. It is sent anyway, because the agent must
   * be able to open exactly these and no others, and because a derivation the
   * wire does not carry is a rule two programs have to keep in step by hand.
   */
  socks: ChainSocks[];
  /**
   * Password for every socks listener above.
   *
   * On 127.0.0.1 and still authenticated: a VPS has other users, and an
   * unauthenticated proxy on loopback is an open relay for anyone with a shell
   * on that machine.
   *
   * The VALUE, not a reference: the agent has no store to resolve one against,
   * and a field named for a lookup that does not happen is worse than a field
   * named for what it carries. It is generated panel-side and kept on the
   * cascade, like the heartbeat secret.
   */
  socksPassword: string;
  /**
   * What the USER'S core must render while the chain process holds the chain:
   * the same cascade fragments as ever, except that each direction ends in a
   * socks outbound to the loopback port above instead of a leg dialled across
   * the internet.
   *
   * ⚠ IT TRAVELS HERE AND NOT IN `cascade`, and the reason is the whole
   * transitional release. Both blocks go out together so a half-updated fleet
   * keeps serving, which fixes what each one may contain:
   *
   *   - `cascade` is what an OLD agent applies. It must stay the legacy
   *     drawing, legs and all, or an agent that cannot see `chain` would
   *     configure its xray to hand traffic to a socks port no process on that
   *     machine is listening on, and every user behind that entry would stop;
   *   - so a NEW agent cannot use `cascade` either, because it holds the
   *     drawing the chain process has taken over. It ignores it and renders
   *     THIS instead.
   *
   * Without it the new agent would have nothing to give its user core at all,
   * and an entry with no cascade routing does not fail: it sends users out of
   * the ENTRY country while their client shows the exit they chose. That is the
   * one outcome this whole phase is arranged to prevent.
   *
   * Absent on a transit or an exit, which have no user core to hand over from.
   */
  userCore?: {
    /** The core that renders it. Named for the same reason `NodeCascade.engine`
     *  is: the agent must be able to refuse a name it does not know rather than
     *  guess at the JSON. */
    engine: EngineName;
    fragments: XrayCascadeFragments;
  };
}

export interface ChainSocks {
  /**
   * The way out this listener carries, as a CascadeDirection tag.
   *
   * 0 means the "Auto" line, the one that names no direction and lets the
   * entry pick. Zero is free by construction: direction tags are issued from a
   * counter that starts at 1, so nothing else can ever be it.
   */
  tag: number;
  /** Always loopback, always CHAIN_SOCKS_BASE + tag. */
  port: number;
}

/**
 * A node's hop in a cascade, as a NODE-level block.
 *
 * It used to ride on the xray inbound (XrayInboundCfg.cascade), which put a
 * node-level thing behind a per-inbound switch, the same mistake the resolver
 * made. A node has one chain, not one per door.
 *
 * `engine` names the node's ROUTER: the one core that draws the three stages and
 * knows every way out, while the other cores hand it their traffic. It is not
 * decoration and the block is NOT broadcast the way the policy is: xray and
 * sing-box both rendering this would fight over the link port.
 *
 * It is also the discriminant. Today one router exists and `fragments` is always
 * xray-shaped; when a second one arrives, `fragments` becomes a union selected
 * by `engine`, which is an additive change rather than a breaking one. That is
 * the whole reason for the wrapper: flat, the state "fragments present, engine
 * unsaid" would be expressible, and one day it would arrive.
 */
export interface NodeCascade {
  engine: EngineName;
  fragments: XrayCascadeFragments;
}

export interface ApplyInboundsResponse {
  ok: true;
  /** Number of inbounds actually applied (after the node-side diff). */
  applied: number;
  /** Number of inbounds that were already in this state (no-op). */
  skipped: number;
}

// ───── POST /removeUser ─────

export interface RemoveUserRequest {
  userId: string;
}

export interface RemoveUserResponse {
  ok: true;
}

// ───── GET /stats ─────

export interface UserStats {
  userId: string;
  bytesIn: number;
  bytesOut: number;
  /**
   * True when THIS user's counters are cumulative-since-core-start (the
   * producing adapter does a non-destructive read: xray / sing-box); false or
   * omitted means they are already per-poll deltas (awg / hysteria / ss /
   * mtproto). Set per-user by the node so a node running BOTH a cumulative and
   * a delta core is billed correctly. Absent on legacy agents, in which case
   * the panel falls back to the response-level `cumulative` flag.
   */
  cumulative?: boolean;
}

export interface GetStatsResponse {
  /**
   * Per-user counters. Cumulative since core start when `cumulative` is true
   * (the panel computes deltas against a stored snapshot); otherwise deltas
   * since the last poll (legacy agents).
   */
  users: UserStats[];
  /** Node uptime in seconds. */
  uptime: number;
  totalBytesIn: number;
  totalBytesOut: number;
  /**
   * #5 - true when `users[]` are cumulative-since-core-start (xray
   * non-destructive read). Absent/false = legacy already-deltas semantics.
   */
  cumulative?: boolean;
}

// ───── GET /healthz ─────

/**
 * Per-core restart tally (2026-08-04). Reported only by cores that supervise a
 * real subprocess, and only by agents from 2026-08 onward.
 *
 * ⚠ Absent means "not reported", NOT "zero restarts". The panel must keep its
 * stored value when this is missing, the same way it does for `version`.
 *
 * Why it exists: the agent restarts a core once its memory crosses a ceiling,
 * before the kernel OOM-kills it. A restart drops live connections, so without
 * a visible counter the panel would show a healthy green node while users
 * complain about drops.
 */
export type CoreRestartReason = 'crash' | 'memory';

export interface CoreRestarts {
  /** Which core these numbers belong to ("xray", ...). Present so a reader
   *  never infers it from the node's protocol: today only xray arms the
   *  watchdog, but the mechanism is core-agnostic. */
  core: string;
  /** crash + memory, sent explicitly rather than derived: a future third cause
   *  would keep this right while crash+memory quietly stopped adding up. */
  total: number;
  /** Died on its own. A rising number here is a bug, not maintenance. */
  crash: number;
  /** Watchdog acted before an OOM. Rising here means the ceiling is doing its
   *  job (or is set too low). */
  memory: number;
  /** RFC3339. Absent until something has restarted. */
  lastAt?: string;
  lastReason?: CoreRestartReason;
  /** RFC3339 instant the agent started counting. Counters live in the agent's
   *  memory and reset when it restarts, so without this "3 restarts" cannot be
   *  dated: it could be this morning or six months ago. */
  sinceAt?: string;
  /** Armed ceiling in bytes; absent = watchdog off. Never sent as 0. */
  memoryLimitBytes?: number;
  /** Latest resident-size sample in bytes; absent = not sampled (or the
   *  platform can't read it). Shown next to the ceiling so an operator sees
   *  how close a core runs, not just how often it crossed. Never sent as 0. */
  rssBytes?: number;
}

/**
 * What the PANEL stores and serves on the node DTO: the agent's tally plus the
 * panel's own freshness stamp. Single definition on purpose - panel-backend's
 * mapper and panel-frontend's api client both import this one, so the contract
 * can't drift between three copies.
 */
export interface NodeCoreRestarts extends CoreRestarts {
  /**
   * RFC3339 instant of the poll these numbers came from.
   *
   * ⚠ Refreshed at most every few minutes, not on every 30s poll: the panel
   * only writes the row when something moved (or on a periodic heartbeat), so
   * a quiet node would otherwise churn a database write per tick. Treat it as
   * "data is no older than this, give or take the heartbeat interval". A stamp
   * far past that interval means the node stopped being polled, not that it is
   * healthy and quiet.
   */
  observedAt: string;
}

/**
 * A port on the node held by a core's own SERVICE, not by a user inbound.
 *
 * Every core opens sockets nobody asked it to: hysteria listens for its auth
 * callback and its traffic-stats API, xray and sing-box each open a loopback
 * gRPC port for per-user counters, mtg has its stats port. The panel knew none
 * of them, so a binding could be saved onto one and the node would then fail to
 * bind one of the two listeners, in its journal, hours later.
 *
 * `owner` is a KEY and not a phrase: `hysteria-auth`, `singbox-api`. The panel
 * turns it into words in the operator's language; a sentence from the agent
 * would arrive in English on a bilingual screen and could never be translated.
 *
 * The set is OPEN on purpose. A new adapter adds its own key, and a panel that
 * does not know it shows the key itself rather than refusing to draw the row.
 * That is why there is no guard here pinning the list: it would turn adding an
 * adapter into a two-repo change for no gain.
 */
export interface ReservedPort {
  owner: string;
  port: number;
  /**
   * Which socket it takes. Every one of them is tcp today, and it travels
   * anyway: the panel compares it against a binding's transport, and assuming
   * would be the same mistake as the port key made before it learned about
   * transports.
   */
  transport: Transport;
}

export interface CoreStatus {
  name: ProtocolName;
  running: boolean;
  /** Which proxy core renders this protocol on this node ("xray", "singbox",
   *  "hysteria"). `name` is the PROTOCOL and the two are different questions:
   *  tuic and vless can both be sing-box on one node. Absent on an agent older
   *  than the field. */
  engine?: EngineName;
  /**
   * Whether THIS core carries out the node-level policy / the node-level
   * resolver (ApplyInboundsRequest.policy and .dns).
   *
   * Both are optional adapter interfaces and today exactly ONE core implements
   * them, so on a node running AmneziaWG, sing-box, native hysteria, naive,
   * mieru or mtproto the operator's policy does nothing whatsoever. The panel
   * used to show the policy attached to such a node with no hint of that.
   *
   * Per core, not per node: a node running xray alongside tuic on sing-box
   * applies the policy to its xray users and not to the others, so "this node
   * applies the policy" cannot be said truthfully.
   *
   * ⚠ Absent means the agent predates the field, which is NOT the same as
   * false. Show it as unknown, never as "does not render it". Reported by the
   * node rather than decided from a table here, which would drift from the
   * agent the day another adapter learns to render one, and drift silently.
   */
  rendersPolicy?: boolean;
  rendersDns?: boolean;
  /** See CoreRestarts. Absent = this core/agent doesn't report it. */
  restarts?: CoreRestarts;
  /** T7: underlying core binary version (e.g. "26.3.27" from `xray version`),
   *  absent when the adapter can't report one (config-only mode, non-versioned
   *  core, or a pre-T7 agent). The panel persists it per node to gate features
   *  needing a minimum core version (cascade exit selection needs xray
   *  >= 25.9.5). */
  version?: string;
  /** Whether this core is CONFIGURED, i.e. has an inbound and is expected to
   *  run. The installer registers an adapter for every protocol the operator
   *  might switch on later, and an unconfigured one sits idle by design.
   *
   *  Absent = the agent predates the field, which is NOT the same as false:
   *  read it as configured, the behaviour that came before. Without the
   *  distinction a healthy node reported `degraded` forever (every node of the
   *  field fleet did), so the status stopped changing when something broke. */
  provisioned?: boolean;
  /**
   * Whether the core's BINARY is on the machine.
   *
   * A different question from `provisioned`, and the pair is not redundant:
   * `provisioned` is about configuration the panel pushed, this is about the
   * machine. An adapter is registered for every protocol the operator might
   * switch on later, so a node can report a core that nothing has installed,
   * and a core that is absent renders nothing however well it is configured.
   * The policy card already needs both to say "this node applies the policy"
   * without lying.
   *
   * ⚠ Absent means the agent predates the field, which is NOT false. Read it
   * as installed, the behaviour that came before, or the whole current fleet
   * reads as empty machines.
   */
  installed?: boolean;
  /**
   * Ports this core's own services hold, see ReservedPort.
   *
   * THREE states, and the middle one is why this is not a plain array:
   *   absent - this core cannot speak about its ports (the adapter has no
   *            such interface, or the agent predates the field);
   *   []     - it spoke, and holds nothing. An answer;
   *   [...]  - it holds these.
   *
   * The port check turns that into `certainty`: one core that cannot speak is
   * enough to make the whole list incomplete, and an incomplete list may refuse
   * a port it names and may never promise one it does not.
   */
  reservedPorts?: ReservedPort[];
}

/**
 * The chain process, when this node runs one (phase 4).
 *
 * NOT a core in `cores[]`, and the difference is not cosmetic: `CoreStatus.name`
 * is a `ProtocolName`, the chain is not a protocol, and the guard that keeps
 * that enumeration honest against the agent would be right to refuse it. It is
 * one process per node with one question to answer, so it answers here.
 *
 * Absent means this node has no chain process, which is every node until the
 * panel starts sending the `chain` block, and stays true afterwards for every
 * node that is not part of a cascade.
 */
export interface ChainStatus {
  running: boolean;
  /** Engine version, e.g. "1.13.14". Empty when the binary cannot say. */
  version?: string;
  /**
   * Why it is not running, in the engine's own words, when the agent has them:
   * a refused config, a failed start. Absent while it runs.
   */
  error?: string;
  /**
   * The loopback socks ports the chain holds, one per way out, under the owner
   * key `chain-socks`.
   *
   * HERE and not folded into some core's `reservedPorts`, which is where they
   * briefly were. That said "xray holds 26000" about a port the chain holds,
   * and picking which core to attach them to made the answer depend on what
   * else the node happens to run. The panel reads this list and the cores' ones
   * as one set; the owner key is what names the holder, not the field it
   * arrived in.
   *
   * Never empty and never absent while `chain` is present: a chain either
   * carries socks listeners or does not exist. So unlike `CoreStatus.
   * reservedPorts`, this needs no third state, and the presence of the `chain`
   * block is itself the "it answered".
   */
  reservedPorts: ReservedPort[];
}

export interface HealthcheckResponse {
  status: 'ok' | 'degraded';
  cores: CoreStatus[];
  /**
   * See ChainStatus. Absent = no chain process on this node.
   *
   * ⚠ Absence must never make a node degraded. Until phase 4 ships nobody has
   * a chain, and a panel that read "no chain" as "chain down" would turn the
   * whole fleet red on the day the field was added.
   */
  chain?: ChainStatus;
}

/**
 * What the PANEL stores per node from the healthcheck above: the cores the
 * agent reported, plus the panel's own freshness stamp.
 *
 * Kept because the per-core answer to "does this core render the policy" cannot
 * be derived in the panel without keeping a copy of the agent's adapter list,
 * and a copy drifts silently. The node is the only honest source.
 *
 * ⚠ `observedAt` follows the same rule as NodeCoreRestarts.observedAt: the row
 * is written when something moved (or on a periodic heartbeat), so read it as
 * "no older than this, give or take the heartbeat". A stamp far past that means
 * the node stopped being polled, not that it is quiet and fine. `null` on the
 * node DTO means no reporting agent has checked in yet, which is NOT the same
 * as a node with no cores.
 */
export interface NodeCores {
  observedAt: string;
  cores: NodeCoreInfo[];
}

/**
 * One core as the panel keeps it: an INVENTORY entry, not a liveness feed.
 *
 * `running` and `restarts` from CoreStatus are deliberately not stored. Liveness
 * already lives in the node's `status` and the tally in `coreRestarts`, and a
 * copy here would be written only when something else changed, leaving a stale
 * "running: true" next to a node the panel knows is down.
 */
export interface NodeCoreInfo {
  name: ProtocolName;
  engine?: EngineName;
  version?: string;
  provisioned?: boolean;
  installed?: boolean;
  rendersPolicy?: boolean;
  rendersDns?: boolean;
  /**
   * Stored, unlike `running`, because it is inventory and not liveness: which
   * ports a core holds changes when the node is reconfigured, not from tick to
   * tick, and the port check has to answer between two healthchecks.
   */
  reservedPorts?: ReservedPort[];
}

// ───── GET /metrics ─────
//
// Host-level CPU / memory / disk for the VPS the node-agent runs on. Polled
// by the panel every 15s and cached in Redis with TTL 60s, so the dashboard
// can show per-node load without paying mTLS round-trip on every page open.

export interface CPUMetricsDto {
  /** Sampled CPU%, 0..100. Zero on the very first agent poll (no prior snapshot). */
  usagePercent: number;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  cores: number;
}

export interface MemoryMetricsDto {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface DiskMetricsDto {
  path: string;
  totalBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface HostMetricsResponse {
  cpu: CPUMetricsDto;
  memory: MemoryMetricsDto;
  disk: DiskMetricsDto;
  /** Node-agent process uptime, seconds. */
  uptimeSeconds: number;
  /** ISO 8601 with nanos. Useful for "stale sample" heuristics on the panel. */
  collectedAt: string;
}

// ───── GET /ufwPorts ─────
//
// G4 probe-exposure: the node-agent reports its ufw-allowed inbound ports; the
// panel compares them to the expected set (bindings + SSH + mTLS) and warns the
// operator about anything unexpected left open.

export interface UfwPortDto {
  port: number;
  proto: 'tcp' | 'udp';
}

export interface UfwPortsResponse {
  /** false = ufw not installed on the node; the panel skips the exposure check. */
  managed: boolean;
  ports: UfwPortDto[];
}

// ───── Common error shape ─────

export interface NodeErrorResponse {
  error: string;
  message: string;
}
