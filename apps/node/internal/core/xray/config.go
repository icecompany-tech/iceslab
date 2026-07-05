// Package xray implements CoreAdapter for Xray-core. Slice 17 ships VLESS +
// REALITY support via the config-restart pattern: every AddUser / RemoveUser
// regenerates `config.json` and restarts the xray subprocess. Brief downtime
// per mutation (~1s) is acceptable for the initial multi-core release.
//
// A future Phase 3 slice may switch to gRPC `proxyman.HandlerService.AlterInbound`
// for live user management with no restart, once we vendor the proto types.
package xray

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
)

// InboundConfig is the static part of the Xray config — generated once from
// admin settings (slice 23 will move these into the inbounds table) and kept
// constant across user mutations.
type InboundConfig struct {
	// Tag uniquely identifies the inbound inside Xray. Default: "vless-in".
	Tag string

	// ListenHost is the bind address. Default: "0.0.0.0".
	ListenHost string

	// ListenPort is the public TCP port for VLESS+REALITY. Default: 443.
	ListenPort int

	// REALITY settings — interface-level, not per-user. Slice 23 moves
	// these into the inbounds table and lets the admin edit them.
	RealityDest        string   // e.g. "www.cloudflare.com:443"
	RealityServerNames []string // e.g. ["www.cloudflare.com"]
	RealityPrivateKey  string   // x25519 private key (paired pubkey advertised in URI)
	RealityShortIDs    []string // hex strings, max 16 chars each

	// B3 REALITY extras. RealityXver (0|1|2) is the protocol version mirrored
	// to the upstream dest; 0 (default) renders as before. RealityMaxTimeDiff
	// (ms) caps the client/node clock skew REALITY tolerates; 0 (default) omits
	// the field and leaves xray-core's built-in value.
	RealityXver        int
	RealityMaxTimeDiff int

	// G probe resistance. Rate-limit (bytes/sec) for UNVERIFIED REALITY
	// fallback connections: a scanner that fails REALITY auth is forwarded to
	// the target throttled, so it sees a slow site, not a full-speed proxy.
	// 0 (default) omits the field and renders byte-identically to pre-G.
	RealityLimitFallbackUploadBytesPerSec   int
	RealityLimitFallbackDownloadBytesPerSec int

	// RealityMode (K9-B) selects how REALITY borrows a TLS identity:
	//   - "" / "steal-others": dest = an external camouflage site (default;
	//     works outside RU but SNI-IP-mismatches under RU-DPI).
	//   - "self-steal": dest = the node's own loopback TLS fallback
	//     (selfStealAddr) + serverNames = the node's domain, so SNI and IP are
	//     consistent. The adapter runs that fallback (see selfsteal.go) and
	//     withDefaults rewrites RealityDest to it.
	RealityMode string

	// RealityFallbackUpstream (G1) is the real site the self-steal local TLS
	// fallback reverse-proxies probe requests to, so a deep prober sees genuine
	// content instead of the stub landing page. Empty = static landing (the
	// default). Only meaningful when RealityMode is self-steal.
	RealityFallbackUpstream string

	// Flow controls Vision (xtls-rprx-vision) on the client side; empty disables.
	Flow string

	// ApiPort is the loopback port the gRPC StatsService listens on. Default
	// 8080. Slice 24c — adapter shells out to `xray api statsquery
	// -server 127.0.0.1:<ApiPort>` to read+drain per-user byte counters.
	// MUST stay on 127.0.0.1 (renderConfig hardcodes the listen host) —
	// exposing it externally would let anyone read+reset all counters.
	ApiPort int

	// Network is the stream transport. Empty/"raw" → REALITY canonical.
	// Slice 24c part 2 adds `xhttp`/`ws`/`grpc`/`httpupgrade`/`kcp` branches —
	// Vision flow is incompatible with all but `raw`/`xhttp`; the operator
	// is responsible for aligning Flow with Network at form level.
	Network string

	// Path is used by `ws`, `xhttp`, `httpupgrade` transports. Default "/".
	Path string

	// HostHeader overrides the Host header for `ws`/`xhttp`/`httpupgrade`.
	// Empty → use the connect host as Host.
	HostHeader string

	// ServiceName is required when Network is `grpc` (the gRPC service
	// identifier the inbound listens on).
	ServiceName string

	// Subprotocol carries which Xray-core protocol the user-facing inbound
	// runs: "vless" (default) or "trojan". Slice 24c part 3 — same REALITY
	// stack drives both, only the inbound's `protocol` and `clients` shape
	// differ. Trojan password reuses user.xrayUuid (set on the client side
	// of the panel; on the agent's renderConfig we map xrayClient.ID into
	// `password` for trojan instead of `id` for vless).
	Subprotocol string

	// Security is the stream security layer: "reality" (default / empty),
	// "none" (plain transport, e.g. ws/httpupgrade behind a CDN that terminates
	// TLS, or local testing), or "tls" (node-terminated TLS with an operator-
	// supplied cert). When "none" the Reality* fields are not required; when
	// "tls" the TLS* fields below are required and Reality* are ignored.
	Security string

	// TLS settings (Security == "tls"). Cert + key are PEM, embedded inline in
	// tlsSettings.certificates (no ACME on the node).
	TLSServerName string
	TLSCert       string
	TLSKey        string

	// B3 TLSRejectUnknownSni: when true, reject TLS handshakes whose SNI
	// matches no served server name. false (default) leaves the field off, so
	// pre-B3 configs render identically.
	TLSRejectUnknownSni bool

	// B3 XHTTP knobs (Network == "xhttp"). XhttpMode is the packet framing:
	// "" / "auto" (default) lets xray pick; "packet-up" / "stream-up" /
	// "stream-one" force a specific mode. XhttpPaddingBytes is a request-padding
	// byte range (e.g. "100-1000"); empty (default) disables padding.
	XhttpMode         string
	XhttpPaddingBytes string

	// B3 GrpcMultiMode (Network == "grpc"): multiplex several gRPC streams per
	// connection. false (default) keeps the single-stream behaviour.
	GrpcMultiMode bool

	// Warp is the optional Cloudflare WARP egress (per-node egress v1). When
	// non-nil, renderConfig adds a `wireguard` outbound to WARP and routes this
	// inbound's user traffic through it instead of `direct`. nil = direct egress
	// (default). See docs/studies/STUDY-warp-native.md.
	Warp *WarpConfig
}

