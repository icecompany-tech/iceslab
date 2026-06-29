package singbox

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
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

func TestRenderAnytlsConfig(t *testing.T) {
	users := map[string]userEntry{"u1": {Password: "pw1"}}
	blob, err := renderAnytlsConfig("c", "k", "", InboundConfig{ListenPort: 8443, ServerName: "www.bing.com"}, users)
	if err != nil {
		t.Fatalf("renderAnytlsConfig: %v", err)
	}
	var cfg sbConfig
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatal(err)
	}
	in := cfg.Inbounds[0]
	if in.Type != "anytls" {
		t.Errorf("type = %q, want anytls", in.Type)
	}
	if in.ListenPort != 8443 {
		t.Errorf("listen_port = %d, want 8443", in.ListenPort)
	}
	if in.CongestionControl != "" {
		t.Errorf("anytls must not emit congestion_control, got %q", in.CongestionControl)
	}
	if !in.TLS.Enabled || in.TLS.ServerName != "www.bing.com" {
		t.Errorf("tls = %+v", in.TLS)
	}
	// AnyTLS is password-only: a user has a password and NO uuid.
	if len(in.Users) != 1 || in.Users[0].Password != "pw1" || in.Users[0].UUID != "" {
		t.Errorf("users = %+v (want password-only, no uuid)", in.Users)
	}
	// The raw JSON must not carry a uuid key for anytls users.
	if strings.Contains(string(blob), `"uuid"`) {
		t.Error("anytls config should not contain a uuid field")
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

func TestRenderXrayFamilyConfigVless(t *testing.T) {
	users := map[string]userEntry{"u1": {UUID: "uuid-1", Password: "uuid-1"}}
	blob, err := renderXrayFamilyConfig("127.0.0.1:8084", InboundConfig{
		ListenPort:         443,
		Subprotocol:        "vless",
		RealityDest:        "www.cloudflare.com:443",
		RealityServerName:  "www.cloudflare.com",
		RealityPrivateKey:  "PRIVKEY",
		RealityShortIDsCSV: "0123abcd,ff",
		RealityMaxTimeDiff: 60000,
		Flow:               "xtls-rprx-vision",
	}, users)
	if err != nil {
		t.Fatalf("renderXrayFamilyConfig: %v", err)
	}
	var cfg sbConfig
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatal(err)
	}
	in := cfg.Inbounds[0]
	if in.Type != "vless" {
		t.Errorf("type = %q, want vless", in.Type)
	}
	if !in.TLS.Enabled || in.TLS.Reality == nil || !in.TLS.Reality.Enabled {
		t.Fatalf("reality not enabled: %+v", in.TLS)
	}
	if in.TLS.ServerName != "www.cloudflare.com" {
		t.Errorf("server_name = %q", in.TLS.ServerName)
	}
	if in.TLS.Reality.Handshake.Server != "www.cloudflare.com" || in.TLS.Reality.Handshake.ServerPort != 443 {
		t.Errorf("handshake = %+v, want www.cloudflare.com:443", in.TLS.Reality.Handshake)
	}
	if in.TLS.Reality.PrivateKey != "PRIVKEY" {
		t.Errorf("private_key = %q", in.TLS.Reality.PrivateKey)
	}
	if len(in.TLS.Reality.ShortID) != 2 || in.TLS.Reality.ShortID[0] != "0123abcd" {
		t.Errorf("short_id = %v, want [0123abcd ff]", in.TLS.Reality.ShortID)
	}
	if in.TLS.Reality.MaxTimeDifference != "60000ms" {
		t.Errorf("max_time_difference = %q, want 60000ms", in.TLS.Reality.MaxTimeDifference)
	}
	if len(in.Users) != 1 || in.Users[0].UUID != "uuid-1" || in.Users[0].Flow != "xtls-rprx-vision" {
		t.Errorf("users = %+v (want uuid-1 + vision flow)", in.Users)
	}
	if in.Users[0].Password != "" || in.Users[0].AlterID != nil {
		t.Errorf("vless user should carry no password/alterId: %+v", in.Users[0])
	}
}

