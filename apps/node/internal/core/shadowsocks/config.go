// Package shadowsocks implements CoreAdapter for the Shadowsocks 2022
// protocol via the xray-core binary. Slice 24d.
//
// We share the xray binary with the VLESS/Trojan adapter because xray
// supports SS2022 multi-user out of the box (`protocol: "shadowsocks"`
// inbound + `clients: [{password, email}]`). Running a SECOND xray
// process with just SS config is wasteful but architecturally simpler
// than refactoring XrayAdapter to manage multiple inbound types, and
// Single-Protocol-Per-Node deployment (recommended in ROADMAP) means
// most installs only run one of these adapters anyway.
package shadowsocks

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

// InboundConfig is the static part of the SS inbound, generated once
// from admin settings and kept constant across user mutations.
type InboundConfig struct {
	// Tag uniquely identifies the inbound inside Xray. Default: "ss-in".
	Tag string

	// ListenHost is the bind address. Default: "0.0.0.0".
	ListenHost string

	// ListenPort is the public TCP port the SS server listens on.
	// SS doesn't have a "canonical" port, admins pick whatever doesn't
	// collide with their other inbounds.
	ListenPort int

	// Method is the SS cipher. SS2022 (`2022-blake3-*`) recommended for
	// new deployments, legacy AEAD kept for compat with old clients.
	Method string

	// ServerPSK is xray-core's SS2022 server-level password (the `password`
	// at the `settings.` level, distinct from per-user `clients[].password`).
	// Required for multi-user SS2022, verified against XTLS/Xray-examples
	// on 2026-05-07. An earlier iteration of this file omitted it.
	ServerPSK string

	// ApiPort is the loopback port for the gRPC StatsService inbound.
	// Default: 8081 (one above xray's default to avoid conflict if both
	// adapters run on the same node).
	ApiPort int
}

func (c *InboundConfig) withDefaults() InboundConfig {
	out := *c
	if out.Tag == "" {
		out.Tag = "ss-in"
	}
	if out.ListenHost == "" {
		out.ListenHost = "0.0.0.0"
	}
	if out.ListenPort == 0 {
		out.ListenPort = 8388 // SS historic default
	}
	if out.Method == "" {
		out.Method = "2022-blake3-aes-256-gcm"
	}
	if out.ApiPort == 0 {
		out.ApiPort = 8081
	}
	return out
}

func (c *InboundConfig) validate() error {
	if c.Method == "" {
		return errors.New("Method is required")
	}
	switch c.Method {
	case "2022-blake3-aes-128-gcm",
		"2022-blake3-aes-256-gcm",
		"2022-blake3-chacha20-poly1305",
		"chacha20-ietf-poly1305",
		"aes-256-gcm",
		"aes-128-gcm":
		// ok
	default:
		return fmt.Errorf("unsupported Method %q", c.Method)
	}
	if c.ServerPSK == "" {
		return errors.New("ServerPSK is required (xray SS2022 settings.password)")
	}
	return nil
}

// ssClient mirrors xray's `clients` element for protocol=shadowsocks.
// Per upstream xray-core, SS2022 multi-user requires `password` + `email`
// per client (legacy SS uses inbound-level password, no per-user). We
// always emit the SS2022 shape, clients on legacy ciphers tolerate the
// extra `email` field.
type ssClient struct {
	Password string `json:"password"`
	Email    string `json:"email"`
}

// buildUserInboundSettings produces the SS inbound's `settings` block: the
// cipher, the server-level PSK, the per-user clients, and the relay network.
// Single source of truth for the user shape - both renderConfig (full config)
// and buildAduInbound (live `xray api adu`) call it, so the client shape
// (password / email) can never drift between the two paths. Mirrors xray's
// buildUserInboundSettings reuse.
func buildUserInboundSettings(cfg InboundConfig, users []ssClient) map[string]any {
	// Each client's stored Password is the user's raw xray UUID; derive the
	// real SS2022 uPSK (valid base64 key) from it at render time so the key is
	// method-aware (16 vs 32 bytes). The panel's subscription URI derives the
	// same value (core.DeriveSsPassword), keeping client and server in sync.
	// Pre-fix this emitted the raw UUID, which xray-core/sing-box reject as an
	// invalid PSK length - SS2022 never actually authenticated.
	clients := make([]map[string]any, 0, len(users))
	for _, u := range users {
		clients = append(clients, map[string]any{
			"password": core.DeriveSsPassword(u.Password, cfg.Method),
			"email":    u.Email,
		})
	}
	return map[string]any{
		"method": cfg.Method,
		// Server-level PSK (slice 24d, fix 2026-05-07). xray-core requires this
		// at settings.password for SS2022 multi-user inbounds; clients combine
		// it with per-user PSK as `ServerPSK:UserPSK` in the URI.
		"password": cfg.ServerPSK,
		"clients":  clients,
		"network":  "tcp,udp", // SS2022 supports UDP relay
	}
}

// renderConfig produces an Xray config.json for an SS-only deployment.
// Stats wiring mirrors the xray adapter (see ../xray/config.go), same
// `stats:{}` + `policy.levels.0.statsUserUplink/Downlink` + `api-in`
// dokodemo-door so `xray api statsquery` works.
func renderConfig(inbound InboundConfig, users []ssClient) ([]byte, error) {
	if err := inbound.validate(); err != nil {
		return nil, err
	}
	cfg := inbound.withDefaults()

	doc := map[string]any{
		"log":   map[string]any{"loglevel": "info"},
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
				"tag":      cfg.Tag,
				"listen":   cfg.ListenHost,
				"port":     cfg.ListenPort,
				"protocol": "shadowsocks",
				"settings": buildUserInboundSettings(cfg, users),
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
				"settings": map[string]any{"address": "127.0.0.1"},
			},
		},
		"outbounds": []map[string]any{
			{
				"protocol": "freedom",
				"tag":      "direct",
				"streamSettings": map[string]any{
					"sockopt": map[string]any{
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
				{"type": "field", "inboundTag": []string{"api-in"}, "outboundTag": "api"},
				{"type": "field", "protocol": []string{"dns"}, "outboundTag": "dns-out"},
				{"type": "field", "protocol": []string{"bittorrent"}, "outboundTag": "blocked"},
				{"type": "field", "port": "25", "outboundTag": "blocked"},
			},
		},
	}
	return json.MarshalIndent(doc, "", "  ")
}

// writeConfig atomically writes the config to disk via the shared
// atomicfile helper (fsync(file) + fsync(dir) for power-loss durability).
// Mode 0o600, file contains all SS user passwords. Wave-14 #10: pre-wave
// used a hand-rolled WriteFile+Rename with no fsync, contradicting every
// other adapter's pattern and the atomicfile package's own docstring;
// power-loss after rename could leave a torn config and dark SS users on
// next boot.
func writeConfig(path string, blob []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	return atomicfile.Write(path, blob, 0o600)
}
