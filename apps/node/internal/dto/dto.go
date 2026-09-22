// Package dto contains JSON wire-format structs for the panel↔node API.
// Field names match the TypeScript DTOs in `packages/shared/src/transport.ts`.
package dto

import "encoding/json"

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
	// Provisioned tells "this core has a config and should be running" apart
	// from "nobody has configured this core yet". The installer registers an
	// adapter for every protocol the operator might switch on later, so an
	// idle core is the normal state of a healthy node, not a fault.
	//
	// Pointer + omitempty on purpose: absent means the agent is older than the
	// field, which is NOT the same as false. A panel reading absent must assume
	// configured, the behaviour that predates it.
	Provisioned *bool `json:"provisioned,omitempty"`
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
}

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
