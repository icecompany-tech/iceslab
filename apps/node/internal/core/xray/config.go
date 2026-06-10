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

	// Security is the stream security layer: "reality" (default / empty) or
	// "none" (plain transport, e.g. ws/httpupgrade behind a CDN that terminates
	// TLS, or local testing). When "none", the Reality* fields are not required
	// and no realitySettings are emitted.
	Security string
}

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
	return out
}

func (c *InboundConfig) validate() error {
	// security="none" is a plain transport (CDN-fronted ws/httpupgrade or local
	// testing) with no REALITY material to validate.
	if c.Security == "none" {
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

// renderConfig produces a complete Xray config.json blob for the given users.
// Marshaled as indented JSON for human-readability when an operator needs to
// inspect what the adapter wrote.
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
	if err := inbound.validate(); err != nil {
		return nil, err
	}
	cfg := inbound.withDefaults()
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
		"inbounds": []map[string]any{
			{
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
			{
				"tag":      "api-in",
				"listen":   "127.0.0.1",
				"port":     cfg.ApiPort,
				"protocol": "dokodemo-door",
				"settings": map[string]any{
					"address": "127.0.0.1",
				},
			},
		},
		// Outbounds — slice 24c part 2:
		//   - `direct` (freedom): default exit
		//   - `dns-out`: DNS server outbound — routing rule below pins all
		//     `protocol: dns` traffic here so client DNS queries don't leak
		//     out via `direct` and reveal real destinations to the resolver
		//   - `blocked` (blackhole): drop target for BLOCK rules
		"outbounds": []map[string]any{
			{
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
			{"protocol": "dns", "tag": "dns-out"},
			{"protocol": "blackhole", "tag": "blocked"},
		},
		"routing": map[string]any{
			"domainStrategy": "IPIfNonMatch",
			"rules": []map[string]any{
				// Loopback management: api inbound traffic only ever talks
				// to the api outbound (the StatsService).
				{
					"type":        "field",
					"inboundTag":  []string{"api-in"},
					"outboundTag": "api",
				},
				// DNS hijack protection — route all DNS-protocol traffic to
				// the dns-out outbound so the upstream resolver can't see the
				// client's real IP.
				{
					"type":        "field",
					"protocol":    []string{"dns"},
					"outboundTag": "dns-out",
				},
				// BLOCK rules — slice 24c part 2 anti-abuse:
				//   - BitTorrent: most VPS providers' AUP forbids it; one
				//     subscriber's torrenting can get the whole node nuked.
				//   - SMTP (port 25): outbound mail abuse / spam — providers
				//     blacklist the IP within hours.
				{
					"type":        "field",
					"protocol":    []string{"bittorrent"},
					"outboundTag": "blocked",
				},
				{
					"type":        "field",
					"port":        "25",
					"outboundTag": "blocked",
				},
			},
		},
	}
	return json.MarshalIndent(doc, "", "  ")
}

// userInboundProtocol picks the Xray-core inbound protocol for the user-
// facing endpoint based on the configured subprotocol. Both protocols share
// the REALITY streamSettings stack and the api/stats infrastructure — only
// the inbound `protocol` and the `clients` element shape differ.
func userInboundProtocol(cfg InboundConfig) string {
	if cfg.Subprotocol == "trojan" {
		return "trojan"
	}
	return "vless"
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
	// VLESS — default
	return map[string]any{
		"clients":    users,
		"decryption": "none",
	}
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
	if cfg.Security == "none" {
		security = "none"
	}
	stream := map[string]any{
		"network":  network,
		"security": security,
	}
	// REALITY material is emitted only for the reality security layer; "none"
	// is a plain transport (the TLS, if any, is terminated by a fronting CDN).
	if security == "reality" {
		stream["realitySettings"] = map[string]any{
			"show":        false,
			"dest":        cfg.RealityDest,
			"xver":        0,
			"serverNames": cfg.RealityServerNames,
			"privateKey":  cfg.RealityPrivateKey,
			"shortIds":    cfg.RealityShortIDs,
		}
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
		xh := map[string]any{"path": path, "mode": "auto"}
		if cfg.HostHeader != "" {
			xh["host"] = cfg.HostHeader
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
			"multiMode":   false,
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
