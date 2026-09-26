// Package dto contains JSON wire-format structs for the panel↔node API.
// Field names match the TypeScript DTOs in `packages/shared/src/transport.ts`.
package dto

import (
	"encoding/json"
	"fmt"
)

// ProtocolName mirrors the union in shared/transport.ts.
type ProtocolName string

const (
	ProtocolHysteria    ProtocolName = "hysteria"
	ProtocolXray        ProtocolName = "xray"
	ProtocolAmneziaWG   ProtocolName = "amneziawg"
	ProtocolNaive       ProtocolName = "naive"
	ProtocolShadowsocks ProtocolName = "shadowsocks"
	ProtocolTuic        ProtocolName = "tuic"
	ProtocolAnytls      ProtocolName = "anytls"
	ProtocolShadowtls   ProtocolName = "shadowtls"
)

// EngineName identifies the proxy core that renders an inbound. Most protocols
// have a single native core; the shared protocols can additionally be served
// by the sing-box engine (engine-choice).
type EngineName string

const (
	EngineXray     EngineName = "xray"
	EngineHysteria EngineName = "hysteria"
	EngineSingbox  EngineName = "singbox"
	// AmneziaWG as a chain entry, phase 7. Its adapter answers Engine() with
	// the same word.
	EngineAmneziawg EngineName = "amneziawg"
)

// NativeEngine returns the default core for a protocol when an inbound does not
// pin an explicit engine. Shadowsocks runs on xray-core; tuic/anytls are
// singbox-only; every other protocol's native core shares the protocol's name.
func NativeEngine(p ProtocolName) EngineName {
	switch p {
	case ProtocolShadowsocks:
		return EngineXray
	case ProtocolTuic, ProtocolAnytls, ProtocolShadowtls:
		return EngineSingbox
	default:
		return EngineName(p)
	}
}

type ProtocolCredentials struct {
	HysteriaPassword   string `json:"hysteriaPassword,omitempty"`
	XrayUUID           string `json:"xrayUuid,omitempty"`
	NaivePassword      string `json:"naivePassword,omitempty"`
	AmneziaWGPublicKey string `json:"amneziawgPublicKey,omitempty"`
	// AmneziaWGAllowedIP is the IP the panel allocated for this user inside
	// the inbound's subnet (e.g. "10.0.0.42"). The adapter writes it into
	// the peer block as `<ip>/32`. Only present when the user has access to
	// an amneziawg inbound.
	AmneziaWGAllowedIP string `json:"amneziawgAllowedIp,omitempty"`
	// AmneziaWGAllowedIP3 is the user's address on the node's 3.1 interface
	// (t07-6), from the 3.1 profile's own subnet: the two interfaces cannot
	// share one. Same public key.
	AmneziaWGAllowedIP3 string `json:"amneziawgAllowedIp3,omitempty"`
	// TUIC (sing-box engine): per-user UUID + password. Both required for a
	// TUIC v5 client to authenticate. Only present when the user has access
	// to a tuic inbound.
	TuicUUID     string `json:"tuicUuid,omitempty"`
	TuicPassword string `json:"tuicPassword,omitempty"`
	// AnyTLS (sing-box engine): per-user password (password-only auth).
	AnytlsPassword string `json:"anytlsPassword,omitempty"`
	// ShadowTLS (sing-box engine): per-user password for the shadowtls v3
	// users[] (the inner shadowsocks key is server-wide, in the inbound config).
	ShadowtlsPassword string `json:"shadowtlsPassword,omitempty"`
}

// ───── POST /addUser ─────

type AddUserRequest struct {
	UserID      string              `json:"userId"`
	ShortID     string              `json:"shortId"`
	Username    string              `json:"username"`
	Credentials ProtocolCredentials `json:"credentials"`
}

type AddUserResponse struct {
	OK bool `json:"ok"`
}

// ───── POST /applyInbounds ─────
//
// Panel pushes the FULL set of enabled inbounds bound to this node. Slice 24:
// replaces the env-var workflow (XRAY_REALITY_*, /etc/hysteria/config.yaml
// hand-edits) caught as friction during the 2026-05-06 VPS test.
//
// The Config field is intentionally raw JSON: each adapter decodes only the
// shape that matches its protocol. Keeps the dto layer protocol-agnostic and
// avoids forcing every node-agent build to know every protocol's schema.

type InboundDto struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Protocol ProtocolName `json:"protocol"`
	// Engine pins the proxy core that renders this inbound. Empty -> the
	// protocol's NativeEngine. Lets a shared protocol (vless/vmess/trojan/ss/
	// hy2) be served by the sing-box engine instead of its native core.
	Engine EngineName      `json:"engine,omitempty"`
	Port   int             `json:"port"`
	Config json.RawMessage `json:"config"`
}