func TestRenderXrayFamilyConfigVmessTrojan(t *testing.T) {
	base := InboundConfig{
		ListenPort:         443,
		RealityDest:        "a.example:443",
		RealityServerName:  "a.example",
		RealityPrivateKey:  "k",
		RealityShortIDsCSV: "ab",
	}

	// vmess: uuid + alterId 0, no flow.
	bv := base
	bv.Subprotocol = "vmess"
	blobV, err := renderXrayFamilyConfig("", bv, map[string]userEntry{"u1": {UUID: "uuid-1"}})
	if err != nil {
		t.Fatalf("vmess render: %v", err)
	}
	var cv sbConfig
	if err := json.Unmarshal(blobV, &cv); err != nil {
		t.Fatal(err)
	}
	if cv.Inbounds[0].Type != "vmess" {
		t.Errorf("type = %q, want vmess", cv.Inbounds[0].Type)
	}
	uv := cv.Inbounds[0].Users[0]
	if uv.UUID != "uuid-1" || uv.AlterID == nil || *uv.AlterID != 0 {
		t.Errorf("vmess user = %+v, want uuid + alterId 0", uv)
	}
	if uv.Flow != "" {
		t.Errorf("vmess user must have no flow, got %q", uv.Flow)
	}

	// trojan: password (no uuid).
	bt := base
	bt.Subprotocol = "trojan"
	blobT, err := renderXrayFamilyConfig("", bt, map[string]userEntry{"u1": {Password: "pw"}})
	if err != nil {
		t.Fatalf("trojan render: %v", err)
	}
	var ct sbConfig
	if err := json.Unmarshal(blobT, &ct); err != nil {
		t.Fatal(err)
	}
	if ct.Inbounds[0].Type != "trojan" {
		t.Errorf("type = %q, want trojan", ct.Inbounds[0].Type)
	}
	ut := ct.Inbounds[0].Users[0]
	if ut.Password != "pw" || ut.UUID != "" {
		t.Errorf("trojan user = %+v, want password-only", ut)
	}
}

func TestRenderHysteria2Config(t *testing.T) {
	users := map[string]userEntry{"u1": {Password: "hp1"}}
	blob, err := renderHysteria2Config("/c.pem", "/k.pem", "127.0.0.1:8085", InboundConfig{
		ListenPort:     443,
		ObfsPassword:   "obfs-secret",
		MasqueradeURL:  "https://www.bing.com",
		BrutalUpMbps:   100,
		BrutalDownMbps: 200,
	}, users)
	if err != nil {
		t.Fatalf("renderHysteria2Config: %v", err)
	}
	var cfg sbConfig
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatal(err)
	}
	in := cfg.Inbounds[0]
	if in.Type != "hysteria2" {
		t.Errorf("type = %q, want hysteria2", in.Type)
	}
	if !in.TLS.Enabled || in.TLS.CertificatePath != "/c.pem" || in.TLS.KeyPath != "/k.pem" {
		t.Errorf("tls = %+v", in.TLS)
	}
	if !in.IgnoreClientBandwidth {
		t.Error("ignore_client_bandwidth should be true")
	}
	if in.UpMbps != 100 || in.DownMbps != 200 {
		t.Errorf("bandwidth = %d/%d, want 100/200", in.UpMbps, in.DownMbps)
	}
	if in.Obfs == nil || in.Obfs.Type != "salamander" || in.Obfs.Password != "obfs-secret" {
		t.Errorf("obfs = %+v", in.Obfs)
	}
	if in.Masquerade != "https://www.bing.com" {
		t.Errorf("masquerade = %q", in.Masquerade)
	}
	if len(in.Users) != 1 || in.Users[0].Name != "u1" || in.Users[0].Password != "hp1" {
		t.Errorf("users = %+v", in.Users)
	}

	// No obfs/masquerade -> those fields are omitted.
	blob2, err := renderHysteria2Config("/c", "/k", "", InboundConfig{ListenPort: 443}, users)
	if err != nil {
		t.Fatalf("renderHysteria2Config (minimal): %v", err)
	}
	var cfg2 sbConfig
	if err := json.Unmarshal(blob2, &cfg2); err != nil {
		t.Fatal(err)
	}
	if cfg2.Inbounds[0].Obfs != nil {
		t.Error("obfs should be nil when no password")
	}
	if cfg2.Inbounds[0].Masquerade != "" {
		t.Error("masquerade should be empty when no url")
	}
}