// WarpConfig holds Cloudflare WARP egress credentials from a wgcf-style device
// registration, provisioned by the panel. PublicKey/Endpoint/MTU fall back to
// Cloudflare's well-known defaults when empty. Reserved is the account client_id
// as a 3-byte array (required in some regions); empty or exactly 3 bytes. The
// json tags let this type double as the panel-pushed wire shape (inbound.warp).
type WarpConfig struct {
	SecretKey string   `json:"secretKey"`
	Address   []string `json:"address"`
	PublicKey string   `json:"publicKey,omitempty"`
	Endpoint  string   `json:"endpoint,omitempty"`
	Reserved  []int    `json:"reserved,omitempty"`
	MTU       int      `json:"mtu,omitempty"`
}

const (
	// warpDefault* are Cloudflare WARP's well-known peer parameters (see study).
	warpDefaultPublicKey = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo="
	warpDefaultEndpoint  = "162.159.192.1:2408"
	warpDefaultMTU       = 1280
)

func (c *InboundConfig) withDefaults() InboundConfig {
	out := *c
	if out.Tag == "" {
		out.Tag = "vless-in"
	}
	if out.ListenHost == "" {
		out.ListenHost = "0.0.0.0"
	}
	if out.ListenPort == 0 {
		out.ListenPort = 443
	}
	// Empty Flow is intentional for non-raw transports (xhttp/ws/grpc/kcp/
	// httpupgrade) — Vision only works with raw (TCP). Earlier versions
	// forced empty → "xtls-rprx-vision" as a default, which broke xhttp:
	// xray rejected clients with "client flow is empty" because the server
	// account had Vision flow set while the client (xhttp transport)
	// connected without it. Trust the panel-side value as-is.
	if out.ApiPort == 0 {
		out.ApiPort = 8080
	}
	// K9-B self-steal: REALITY's dest is the node's own loopback TLS fallback,
	// regardless of what (if anything) the panel sent for RealityDest.
	if out.RealityMode == selfStealModeValue {
		out.RealityDest = selfStealAddr
	}
	return out
}