// ResolvedEngine returns the inbound's pinned engine, falling back to the
// protocol's native core when none is set (backward-compat: inbounds created
// before engine-choice carry no engine field).
func (i InboundDto) ResolvedEngine() EngineName {
	if i.Engine != "" {
		return i.Engine
	}
	return NativeEngine(i.Protocol)
}

// NodePolicy mirrors NodePolicy in shared/transport.ts: what this node does
// with traffic, decided by the node rather than by the client.
//
// A stage of its own, alongside the inbounds rather than inside one. The
// cascade fragments it resembles hang off an InboundDto and are absent on a
// plain node, they are several lists merged in a loop with nobody owning the
// order between them (the WARP rule in xray/config.go already loses that race),
// and being raw xray objects they cannot be named, which a non-xray core needs:
// on AmneziaWG the same policy is iptables in PostUp.
//
// Nil or an empty rule list must render exactly as before. That is the property
// the first commit is verified against.
type NodePolicy struct {
	// Evaluated top to bottom, first match wins.
	Rules []NodePolicyRule `json:"rules"`
}

type NodePolicyRule struct {
	Match  NodePolicyMatch  `json:"match"`
	Action NodePolicyAction `json:"action"`
}

// NodePolicyMatch: every field optional, they AND together. Empty = catch-all,
// which is legitimate as the last rule and a mistake anywhere else.
//
// Domain and IP carry the engine-neutral spelling the panel uses elsewhere
// ("geosite:category-ru", "geoip:ru", "domain:example.com", plain hosts, CIDRs);
// the node translates for whatever core it runs.
type NodePolicyMatch struct {
	Domain   []string `json:"domain,omitempty"`
	IP       []string `json:"ip,omitempty"`
	Port     string   `json:"port,omitempty"`
	Protocol []string `json:"protocol,omitempty"`
	Network  string   `json:"network,omitempty"`
}

// Action kinds. A destination, not a direction.
const (
	PolicyActionDirect  = "direct"
	PolicyActionBlock   = "block"
	PolicyActionWarp    = "warp"
	PolicyActionCascade = "cascade"
)

// NodePolicyAction is the TypeScript discriminated union flattened: `kind`
// selects, and `exit` belongs to the cascade kind alone. Go has no union type,
// so an unknown kind has to be rejected explicitly by the renderer rather than
// falling through to a default - a policy rule that quietly does something else
// is worse than one that refuses to apply.
type NodePolicyAction struct {
	Kind string `json:"kind"`
	// Cascade only: the outbound name the PANEL generated in this node's
	// cascade fragments. Opaque here; a name that is not in the rendered config
	// fails the core's own validation, which is louder than a rule that never
	// fires.
	Exit string `json:"exit,omitempty"`
}

// DnsCfg mirrors DnsCfg in shared/transport.ts: who answers the name lookups of
// this NODE's users (Э3 piece F).
//
// The node renders no `dns` section today, so the DNS-hijack rule hands client
// queries to dns-out and they fall through to the NODE's system resolver. On a
// cascade that is the wrong machine: the name is resolved by the entry while
// the connection leaves from the exit (E13). Naming a resolver fixes it without
// touching the routing stages, because the built-in DNS dials its servers as
// ordinary connections and those take the same road as the traffic.
//
// On the node rather than on a profile: the core keeps ONE dns section per
// process and the process is one per node, so a per-profile setting meant two
// profiles on one node could disagree about a value only one of them could get.
//
// Nil renders exactly as before, which is the property the first commit is
// verified against.
type DnsCfg struct {
	// Servers in order; the first whose Domains match answers. A bare address
	// with no Domains is the general resolver.
	Servers []DnsServer `json:"servers"`
	// UseIP | UseIPv4 | UseIPv6. Empty = the core's default.
	QueryStrategy string `json:"queryStrategy,omitempty"`
	DisableCache  bool   `json:"disableCache,omitempty"`
}

type DnsServer struct {
	// Plain IP or a DoH endpoint. A plain IP dodges the bootstrap problem of
	// resolving the resolver's own hostname.
	Address string `json:"address"`
	// Names this server is authoritative for. Empty = it answers everything,
	// and it renders as a bare string rather than an object, which is the shape
	// xray uses for a plain fallback resolver.
	Domains []string `json:"domains,omitempty"`
	// Only accept answers inside these ranges, e.g. ["geoip:ru"].
	ExpectIPs []string `json:"expectIps,omitempty"`
	// Keep queries this server declined off the general resolver.
	SkipFallback bool `json:"skipFallback,omitempty"`
}

