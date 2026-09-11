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

type ApplyInboundsRequest struct {
	Inbounds []InboundDto `json:"inbounds"`
	// Raw rather than decoded: the server hands it to whichever adapters accept
	// a policy without interpreting it, exactly as it does with InboundDto.
	// Config. Absent field = nil = render as before.
	Policy json.RawMessage `json:"policy,omitempty"`
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

type CoreStatus struct {
	Name    ProtocolName `json:"name"`
	Running bool         `json:"running"`
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
}

type HealthcheckResponse struct {
	Status string       `json:"status"`
	Cores  []CoreStatus `json:"cores"`
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