func (c *InboundConfig) validate() error {
	// WARP egress is orthogonal to inbound security, so validate it first.
	if c.Warp != nil {
		if c.Warp.SecretKey == "" {
			return errors.New("Warp.SecretKey is required when WARP egress is enabled")
		}
		if len(c.Warp.Address) == 0 {
			return errors.New("Warp.Address must have at least one entry")
		}
		if len(c.Warp.Reserved) != 0 && len(c.Warp.Reserved) != 3 {
			return errors.New("Warp.Reserved must be empty or exactly 3 bytes")
		}
	}
	// security="none" is a plain transport (CDN-fronted ws/httpupgrade or local
	// testing) with no REALITY material to validate.
	if c.Security == "none" {
		return nil
	}
	// security="tls" terminates TLS on the node with an operator-supplied cert.
	if c.Security == "tls" {
		if c.TLSCert == "" || c.TLSKey == "" {
			return errors.New("TLSCert and TLSKey are required for tls security")
		}
		return nil
	}
	if c.RealityPrivateKey == "" {
		return errors.New("RealityPrivateKey is required")
	}
	if len(c.RealityServerNames) == 0 {
		return errors.New("RealityServerNames must have at least one entry")
	}
	if len(c.RealityShortIDs) == 0 {
		return errors.New("RealityShortIDs must have at least one entry")
	}
	// K9-B self-steal: RealityDest is the node's own loopback TLS fallback,
	// supplied by withDefaults (selfStealAddr). The panel needn't send a dest,
	// and the loopback/SSRF guard below is intentionally bypassed: this
	// loopback target is our managed fallback, not an operator-pointed host.
	if c.RealityMode == selfStealModeValue {
		return nil
	}
	if c.RealityDest == "" {
		return errors.New("RealityDest is required")
	}
	// REALITY connects to RealityDest as the upstream fallback. A panel that
	// sets this to "127.0.0.1:22" or an internal RFC1918 address turns the
	// node into an SSRF gadget — anyone holding a REALITY URI can probe the
	// node's localhost or private LAN. Refuse loopback / link-local / private
	// destinations; production REALITY always points at a public Internet
	// camouflage host (e.g. www.cloudflare.com:443).
	if err := validateRealityDest(c.RealityDest); err != nil {
		return fmt.Errorf("RealityDest: %w", err)
	}
	return nil
}

func validateRealityDest(dest string) error {
	host, port, err := net.SplitHostPort(dest)
	if err != nil {
		return fmt.Errorf("must be host:port — got %q: %w", dest, err)
	}
	if host == "" || port == "" {
		return fmt.Errorf("host and port both required — got %q", dest)
	}
	// Hostnames are accepted (operator's typical case). When the value
	// parses as an IP literal, reject any that resolve to an unroutable or
	// internal block.
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
			ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return fmt.Errorf("IP %s is loopback/private/link-local — refuse to use as REALITY fallback", host)
		}
	}
	return nil
}

// xrayClient mirrors Xray's client-config object.
type xrayClient struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Flow  string `json:"flow,omitempty"`
}

// CascadeFragments are the extra xray config pieces a cascade hop contributes,
// generated panel-side (C2 buildCascadeConfigs) and pushed to the node alongside
// the inbound config:
//   - Inbounds:     the link-IN inbound (transit/exit nodes receive the prev hop)
//   - Outbounds:    the link-OUT outbound (entry/transit nodes dial the next hop)
//   - RoutingRules: per-role rules (entry: user->link-out; transit: link-in->
//     link-out; exit: link-in->direct). Appended AFTER the base rules so the
//     DNS-hijack and BitTorrent/SMTP block rules still take precedence.
//
// Each element is a raw JSON object so the panel owns the exact xray shape and
// the node-agent stays protocol-agnostic. Nil/empty = a non-cascade node, in
// which case renderConfig output is byte-identical to before this feature.
type CascadeFragments struct {
	Inbounds     []json.RawMessage `json:"inbounds"`
	Outbounds    []json.RawMessage `json:"outbounds"`
	RoutingRules []json.RawMessage `json:"routingRules"`
	// LinkIngressPort is the inter-hop link-IN port this node listens on (the
	// previous hop dials it). The node-agent opens UFW for it; renderConfig
	// ignores these two fields (the port already lives inside the Inbounds JSON).
	// 0 on the entry hop (no link-in).
	LinkIngressPort int `json:"linkIngressPort,omitempty"`
	// LinkAllowFrom is the source IP/CIDR/host allowed to reach LinkIngressPort
	// (the previous hop's address). Empty -> the agent opens the port to anywhere.
	LinkAllowFrom []string `json:"linkAllowFrom,omitempty"`
	// Observatory is the optional top-level `observatory` block a latency-
	// balanced ("auto") entry uses to probe its link-out outbounds by RTT. nil on
	// a plain single-exit cascade, so the config stays byte-identical then.
	Observatory json.RawMessage `json:"observatory,omitempty"`
	// Balancers are the optional `routing.balancers` entries a balanced entry
	// exposes; its user routing rule targets one via `balancerTag` (instead of a
	// fixed `outboundTag`), so xray picks the lowest-ping exit per connection.
	Balancers []json.RawMessage `json:"balancers,omitempty"`
}