type ApplyInboundsRequest struct {
	Inbounds []InboundDto `json:"inbounds"`
	// Raw rather than decoded: the server hands it to whichever adapters accept
	// a policy without interpreting it, exactly as it does with InboundDto.
	// Config. Absent field = nil = render as before.
	Policy json.RawMessage `json:"policy,omitempty"`
	// The node's resolver (DnsCfg), raw for the same reason as Policy. Absent
	// field = nil = no `dns` section, the host's own resolver answers.
	Dns json.RawMessage `json:"dns,omitempty"`
	// This node's hop in a cascade. Absent = not part of one.
	Cascade *NodeCascade `json:"cascade,omitempty"`
	// The chain as its own process (phase 4). Absent = this node draws the
	// chain inside its user core, which is what every node does today.
	//
	// ⚠ For one transitional release the panel sends BOTH this and Cascade. An
	// agent that understands Chain must IGNORE Cascade: two link-outs for one
	// chain would fight over the link port. An older agent never sees this
	// field and keeps reading Cascade, so a half-updated fleet keeps serving.
	Chain *NodeChain `json:"chain,omitempty"`
	// The geo files this push stands on (phase 9), each already laid out in
	// the geo directory through PUT /assets. Absent = the directory is not
	// touched, the state of every push from an older panel. A named file this
	// agent does not hold with that sha256 refuses the WHOLE push before
	// anything is applied: 409 GEO_MISSING.
	Geo *NodeGeo `json:"geo,omitempty"`
}

// NodeGeo mirrors NodeGeo in shared/transport.ts. Contract:
// docs/plan/geo-contract.md section 1.
type NodeGeo struct {
	// A label for the set of files; comparison is by each file's sha256.
	Version string        `json:"version"`
	Files   []NodeGeoFile `json:"files"`
}

// NodeGeoFile is one file in the geo directory.
type NodeGeoFile struct {
	// Name matches geo.ValidName: geosite.dat, geoip.dat, iceslab-<set>.dat
	// or iceslab-<set>.<tag>.json.
	Name   string `json:"name"`
	Sha256 string `json:"sha256"`
	Size   int64  `json:"size"`
	// Reader is who reads it: "xray" (a .dat, so a change restarts xray) or
	// "chain" (a rule-set the chain reloads by itself).
	Reader string `json:"reader"`
}

