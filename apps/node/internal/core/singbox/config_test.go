package singbox

import (
	"encoding/json"
	"testing"
)

func TestRenderConfigTuic(t *testing.T) {
	users := map[string]userEntry{
		"u2": {UUID: "uuid-2", Password: "pw2", Username: "bob"},
		"u1": {UUID: "uuid-1", Password: "pw1", Username: "alice"},
	}
	blob, err := renderConfig("/etc/sing-box/cert.pem", "/etc/sing-box/key.pem", "",
		InboundConfig{ListenPort: 8443, ServerName: "www.bing.com"}, users)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}

	var cfg sbConfig
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(cfg.Inbounds) != 1 {
		t.Fatalf("want 1 inbound, got %d", len(cfg.Inbounds))
	}
	in := cfg.Inbounds[0]
	if in.Type != "tuic" {
		t.Errorf("type = %q, want tuic", in.Type)
	}
	if in.ListenPort != 8443 {
		t.Errorf("listen_port = %d, want 8443", in.ListenPort)
	}
	if in.CongestionControl != "bbr" {
		t.Errorf("congestion_control = %q, want bbr (default)", in.CongestionControl)
	}
	if !in.TLS.Enabled {
		t.Error("tls.enabled = false, want true (TUIC requires TLS)")
	}
	if in.TLS.ServerName != "www.bing.com" {
		t.Errorf("tls.server_name = %q", in.TLS.ServerName)
	}
	if len(in.TLS.ALPN) != 1 || in.TLS.ALPN[0] != "h3" {
		t.Errorf("tls.alpn = %v, want [h3]", in.TLS.ALPN)
	}
	if in.TLS.CertificatePath != "/etc/sing-box/cert.pem" || in.TLS.KeyPath != "/etc/sing-box/key.pem" {
		t.Errorf("tls cert/key paths = %q %q", in.TLS.CertificatePath, in.TLS.KeyPath)
	}
	if len(in.Users) != 2 {
		t.Fatalf("want 2 users, got %d", len(in.Users))
	}
	// Sorted by userId: u1 before u2.
	if in.Users[0].Name != "u1" || in.Users[0].UUID != "uuid-1" || in.Users[0].Password != "pw1" {
		t.Errorf("users[0] = %+v, want u1/uuid-1/pw1", in.Users[0])
	}
	if in.Users[1].Name != "u2" {
		t.Errorf("users[1].Name = %q, want u2 (sorted)", in.Users[1].Name)
	}
	if len(cfg.Outbounds) != 1 || cfg.Outbounds[0].Type != "direct" {
		t.Errorf("outbounds = %+v, want one direct", cfg.Outbounds)
	}
}

func TestRenderConfigCongestionOverride(t *testing.T) {
	blob, err := renderConfig("c", "k", "", InboundConfig{ListenPort: 443, CongestionControl: "cubic"}, nil)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	var cfg sbConfig
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if cfg.Inbounds[0].CongestionControl != "cubic" {
		t.Errorf("cc = %q, want cubic", cfg.Inbounds[0].CongestionControl)
	}
	// Empty user set must serialize as [] (not null) so sing-box accepts it.
	if cfg.Inbounds[0].Users == nil {
		t.Error("users should be an empty array, not null")
	}
}

func TestRenderConfigStatsBlock(t *testing.T) {
	users := map[string]userEntry{"u1": {UUID: "x", Password: "p"}}

	// No statsListen -> no experimental block.
	blob, err := renderConfig("c", "k", "", InboundConfig{ListenPort: 443}, users)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	var c1 sbConfig
	if err := json.Unmarshal(blob, &c1); err != nil {
		t.Fatal(err)
	}
	if c1.Experimental != nil {
		t.Error("no statsListen should omit the experimental block")
	}

	// With statsListen -> v2ray_api block with the user listed.
	blob, err = renderConfig("c", "k", "127.0.0.1:8082", InboundConfig{ListenPort: 443}, users)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	var c2 sbConfig
	if err := json.Unmarshal(blob, &c2); err != nil {
		t.Fatal(err)
	}
	if c2.Experimental == nil || c2.Experimental.V2RayAPI == nil {
		t.Fatal("statsListen should emit experimental.v2ray_api")
	}
	api := c2.Experimental.V2RayAPI
	if api.Listen != "127.0.0.1:8082" {
		t.Errorf("v2ray_api.listen = %q, want 127.0.0.1:8082", api.Listen)
	}
	if !api.Stats.Enabled {
		t.Error("stats.enabled should be true")
	}
	if len(api.Stats.Users) != 1 || api.Stats.Users[0] != "u1" {
		t.Errorf("stats.users = %v, want [u1]", api.Stats.Users)
	}
}