// renderConfig produces a complete Xray config.json blob for the given users.
// Marshaled as indented JSON for human-readability when an operator needs to
// inspect what the adapter wrote. Thin wrapper over renderConfigWithCascade for
// the non-cascade path.
//
// Slice 24c — per-user stats. The config now wires up Xray's StatsService:
//
//   - `stats: {}` enables internal counter collection
//   - `policy.levels."0".statsUserUplink/Downlink: true` tells Xray to count
//     bytes per client (Xray uses the client's `email` field as the stat key,
//     and we set email = userId so panel can correlate)
//   - A dedicated `api` inbound on 127.0.0.1:8080 (loopback only) exposes
//     the gRPC StatsService — the adapter shells out to `xray api statsquery
//     -server 127.0.0.1:8080 -pattern user -reset` to read+drain counters.
//   - A `routing.rules` entry pins traffic from the api inbound to the api
//     outbound; without it Xray would refuse the loopback management calls.
//
// The api inbound MUST stay on 127.0.0.1 — exposing it externally would
// give anyone the ability to read all traffic counters and reset them.
func renderConfig(inbound InboundConfig, users []xrayClient) ([]byte, error) {
	return renderConfigWithCascade(inbound, users, nil)
}

// renderConfigWithCascade is renderConfig plus optional cascade fragments (C3).
// When cascade is nil the output is byte-identical to the pre-cascade config.
func renderConfigWithCascade(inbound InboundConfig, users []xrayClient, cascade *CascadeFragments) ([]byte, error) {
	if err := inbound.validate(); err != nil {
		return nil, err
	}
	cfg := inbound.withDefaults()

	inbounds := []any{
		map[string]any{
			"tag":            cfg.Tag,
			"listen":         cfg.ListenHost,
			"port":           cfg.ListenPort,
			"protocol":       userInboundProtocol(cfg),
			"settings":       buildUserInboundSettings(cfg, users),
			"streamSettings": buildStreamSettings(cfg),
			// Sniffing — slice 24c part 2. Lets routing rules see the
			// real destination protocol/SNI rather than just the IP/port,
			// which is needed for the `geosite:` and `protocol:` matchers
			// below to actually fire. `routeOnly: false` (default) means
			// the sniffed value also drives the connection, so DNS-over-
			// HTTPS hijack-protection rules work too.
			"sniffing": map[string]any{
				"enabled":      true,
				"destOverride": []string{"http", "tls", "quic"},
			},
		},
		map[string]any{
			"tag":      "api-in",
			"listen":   "127.0.0.1",
			"port":     cfg.ApiPort,
			"protocol": "dokodemo-door",
			"settings": map[string]any{
				"address": "127.0.0.1",
			},
		},
	}

	// Outbounds — slice 24c part 2:
	//   - `direct` (freedom): default exit
	//   - `dns-out`: DNS server outbound — routing rule below pins all
	//     `protocol: dns` traffic here so client DNS queries don't leak
	//     out via `direct` and reveal real destinations to the resolver
	//   - `blocked` (blackhole): drop target for BLOCK rules
	outbounds := []any{
		map[string]any{
			"protocol": "freedom",
			"tag":      "direct",
			"streamSettings": map[string]any{
				"sockopt": map[string]any{
					// BBR congestion control — measurably better throughput
					// on lossy networks (5-30% in our prod-runs). Requires
					// `net.core.default_qdisc=fq` + `net.ipv4.tcp_congestion
					// _control=bbr` in sysctl on the node — install-iceslab-node.sh
					// sets these (slice 23.1).
					"tcpCongestion": "bbr",
					"tcpFastOpen":   true,
				},
			},
		},
		map[string]any{"protocol": "dns", "tag": "dns-out"},
		map[string]any{"protocol": "blackhole", "tag": "blocked"},
	}

	rules := []any{
		// Loopback management: api inbound traffic only ever talks
		// to the api outbound (the StatsService).
		map[string]any{
			"type":        "field",
			"inboundTag":  []string{"api-in"},
			"outboundTag": "api",
		},
		// DNS hijack protection — route all DNS-protocol traffic to
		// the dns-out outbound so the upstream resolver can't see the
		// client's real IP.
		map[string]any{
			"type":        "field",
			"protocol":    []string{"dns"},
			"outboundTag": "dns-out",
		},
		// BLOCK rules — slice 24c part 2 anti-abuse:
		//   - BitTorrent: most VPS providers' AUP forbids it; one
		//     subscriber's torrenting can get the whole node nuked.
		//   - SMTP (port 25): outbound mail abuse / spam — providers
		//     blacklist the IP within hours.
		map[string]any{
			"type":        "field",
			"protocol":    []string{"bittorrent"},
			"outboundTag": "blocked",
		},
		map[string]any{
			"type":        "field",
			"port":        "25",
			"outboundTag": "blocked",
		},
	}

	// C3 — append cascade fragments. Order matters: cascade rules come AFTER the
	// base block/dns rules so a cascade entry's catch-all (user traffic ->
	// link-out) doesn't shadow DNS-hijack/BitTorrent/SMTP handling.
	if cascade != nil {
		for _, ib := range cascade.Inbounds {
			inbounds = append(inbounds, ib)
		}
		for _, ob := range cascade.Outbounds {
			outbounds = append(outbounds, ob)
		}
		for _, r := range cascade.RoutingRules {
			rules = append(rules, r)
		}
	}

	// WARP egress (per-node v1): add the Cloudflare WARP wireguard outbound and
	// route this inbound's user traffic through it. Appended last so the DNS,
	// BitTorrent/SMTP block, and cascade rules still take precedence (warp +
	// cascade is out of v1 scope: cascade routing matches first, so the warp
	// rule simply never fires on a cascade node).
	if cfg.Warp != nil {
		outbounds = append(outbounds, buildWarpOutbound(cfg.Warp))
		rules = append(rules, map[string]any{
			"type":        "field",
			"inboundTag":  []string{cfg.Tag},
			"outboundTag": "warp",
		})
	}

	// C3-auto: a latency-balanced entry ships `routing.balancers` (its user rule
	// targets one via balancerTag) plus a top-level `observatory` probing the
	// link-out outbounds. Both are raw JSON the panel owns; nil/empty = no
	// balancer, so the output stays byte-identical to a plain / non-cascade node.
	routing := map[string]any{
		"domainStrategy": "IPIfNonMatch",
		"rules":          rules,
	}
	if cascade != nil && len(cascade.Balancers) > 0 {
		bals := make([]any, 0, len(cascade.Balancers))
		for _, b := range cascade.Balancers {
			bals = append(bals, b)
		}
		routing["balancers"] = bals
	}

	doc := map[string]any{
		"log": map[string]any{
			"loglevel": "info",
		},
		"stats": map[string]any{},
		"api": map[string]any{
			"tag":      "api",
			"services": []string{"StatsService", "HandlerService"},
		},
		"policy": map[string]any{
			"levels": map[string]any{
				"0": map[string]any{
					"statsUserUplink":   true,
					"statsUserDownlink": true,
				},
			},
			"system": map[string]any{
				"statsInboundUplink":   true,
				"statsInboundDownlink": true,
			},
		},
		"inbounds":  inbounds,
		"outbounds": outbounds,
		"routing":   routing,
	}
	// A balanced entry also carries the top-level `observatory` (nil on every
	// other node, so the key is simply absent there).
	if cascade != nil && len(cascade.Observatory) > 0 {
		doc["observatory"] = cascade.Observatory
	}
	return json.MarshalIndent(doc, "", "  ")
}