// GeoFileDto is one file as the agent finds it on disk: GET /assets, the
// answer to PUT /assets/<name>, and the files of the healthcheck's geo.
type GeoFileDto struct {
	Name   string `json:"name"`
	Sha256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// GeoAssetsResponse answers GET /assets.
type GeoAssetsResponse struct {
	Files []GeoFileDto `json:"files"`
}

// GeoMissingResponse is the 409 refusing a push whose geo names files this
// agent does not hold: the ErrorResponse shape plus the names.
type GeoMissingResponse struct {
	Error   string   `json:"error"`
	Message string   `json:"message"`
	Files   []string `json:"files"`
}

// GeoStatusDto is what the healthcheck says about the geo directory. Version
// is that of the last applied push that carried geo, null before one; Files
// is what lies on disk with its actual sha256, not an echo of the push.
type GeoStatusDto struct {
	Version *string      `json:"version"`
	Files   []GeoFileDto `json:"files"`
}

// NodeChain mirrors NodeChain in shared/transport.ts: the chain drawn by a
// separate process, rendered by the PANEL.
//
// Config is raw for the same reason Fragments is: there is one renderer and one
// chain engine, so a second vocabulary in the middle would buy nothing and go
// stale against the engine's own schema. The agent asks the engine whether it
// loads (`sing-box check`), writes it, starts it.
type NodeChain struct {
	// Which engine runs the chain. Checked rather than assumed: an agent that
	// does not know the name must refuse the block, not guess at the JSON.
	Engine string `json:"engine"`
	// The engine's own config, verbatim.
	Config json.RawMessage `json:"config"`
	// One loopback socks listener per WAY OUT, not per node: a pool of exits on
	// a direction shares one, the same way it shares one link port.
	Socks []ChainSocks `json:"socks"`
	// Password for every listener above. On 127.0.0.1 and still authenticated:
	// a VPS has other users, and an unauthenticated proxy on loopback is an
	// open relay for anyone with a shell on that machine.
	SocksPassword string `json:"socksPassword"`
	// What the USER'S core renders while the chain process holds the chain: the
	// same cascade fragments, ending in a socks outbound to the loopback ports
	// above instead of a leg dialled across the internet.
	//
	// ⚠ HERE and not in Cascade, because both blocks go out together for one
	// release. Cascade is what an OLD agent applies, so it must stay the legacy
	// drawing or that agent would point its xray at a socks port nothing is
	// listening on. A new agent therefore ignores Cascade and renders this.
	//
	// Absent on a transit or an exit: they have no user core to hand over from.
	UserCore *ChainUserCore `json:"userCore,omitempty"`
	// Tunnels are the AWG tunnels this node's legs ride in, phase 8, on both
	// ends of each leg. Mirrors NodeChain.tunnels. Shipped in the contract ahead
	// of the agent's half (Ф8.2); until then no panel sends it.
	Tunnels []ChainTunnel `json:"tunnels,omitempty"`
}

// ChainTunnelIfacePrefix starts the name of every leg tunnel: awg-l<index>.
// The agent refuses a tunnel named otherwise, so a panel cannot point it at an
// interface that belongs to something else on the machine. Mirrors
// LINK_TUNNEL_IFACE_PREFIX in shared/transport.ts (contract-mirror.test.ts).
const ChainTunnelIfacePrefix = "awg-l"

// ChainTunnel mirrors ChainTunnel in shared/transport.ts: one AWG tunnel under
// a cascade leg, as its end on this node sees it.
type ChainTunnel struct {
	// Iface is awg-l<index>.
	Iface string `json:"iface"`
	// Conf is the whole awg-quick config for this end, verbatim.
	Conf string `json:"conf"`
	// ListenPort is set on the receiving end only: the UDP port to open.
	ListenPort int `json:"listenPort,omitempty"`
}

// ChainUserCore mirrors NodeChain.userCore in shared/transport.ts, which is a
// union by engine: xray carries Fragments, hysteria carries Socks (phase 6),
// amneziawg carries TProxy (phase 7).
//
// Go has no sum types, so the union is optional halves here and the rule is
// enforced by Payload: the half that belongs to the named engine must be there,
// and no other one may be. The adapter the payload is handed to never has to
// guess which half it was given.
type ChainUserCore struct {
	Engine    EngineName           `json:"engine"`
	Fragments json.RawMessage      `json:"fragments,omitempty"`
	Socks     *ChainUserCoreSocks  `json:"socks,omitempty"`
	TProxy    *ChainUserCoreTProxy `json:"tproxy,omitempty"`
	// TProxy3 is the 3.1 interface's hand-off (t07-6b), its own mark.
	TProxy3 *ChainUserCoreTProxy `json:"tproxy3,omitempty"`
}

// AwgHandoff is what the amneziawg adapter is handed: the 1.x interface's
// hand-off at the top level, where it has been since t07-wire, and the 3.1
// interface's beside it.
type AwgHandoff struct {
	Port    int                  `json:"port,omitempty"`
	Mark    uint32               `json:"mark,omitempty"`
	TProxy3 *ChainUserCoreTProxy `json:"tproxy3,omitempty"`
}

// ChainUserCoreTProxy mirrors ChainUserCoreTProxy in shared/transport.ts: where
// an awg interface steers its users. Mark is ONE number for the firewall mark
// and the routing table, per interface (base + the interface's listen port), so
// two awg interfaces on one node never take each other's ip rule down.
type ChainUserCoreTProxy struct {
	Port int    `json:"port"`
	Mark uint32 `json:"mark"`
}

// ChainUserCoreSocks mirrors ChainUserCoreSocks in shared/transport.ts: where a
// hysteria entry hands every user to the chain. A PORT and not an address: the
// hysteria adapter writes 127.0.0.1 itself, so a push cannot point it anywhere
// but another port on this machine.
type ChainUserCoreSocks struct {
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// Payload is what the adapter of the named engine receives, or an error for a
// block whose halves do not match its engine.
//
// ⚠ Refusing is the safe answer, and it has to be loud. A hysteria block with
// no socks, delivered as "nothing", would render hysteria with no outbounds at
// all: every user of that entry would leave from the ENTRY country with a
// working connection, which is the leak past the cascade this phase exists to
// prevent. An xray block with no fragments has the same shape of failure.
func (u *ChainUserCore) Payload() (json.RawMessage, error) {
	hasFragments := len(u.Fragments) > 0 && string(u.Fragments) != "null"
	switch u.Engine {
	case EngineHysteria:
		if u.Socks == nil {
			return nil, fmt.Errorf("chain userCore: engine hysteria carries no socks hand-off")
		}
		if hasFragments {
			return nil, fmt.Errorf("chain userCore: engine hysteria carries xray fragments")
		}
		if u.TProxy != nil || u.TProxy3 != nil {
			return nil, fmt.Errorf("chain userCore: engine hysteria carries a tproxy hand-off")
		}
		return json.Marshal(u.Socks)
	case EngineXray:
		if !hasFragments {
			return nil, fmt.Errorf("chain userCore: engine xray carries no fragments")
		}
		if u.Socks != nil {
			return nil, fmt.Errorf("chain userCore: engine xray carries a socks hand-off")
		}
		if u.TProxy != nil || u.TProxy3 != nil {
			return nil, fmt.Errorf("chain userCore: engine xray carries a tproxy hand-off")
		}
		return u.Fragments, nil
	case EngineAmneziawg:
		// Same failure shape as the other two: an awg entry told "nothing"
		// draws no TPROXY rules, and its users leave by the host's own route,
		// out of the entry country.
		// One of the two interfaces at least (t07-6b): an entry that serves
		// 3.1 alone has no 1.x hand-off.
		if u.TProxy == nil && u.TProxy3 == nil {
			return nil, fmt.Errorf("chain userCore: engine amneziawg carries no tproxy hand-off")
		}
		if hasFragments || u.Socks != nil {
			return nil, fmt.Errorf("chain userCore: engine amneziawg carries another engine's hand-off")
		}
		h := AwgHandoff{TProxy3: u.TProxy3}
		if u.TProxy != nil {
			h.Port, h.Mark = u.TProxy.Port, u.TProxy.Mark
		}
		return json.Marshal(h)
	default:
		return nil, fmt.Errorf("chain userCore: engine %q draws no user core", u.Engine)
	}
}

type ChainSocks struct {
	// The way out this listener carries, as a cascade direction tag. 0 is the
	// "Auto" line that names no direction; direction tags are issued from a
	// counter starting at 1, so zero cannot collide with one.
	Tag int `json:"tag"`
	// Always loopback, always CHAIN_SOCKS_BASE + Tag. Sent rather than derived
	// here: the agent must open exactly these and no others, and a rule the
	// wire does not carry is one two programs keep in step by hand.
	Port int `json:"port"`
}

// NodeCascade mirrors NodeCascade in shared/transport.ts: this node's hop in a
// cascade, as a node-level block.
//
// It used to ride on the xray inbound, which put a node-level thing behind a
// per-inbound switch. A node has one chain, not one per door.
//
// Engine names the node's ROUTER, the one core that draws the stages and knows
// every way out. It decides WHICH adapter is handed the block: unlike the
// policy, this one is not broadcast, because two cores rendering it would fight
// over the link port. It is also the discriminant that will select the shape of
// Fragments once a second router exists, which is why Fragments stays raw here.
type NodeCascade struct {
	Engine    EngineName      `json:"engine"`
	Fragments json.RawMessage `json:"fragments"`
}

type ApplyInboundsResponse struct {
	OK      bool `json:"ok"`
	Applied int  `json:"applied"`
	Skipped int  `json:"skipped"`
}

// ───── POST /removeUser ─────

type RemoveUserRequest struct {
	UserID string `json:"userId"`
}

type RemoveUserResponse struct {
	OK bool `json:"ok"`
}

// ───── GET /stats ─────

type UserStats struct {
	UserID   string `json:"userId"`
	BytesIn  int64  `json:"bytesIn"`
	BytesOut int64  `json:"bytesOut"`
	// Cumulative=true means THIS user's counters are cumulative-since-core-start
	// (the producing adapter does a non-destructive read: xray / sing-box); false
	// or omitted means they are already per-poll deltas (awg / hysteria / ss /
	// mtproto). Set per-user so a node running BOTH a cumulative and a delta core
	// reports each user correctly. Previously only the response-level Cumulative
	// below existed, so a mixed node OR'd to true and the panel snapshot-deltaed
	// the delta-core users down to ~zero (traffic under-count). Older panels
	// ignore this field and fall back to the response-level flag.
	Cumulative bool `json:"cumulative,omitempty"`
	// Protocol is the Name() of the adapter that reported this entry, i.e. the
	// protocol of the inbound the user came through (25.09). The panel reads
	// presence-only accounting (mtproto: the user being listed is the online
	// signal, there are no bytes) off it per entry, where it used to read the
	// node's label, which on a node with xray beside mtproto said "xray" and
	// left every mtproto user offline. Omitted by older agents.
	Protocol string `json:"protocol,omitempty"`
}

type GetStatsResponse struct {
	Users         []UserStats `json:"users"`
	Uptime        int64       `json:"uptime"`
	TotalBytesIn  int64       `json:"totalBytesIn"`
	TotalBytesOut int64       `json:"totalBytesOut"`
	// Cumulative=true means Users[] counters are cumulative-since-core-start and
	// the panel must compute deltas against its stored snapshot. Absent/false
	// keeps the legacy "already-deltas" interpretation for older agents. #5.
	Cumulative bool `json:"cumulative,omitempty"`
}

// ───── GET /healthz ─────

// CoreRestartsDto is the per-core restart tally (2026-08-04). Omitted entirely
// by adapters that don't supervise a subprocess and by pre-2026-08 agents, so
// the panel must treat its absence as "unknown", not as "zero restarts".
type CoreRestartsDto struct {
	// Core names which core these numbers belong to ("xray", ...). Present so a
	// reader never has to infer it from the node's protocol: today only xray
	// arms the watchdog, but the mechanism is core-agnostic.
	Core string `json:"core"`
	// Total is Crash+Memory, sent explicitly so a reader doesn't have to know
	// the breakdown is exhaustive (a future third cause would keep Total right
	// while crash+memory silently stopped adding up).
	Total  int `json:"total"`
	Crash  int `json:"crash"`
	Memory int `json:"memory"`
	// LastAt is RFC3339, empty when nothing has restarted yet.
	LastAt string `json:"lastAt,omitempty"`
	// LastReason is "crash" or "memory" (subprocess.RestartReason), empty until
	// something restarts.
	LastReason string `json:"lastReason,omitempty"`
	// SinceAt (RFC3339) is when the agent started counting. Counters are
	// in-memory, so they reset when the agent restarts; without this a bare
	// "3 restarts" can't be dated.
	SinceAt string `json:"sinceAt,omitempty"`
	// MemoryLimitBytes is the armed ceiling; 0 means the watchdog is off.
	// RssBytes is the latest sample (0 = not sampled / not supported).
	MemoryLimitBytes uint64 `json:"memoryLimitBytes,omitempty"`
	RssBytes         uint64 `json:"rssBytes,omitempty"`
}

// ReservedPortDto is a port held by a core's own SERVICE rather than by a user
// inbound: hysteria's auth callback and stats API, the loopback gRPC port xray
// and sing-box open for per-user counters, mtg's stats port.
//
// Owner is a KEY, never a phrase ("hysteria-auth", "singbox-api"). The panel is
// bilingual and turns it into words; a sentence written here would arrive in
// English and could never be translated.
//
// The set of keys is OPEN. A new adapter adds its own, and a panel that does
// not know it shows the key rather than refusing to draw the row, so adding an
// adapter stays a one-repo change.
type ReservedPortDto struct {
	Owner string `json:"owner"`
	Port  int    `json:"port"`
	// Transport is "tcp" or "udp". Every reserved port is tcp today and it is
	// sent anyway: the panel compares it with a binding's transport, and
	// assuming would repeat the mistake the port key made before it learned
	// that 443/TCP and 443/UDP are different sockets.
	Transport string `json:"transport"`
}

type CoreStatus struct {
	Name    ProtocolName `json:"name"`
	Running bool         `json:"running"`
	// Engine is the proxy core that renders this protocol here ("xray",
	// "singbox", "hysteria"). Name is the PROTOCOL, and the two are not the
	// same question: tuic and vless can both be sing-box on one node. Empty
	// from an agent older than the field.
	Engine string `json:"engine,omitempty"`
	// RendersPolicy / RendersDns: whether THIS core carries out the node-level
	// policy and the node-level resolver. Both are optional adapter interfaces
	// (core.PolicyReceiver, core.DnsReceiver) and today exactly one core
	// implements them, so on a node running anything else the operator's policy
	// does nothing at all.
	//
	// Reported by the node rather than decided from a table in the panel, which
	// would drift from the agent the day a second adapter learns to render one,
	// and drift silently.
	//
	// Pointer + omitempty, same rule as Provisioned: absent means the agent
	// predates the field, which is NOT the same as false. A panel reading absent
	// must say "unknown", never "does not render it".
	RendersPolicy *bool `json:"rendersPolicy,omitempty"`
	RendersDns    *bool `json:"rendersDns,omitempty"`
	// Restarts is present only for cores that supervise a real process. See
	// CoreRestartsDto: absent means "this agent/core doesn't report", which is
	// NOT the same as zero.
	Restarts *CoreRestartsDto `json:"restarts,omitempty"`
	// Version is the underlying core binary version (e.g. "26.3.27" from
	// `xray version`), empty when the adapter can't report one. The panel
	// stores it per node to gate features needing a minimum core version
	// (exit selection needs xray >= 25.9.5). Optional/omitempty so pre-T7
	// agents and non-versioned cores stay wire-compatible.
	Version string `json:"version,omitempty"`
	// ToolsVersion is the version of the core's userspace tools when they are
	// versioned apart from Version. Only AmneziaWG today: Version is the kernel
	// module, this is `awg --version`, from a different upstream tag. Empty on
	// every other core.
	ToolsVersion string `json:"toolsVersion,omitempty"`
	// AwgProtocol is the AmneziaWG protocol generation the loaded kernel module
	// speaks, 1 or 3 (Ф7, t07-1). The MODULE's, not an interface's: a 3.1
	// module carries a 1.x interface beside a 3.1 one (Ф7.0 m1). Only the
	// amneziawg core sets it. 0 (absent) is unknown, never 1: no module, or a
	// version that does not tell the generation.
	AwgProtocol int `json:"awgProtocol,omitempty"`
	// AwgGenerations are the interface generations this AGENT can carry, [1]
	// or [1,3] (t07-6). Not the module's: an agent older than the 3.1
	// interface takes a 3.1 inbound for a 1.x one and overwrites the live 1.x
	// interface with it, so the panel refuses a 3.1 profile where 3 is not
	// listed. Only the amneziawg core sets it.
	AwgGenerations []int `json:"awgGenerations,omitempty"`
	// Provisioned tells "this core has a config and should be running" apart
	// from "nobody has configured this core yet". The installer registers an
	// adapter for every protocol the operator might switch on later, so an
	// idle core is the normal state of a healthy node, not a fault.
	//
	// Pointer + omitempty on purpose: absent means the agent is older than the
	// field, which is NOT the same as false. A panel reading absent must assume
	// configured, the behaviour that predates it.
	Provisioned *bool `json:"provisioned,omitempty"`
	// Reason says why a core is not running when that is by design and not a
	// fault. Today one value, "no inbounds in the last push": the last push the
	// agent applied named no inbound for this core, so the agent stopped it and
	// it does not degrade the node. Empty otherwise.
	Reason string `json:"reason,omitempty"`
	// Installed answers a different question from Provisioned: is the core's
	// BINARY on this machine. Provisioned is about configuration the panel
	// pushed; a core can be configured perfectly and absent from the disk, and
	// then it renders nothing. An adapter is registered for every protocol the
	// operator might switch on later, so this is a normal state, not a fault.
	//
	// Pointer + omitempty, same rule again: absent means the agent predates the
	// field and must be read as installed, or today's whole fleet reads as
	// empty machines.
	Installed *bool `json:"installed,omitempty"`
	// ReservedPorts are the ports this core's own services hold. See
	// ReservedPortDto.
	//
	// A POINTER to a slice, and the indirection is the whole point: it is the
	// only way JSON can carry three states where a bare slice carries two.
	//
	//	absent  - this core cannot speak about its ports (no interface, or an
	//	          agent older than the field). The panel must not promise any
	//	          port on this node is free.
	//	[]      - it spoke, and it holds nothing. An ANSWER, not a silence.
	//	[...]   - it holds these.
	//
	// With `omitempty` on a bare slice the middle state was unreachable: an
	// adapter that reserves nothing looked exactly like one that cannot say,
	// so a node running mieru or naive could never reach full certainty.
	ReservedPorts *[]ReservedPortDto `json:"reservedPorts,omitempty"`
	// TLS is the certificate this core serves, as the adapter read it from what
	// it was given (E30a). Today only native hysteria. Absent = unknown.
	TLS *CoreTLSDto `json:"tls,omitempty"`
}

// CoreTLSDto mirrors CoreTls in shared/transport.ts.
//
//	Source      "acme" (a public CA by name) or "self-signed" (the panel's
//	            certificate for a node addressed by IP, pinned by clients)
//	CertSha256  sha256 of the certificate's DER, lowercase hex, no colons;
//	            empty for acme, whose store the agent does not read
//	NotAfter    RFC 3339, when known
type CoreTLSDto struct {
	Source     string `json:"source"`
	CertSha256 string `json:"certSha256,omitempty"`
	NotAfter   string `json:"notAfter,omitempty"`
}

// ChainStatusDto mirrors ChainStatus in shared/transport.ts: the chain process
// this node runs, when it runs one.
//
// Not an entry in Cores, and the difference is not cosmetic: CoreStatus.Name is
// a ProtocolName, the chain is not a protocol, and the test that keeps that
// enumeration honest against this agent would be right to refuse it. One
// process per node, one question, its own field.
type ChainStatusDto struct {
	Running bool `json:"running"`
	// Engine version ("1.13.14"), empty when the binary cannot say.
	Version string `json:"version,omitempty"`
	// Why it is not running, in the engine's own words: a refused config, a
	// failed start. Empty while it runs.
	Error string `json:"error,omitempty"`
	// The loopback socks ports the chain holds, one per way out, owner
	// "chain-socks".
	//
	// HERE rather than folded into a core's ReservedPorts, which is where they
	// briefly were: that said "xray holds 26000" about a port the chain holds,
	// and choosing which core to attach them to made the answer depend on what
	// else the node runs. The panel reads both lists as one set, and the owner
	// key names the holder.
	//
	// No omitempty and no pointer: while there is a chain there are listeners,
	// so this needs none of the three-state machinery CoreStatus.ReservedPorts
	// carries. The presence of the chain block is the "it answered".
	ReservedPorts []ReservedPortDto `json:"reservedPorts"`
}

type HealthcheckResponse struct {
	Status string       `json:"status"`
	Cores  []CoreStatus `json:"cores"`
	// The chain process, absent when this node has none. A pointer so absence
	// is a state: nil means "no chain here", which is every node until the
	// panel starts sending the chain block, and stays true afterwards for
	// every node outside a cascade.
	//
	// ⚠ A panel must never read absence as "chain down". Doing so would turn
	// the whole fleet red on the day this field shipped.
	Chain *ChainStatusDto `json:"chain,omitempty"`
	// Arch is this machine in the version manifest's names: amd64, arm64 or
	// armv7. Empty when it is none of them. The panel needs it to hand an
	// operator an update command: every release file and its sha256 is per
	// arch, and a bootstrap takes no version without its checksum.
	Arch string `json:"arch,omitempty"`
	// The geo directory. Absent only from an agent older than the field (or
	// one built without a geo directory); an agent that has one always says.
	Geo *GeoStatusDto `json:"geo,omitempty"`
	// Why the NODE is degraded when the cause is the machine and not a core or
	// the chain: today only ResolverDownReason (E37). Empty otherwise.
	Reason string `json:"reason,omitempty"`
	// DeclaredEngines: the cores this node's env declares, read on every
	// healthcheck from the blocks the bootstraps write (E42). The panel takes it
	// as the node's intended cores, so a core installed from the node page shows
	// as intended. A pointer so absence is a state: nil means the agent could
	// not read its env (or is older than the field), NOT "no cores"; an empty
	// list is a node whose env declares none.
	DeclaredEngines *[]EngineName `json:"declaredEngines,omitempty"`
	// ChainEngine: this agent carries cascade legs ONLY through its chain
	// process, which runs this engine (E46). Once a chain block reaches it the
	// legacy xray drawing is ignored, whether the chain then starts or not, so a
	// node without this engine carries no leg at all. Absent from an agent older
	// than the chain, which may still end vless and shadowsocks legs in xray.
	ChainEngine EngineName `json:"chainEngine,omitempty"`
}

// ResolverDownReason: the host's own resolver did not answer the agent's probe
// (E37, 25.09 on nl-01: every xray host of the node dead while all cores ran).
const ResolverDownReason = "system resolver not answering"

// ───── GET /metrics ─────
//
// Host-level CPU / memory / disk for the VPS the node-agent runs on. Polled
// by the panel every 15s and cached in Redis with TTL 60s, so the dashboard
// can show per-node load without paying mTLS round-trip on every page open.

type CPUMetricsDto struct {
	UsagePercent float64 `json:"usagePercent"`
	LoadAvg1     float64 `json:"loadAvg1"`
	LoadAvg5     float64 `json:"loadAvg5"`
	LoadAvg15    float64 `json:"loadAvg15"`
	Cores        int     `json:"cores"`
}

type MemoryMetricsDto struct {
	TotalBytes     uint64  `json:"totalBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	UsedPercent    float64 `json:"usedPercent"`
}

type DiskMetricsDto struct {
	Path        string  `json:"path"`
	TotalBytes  uint64  `json:"totalBytes"`
	UsedBytes   uint64  `json:"usedBytes"`
	UsedPercent float64 `json:"usedPercent"`
}

type HostMetricsResponse struct {
	CPU           CPUMetricsDto    `json:"cpu"`
	Memory        MemoryMetricsDto `json:"memory"`
	Disk          DiskMetricsDto   `json:"disk"`
	UptimeSeconds int64            `json:"uptimeSeconds"`
	CollectedAt   string           `json:"collectedAt"`
}

// ───── GET /ufwPorts ─────
//
// G4 probe-exposure: the agent reports the ufw-allowed inbound ports so the
// panel can compare them to the expected set (binding ports + SSH + mTLS port)
// and warn the operator about anything unexpected left open to the internet.

type UfwPortDto struct {
	Port  int    `json:"port"`
	Proto string `json:"proto"` // "tcp" | "udp"
}

type UfwPortsResponse struct {
	// Managed=false means ufw is not installed on the host; the panel skips
	// the exposure check rather than treating it as an error.
	Managed bool         `json:"managed"`
	Ports   []UfwPortDto `json:"ports"`
}

// ───── Common error shape ─────

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}
