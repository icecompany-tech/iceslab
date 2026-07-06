package shadowsocks

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

func validInbound() InboundConfig {
	return InboundConfig{
		ListenPort: 8388,
		Method:     "2022-blake3-aes-256-gcm",
		ServerPSK:  "BASE64-FAKE-32-BYTE-SERVER-PSK==",
		ApiPort:    8081,
	}
}

func TestInboundValidation(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(*InboundConfig)
		wantErr string
	}{
		{"missing method", func(c *InboundConfig) { c.Method = "" }, "Method is required"},
		{"unsupported method", func(c *InboundConfig) { c.Method = "rc4-md5" }, "unsupported"},
		{"missing server PSK", func(c *InboundConfig) { c.ServerPSK = "" }, "ServerPSK is required"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validInbound()
			tc.mutate(&cfg)
			if err := cfg.validate(); err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validate: got %v want error containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestRender_EmitsServerPSK(t *testing.T) {
	// Slice 24d (fix 2026-05-07): xray-core SS2022 multi-user requires
	// `settings.password` (server PSK) at the inbound level alongside
	// per-user `clients[].password`. Anti-regression test.
	m := renderToMap(t, validInbound(), nil)
	for _, raw := range m["inbounds"].([]any) {
		inb := raw.(map[string]any)
		if inb["protocol"] != "shadowsocks" {
			continue
		}
		settings := inb["settings"].(map[string]any)
		if settings["password"] != "BASE64-FAKE-32-BYTE-SERVER-PSK==" {
			t.Errorf("settings.password (server PSK) missing/wrong: %v", settings["password"])
		}
	}
}

func TestInboundDefaults(t *testing.T) {
	cfg := (&InboundConfig{}).withDefaults()
	if cfg.Tag != "ss-in" {
		t.Errorf("Tag default: got %q", cfg.Tag)
	}
	if cfg.ListenHost != "0.0.0.0" {
		t.Errorf("ListenHost default: got %q", cfg.ListenHost)
	}
	if cfg.ListenPort != 8388 {
		t.Errorf("ListenPort default: got %d", cfg.ListenPort)
	}
	if cfg.Method != "2022-blake3-aes-256-gcm" {
		t.Errorf("Method default: got %q", cfg.Method)
	}
	if cfg.ApiPort != 8081 {
		t.Errorf("ApiPort default: got %d (want 8081, one above xray's 8080 to avoid conflict)", cfg.ApiPort)
	}
}

func renderToMap(t *testing.T, cfg InboundConfig, users []ssClient) map[string]any {
	t.Helper()
	blob, err := renderConfig(cfg, users)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(blob, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return m
}

func TestRender_ShadowsocksInboundShape(t *testing.T) {
	users := []ssClient{
		{Password: "pw-a", Email: "user-a"},
		{Password: "pw-b", Email: "user-b"},
	}
	m := renderToMap(t, validInbound(), users)

	inbounds := m["inbounds"].([]any)
	if len(inbounds) != 2 {
		t.Fatalf("expected 2 inbounds (ss + api-in), got %d", len(inbounds))
	}

	var ssInb map[string]any
	for _, raw := range inbounds {
		inb := raw.(map[string]any)
		if inb["protocol"] == "shadowsocks" {
			ssInb = inb
			break
		}
	}
	if ssInb == nil {
		t.Fatalf("ss inbound not found")
	}
	settings := ssInb["settings"].(map[string]any)
	if settings["method"] != "2022-blake3-aes-256-gcm" {
		t.Errorf("method: got %v", settings["method"])
	}
	if settings["network"] != "tcp,udp" {
		t.Errorf("network: got %v want tcp,udp", settings["network"])
	}
	clients := settings["clients"].([]any)
	if len(clients) != 2 {
		t.Errorf("clients: got %d want 2", len(clients))
	}
	c0 := clients[0].(map[string]any)
	// uPSK is derived from the stored UUID (SS2022 needs a valid base64 key, not
	// the raw value) - mirrors core.DeriveSsPassword on the panel + xray paths.
	wantPw := core.DeriveSsPassword("pw-a", "2022-blake3-aes-256-gcm")
	if c0["password"] != wantPw || c0["email"] != "user-a" {
		t.Errorf("client[0] mismatch: %+v (want password %q)", c0, wantPw)
	}
}

func TestRender_StatsWiringPresent(t *testing.T) {
	m := renderToMap(t, validInbound(), nil)
	if _, ok := m["stats"]; !ok {
		t.Errorf("stats block missing")
	}
	if api, ok := m["api"].(map[string]any); !ok || api["tag"] != "api" {
		t.Errorf("api block missing/wrong: %v", m["api"])
	}
	policy := m["policy"].(map[string]any)
	level0 := policy["levels"].(map[string]any)["0"].(map[string]any)
	if level0["statsUserUplink"] != true || level0["statsUserDownlink"] != true {
		t.Errorf("policy.levels.0 missing per-user stats flags")
	}
}

func TestRender_RoutingDefaultsPresent(t *testing.T) {
	m := renderToMap(t, validInbound(), nil)

	// Three outbounds: direct (with sockopt-BBR), dns-out, blocked.
	tags := map[string]bool{}
	for _, raw := range m["outbounds"].([]any) {
		ob := raw.(map[string]any)
		tags[ob["tag"].(string)] = true
		if ob["tag"] == "direct" {
			ss := ob["streamSettings"].(map[string]any)
			sock := ss["sockopt"].(map[string]any)
			if sock["tcpCongestion"] != "bbr" {
				t.Errorf("direct outbound missing tcpCongestion=bbr")
			}
		}
	}
	if !tags["direct"] || !tags["dns-out"] || !tags["blocked"] {
		t.Errorf("missing required outbound tags, got %v", tags)
	}

	// BLOCK rules: bittorrent + port:25
	rules := m["routing"].(map[string]any)["rules"].([]any)
	var btRule, smtpRule bool
	for _, raw := range rules {
		r := raw.(map[string]any)
		if protos, ok := r["protocol"].([]any); ok {
			for _, p := range protos {
				if p == "bittorrent" && r["outboundTag"] == "blocked" {
					btRule = true
				}
			}
		}
		if r["port"] == "25" && r["outboundTag"] == "blocked" {
			smtpRule = true
		}
	}
	if !btRule {
		t.Errorf("missing bittorrent BLOCK rule")
	}
	if !smtpRule {
		t.Errorf("missing port:25 BLOCK rule")
	}
}

func TestRender_ApiInboundOnLoopback(t *testing.T) {
	m := renderToMap(t, validInbound(), nil)
	for _, raw := range m["inbounds"].([]any) {
		inb := raw.(map[string]any)
		if inb["tag"] == "api-in" {
			if inb["listen"] != "127.0.0.1" {
				t.Errorf("api-in MUST listen on 127.0.0.1, got %v", inb["listen"])
			}
			if inb["port"] != float64(8081) {
				t.Errorf("api-in port: got %v want 8081", inb["port"])
			}
			return
		}
	}
	t.Fatalf("api-in inbound not found")
}