// userInboundProtocol picks the Xray-core inbound protocol for the user-
// facing endpoint based on the configured subprotocol. Both protocols share
// the REALITY streamSettings stack and the api/stats infrastructure — only
// the inbound `protocol` and the `clients` element shape differ.
func userInboundProtocol(cfg InboundConfig) string {
	switch cfg.Subprotocol {
	case "trojan":
		return "trojan"
	case "vmess":
		return "vmess"
	default:
		return "vless"
	}
}

// buildUserInboundSettings produces the inbound's `settings` block. VLESS
// expects `{clients: [{id, email, flow}], decryption: "none"}`; Trojan
// expects `{clients: [{password, email}]}` (Trojan defines no flow and no
// payload encryption beyond TLS). Slice 24c part 3.
//
// We reuse `xrayClient.ID` as the Trojan password — UUIDs have plenty of
// entropy and the user already has one (`user.xrayUuid`) tracked by the
// panel, so we don't grow the credential surface.
func buildUserInboundSettings(cfg InboundConfig, users []xrayClient) map[string]any {
	if cfg.Subprotocol == "trojan" {
		clients := make([]map[string]any, 0, len(users))
		for _, u := range users {
			clients = append(clients, map[string]any{
				"password": u.ID,
				"email":    u.Email,
			})
		}
		return map[string]any{
			"clients": clients,
		}
	}
	if cfg.Subprotocol == "vmess" {
		// VMess: per-user UUID, AEAD (alterId omitted = 0). No Vision flow and
		// no `decryption` field (VMess negotiates its own cipher via `scy` on
		// the client side).
		clients := make([]map[string]any, 0, len(users))
		for _, u := range users {
			clients = append(clients, map[string]any{
				"id":    u.ID,
				"email": u.Email,
			})
		}
		return map[string]any{
			"clients": clients,
		}
	}
	// VLESS — default
	return map[string]any{
		"clients":    users,
		"decryption": "none",
	}
}