func TestRenderShadowsocksConfig(t *testing.T) {
	users := map[string]userEntry{"u1": {Password: "uuid-1"}}
	const method = "2022-blake3-aes-256-gcm"
	blob, err := renderShadowsocksConfig("127.0.0.1:8086", InboundConfig{
		ListenPort: 8388,
		Method:     method,
		ServerPSK:  "SERVER-PSK",
	}, users)
	if err != nil {
		t.Fatalf("renderShadowsocksConfig: %v", err)
	}
	var cfg sbConfig
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatal(err)
	}
	in := cfg.Inbounds[0]
	if in.Type != "shadowsocks" {
		t.Errorf("type = %q, want shadowsocks", in.Type)
	}
	if in.Method != method {
		t.Errorf("method = %q, want %q", in.Method, method)
	}
	if in.Password != "SERVER-PSK" {
		t.Errorf("server password = %q, want SERVER-PSK", in.Password)
	}
	if in.TLS != nil {
		t.Error("shadowsocks inbound must not carry a tls block")
	}
	want := core.DeriveSsPassword("uuid-1", method)
	if len(in.Users) != 1 || in.Users[0].Name != "u1" || in.Users[0].Password != want {
		t.Errorf("users = %+v, want derived uPSK %q", in.Users, want)
	}
	// The derived uPSK must NOT be the raw UUID (that was the SS2022 bug).
	if in.Users[0].Password == "uuid-1" {
		t.Error("user PSK must be derived, not the raw UUID")
	}
	// The raw JSON must not carry a "tls" key.
	if strings.Contains(string(blob), `"tls"`) {
		t.Error("shadowsocks config should not contain a tls field")
	}
}

func TestRenderShadowtlsConfig(t *testing.T) {
	users := map[string]userEntry{"u1": {Password: "stpw1"}}
	blob, err := renderShadowtlsConfig("127.0.0.1:8087", InboundConfig{
		ListenPort:         443,
		ShadowtlsHandshake: "www.microsoft.com:443",
		Method:             "2022-blake3-aes-128-gcm",
		ServerPSK:          "INNER-SS-KEY",
	}, users)
	if err != nil {
		t.Fatalf("renderShadowtlsConfig: %v", err)
	}
	// ShadowTLS does raw TLS camouflage - there is no tls block anywhere.
	if strings.Contains(string(blob), `"tls":`) {
		t.Error("shadowtls config should not contain a tls block")
	}

	var doc struct {
		Inbounds []struct {
			Type       string `json:"type"`
			Tag        string `json:"tag"`
			ListenPort int    `json:"listen_port"`
			Version    int    `json:"version"`
			Detour     string `json:"detour"`
			StrictMode bool   `json:"strict_mode"`
			Method     string `json:"method"`
			Password   string `json:"password"`
			Network    string `json:"network"`
			Users      []struct {
				Name     string `json:"name"`
				Password string `json:"password"`
			} `json:"users"`
			Handshake *struct {
				Server     string `json:"server"`
				ServerPort int    `json:"server_port"`
			} `json:"handshake"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(blob, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Inbounds) != 2 {
		t.Fatalf("want 2 inbounds (shadowtls + inner ss), got %d", len(doc.Inbounds))
	}

	st := doc.Inbounds[0]
	if st.Type != "shadowtls" || st.Version != 3 || st.Detour != "shadowtls-ss-in" || !st.StrictMode {
		t.Errorf("shadowtls inbound = %+v", st)
	}
	if st.ListenPort != 443 {
		t.Errorf("shadowtls listen_port = %d, want 443", st.ListenPort)
	}
	if st.Handshake == nil || st.Handshake.Server != "www.microsoft.com" || st.Handshake.ServerPort != 443 {
		t.Errorf("handshake = %+v, want www.microsoft.com:443", st.Handshake)
	}
	if len(st.Users) != 1 || st.Users[0].Name != "u1" || st.Users[0].Password != "stpw1" {
		t.Errorf("shadowtls users = %+v", st.Users)
	}

	ss := doc.Inbounds[1]
	if ss.Type != "shadowsocks" || ss.Tag != "shadowtls-ss-in" || ss.Network != "tcp" {
		t.Errorf("inner ss inbound = %+v", ss)
	}
	if ss.Method != "2022-blake3-aes-128-gcm" || ss.Password != "INNER-SS-KEY" {
		t.Errorf("inner ss method/password = %q/%q", ss.Method, ss.Password)
	}
	// Inner ss is single-key (no users[]) and reached only via detour (no port).
	if len(ss.Users) != 0 {
		t.Errorf("inner ss must be single-key (no users[]), got %+v", ss.Users)
	}
	if ss.ListenPort != 0 {
		t.Errorf("inner ss should omit listen_port, got %d", ss.ListenPort)
	}
}