// splitPEMLines turns a PEM blob into the line array xray's tlsSettings
// `certificate`/`key` fields expect. Trims surrounding whitespace and
// normalises CRLF so a pasted cert renders cleanly.
func splitPEMLines(pem string) []string {
	clean := strings.ReplaceAll(strings.TrimSpace(pem), "\r\n", "\n")
	return strings.Split(clean, "\n")
}

// buildStreamSettings selects the right Xray streamSettings shape for the
// configured network transport. REALITY+Vision canonical is `raw`; other
// transports are slice 24c part 2 additions.
func buildStreamSettings(cfg InboundConfig) map[string]any {
	network := cfg.Network
	if network == "" {
		network = "raw"
	}
	path := cfg.Path
	if path == "" {
		path = "/"
	}

	security := "reality"
	switch cfg.Security {
	case "none":
		security = "none"
	case "tls":
		security = "tls"
	}
	stream := map[string]any{
		"network":  network,
		"security": security,
	}
	// REALITY material is emitted only for the reality security layer; "none"
	// is a plain transport (the TLS, if any, is terminated by a fronting CDN).
	if security == "reality" {
		realitySettings := map[string]any{
			"show":        false,
			"dest":        cfg.RealityDest,
			"xver":        cfg.RealityXver,
			"serverNames": cfg.RealityServerNames,
			"privateKey":  cfg.RealityPrivateKey,
			"shortIds":    cfg.RealityShortIDs,
		}
		// B3: only emit maxTimeDiff when set, so the default (0) render stays
		// byte-identical to pre-B3 configs.
		if cfg.RealityMaxTimeDiff > 0 {
			realitySettings["maxTimeDiff"] = cfg.RealityMaxTimeDiff
		}
		// G: throttle unverified fallback (probe) connections. Emitted only when
		// set, so the default (0) render stays byte-identical to pre-G configs.
		if cfg.RealityLimitFallbackUploadBytesPerSec > 0 {
			realitySettings["limitFallbackUpload"] = map[string]any{
				"afterBytes":       0,
				"bytesPerSec":      cfg.RealityLimitFallbackUploadBytesPerSec,
				"burstBytesPerSec": cfg.RealityLimitFallbackUploadBytesPerSec,
			}
		}
		if cfg.RealityLimitFallbackDownloadBytesPerSec > 0 {
			realitySettings["limitFallbackDownload"] = map[string]any{
				"afterBytes":       0,
				"bytesPerSec":      cfg.RealityLimitFallbackDownloadBytesPerSec,
				"burstBytesPerSec": cfg.RealityLimitFallbackDownloadBytesPerSec,
			}
		}
		stream["realitySettings"] = realitySettings
	}
	// TLS terminates on the node with the operator-supplied cert, embedded
	// inline (no ACME). xray accepts `certificate`/`key` as string arrays.
	if security == "tls" {
		tls := map[string]any{
			"certificates": []map[string]any{
				{
					"certificate": splitPEMLines(cfg.TLSCert),
					"key":         splitPEMLines(cfg.TLSKey),
				},
			},
		}
		if cfg.TLSServerName != "" {
			tls["serverName"] = cfg.TLSServerName
		}
		// B3: harden against SNI probing. Off by default; omitting the field
		// keeps pre-B3 configs byte-identical.
		if cfg.TLSRejectUnknownSni {
			tls["rejectUnknownSni"] = true
		}
		stream["tlsSettings"] = tls
	}

	switch network {
	case "raw", "":
		// nothing extra — REALITY+Vision canonical
	case "ws":
		ws := map[string]any{"path": path}
		if cfg.HostHeader != "" {
			ws["headers"] = map[string]any{"Host": cfg.HostHeader}
		}
		stream["wsSettings"] = ws
	case "xhttp":
		// B3: mode from the panel; empty falls back to "auto" so pre-B3 configs
		// render identically.
		mode := cfg.XhttpMode
		if mode == "" {
			mode = "auto"
		}
		xh := map[string]any{"path": path, "mode": mode}
		if cfg.HostHeader != "" {
			xh["host"] = cfg.HostHeader
		}
		// B3: request padding blurs the packet-size signature under DPI. Empty
		// (default) omits `extra`, keeping the render byte-stable.
		if cfg.XhttpPaddingBytes != "" {
			xh["extra"] = map[string]any{"xPaddingBytes": cfg.XhttpPaddingBytes}
		}
		stream["xhttpSettings"] = xh
	case "httpupgrade":
		hu := map[string]any{"path": path}
		if cfg.HostHeader != "" {
			hu["host"] = cfg.HostHeader
		}
		stream["httpupgradeSettings"] = hu
	case "grpc":
		stream["grpcSettings"] = map[string]any{
			"serviceName": cfg.ServiceName,
			// B3: multiMode from the panel; default false matches pre-B3 render.
			"multiMode": cfg.GrpcMultiMode,
		}
	case "kcp":
		// mKCP is UDP-based; collides with Hysteria on the same UDP port —
		// the panel-side schema validation should reject overlap when
		// creating an inbound on a node that already has a Hysteria inbound
		// using the same port. We don't enforce that here (one node →
		// possibly multiple adapters → cross-adapter awareness lives on
		// the panel side).
		stream["kcpSettings"] = map[string]any{
			"mtu":              1350,
			"tti":              50,
			"uplinkCapacity":   100,
			"downlinkCapacity": 100,
			"congestion":       false,
			"readBufferSize":   2,
			"writeBufferSize":  2,
			"header":           map[string]any{"type": "none"},
		}
	}
	return stream
}

// buildWarpOutbound renders the Cloudflare WARP wireguard outbound (tag "warp").
// PublicKey/Endpoint/MTU fall back to Cloudflare's well-known defaults; reserved
// (the account client_id, 3 bytes) is emitted only when present - required in
// some regions, harmless elsewhere. Per docs/studies/STUDY-warp-native.md.
func buildWarpOutbound(w *WarpConfig) map[string]any {
	pub := w.PublicKey
	if pub == "" {
		pub = warpDefaultPublicKey
	}
	endpoint := w.Endpoint
	if endpoint == "" {
		endpoint = warpDefaultEndpoint
	}
	mtu := w.MTU
	if mtu == 0 {
		mtu = warpDefaultMTU
	}
	settings := map[string]any{
		"secretKey": w.SecretKey,
		"address":   w.Address,
		"peers": []map[string]any{{
			"publicKey":  pub,
			"allowedIPs": []string{"0.0.0.0/0", "::/0"},
			"endpoint":   endpoint,
		}},
		"mtu": mtu,
	}
	if len(w.Reserved) == 3 {
		settings["reserved"] = w.Reserved
	}
	return map[string]any{
		"protocol": "wireguard",
		"tag":      "warp",
		"settings": settings,
	}
}

// writeConfig atomically writes the config to disk via the shared
// atomicfile helper (fsync(file)+fsync(dir)). xray never sees a
// half-written config even if Restart races the writer or the box
// power-cycles right after the rename.
func writeConfig(path string, blob []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	return atomicfile.Write(path, blob, 0o600)
}
