package singbox

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

func testAdapter() *Adapter {
	return New(Config{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestName(t *testing.T) {
	if got := testAdapter().Name(); got != "tuic" {
		t.Errorf("Name() = %q, want tuic", got)
	}
}

func TestAddRemoveUser(t *testing.T) {
	a := testAdapter()
	if err := a.AddUser(core.User{UserID: "u1", TuicUUID: "uuid1", TuicPassword: "pw1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 1 || stats.Users[0].UserID != "u1" {
		t.Fatalf("after AddUser stats = %+v", stats.Users)
	}
	// Re-adding identical credentials is a no-op.
	if err := a.AddUser(core.User{UserID: "u1", TuicUUID: "uuid1", TuicPassword: "pw1"}); err != nil {
		t.Fatalf("re-AddUser: %v", err)
	}
	stats, _ = a.GetStats()
	if len(stats.Users) != 1 {
		t.Fatalf("idempotent add changed count: %+v", stats.Users)
	}
	if err := a.RemoveUser("u1"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	stats, _ = a.GetStats()
	if len(stats.Users) != 0 {
		t.Fatalf("after RemoveUser stats = %+v", stats.Users)
	}
	// Removing an unknown user is a no-op.
	if err := a.RemoveUser("nope"); err != nil {
		t.Fatalf("RemoveUser unknown: %v", err)
	}
}

func TestAddUserNoCredsNoop(t *testing.T) {
	a := testAdapter()
	if err := a.AddUser(core.User{UserID: "u1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if stats, _ := a.GetStats(); len(stats.Users) != 0 {
		t.Errorf("user without TUIC creds should be ignored, got %+v", stats.Users)
	}
}

func TestHealthyConfigOnly(t *testing.T) {
	a := testAdapter()
	if a.Healthy() {
		t.Error("Healthy() before Start should be false")
	}
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !a.Healthy() {
		t.Error("Healthy() after Start (config-only) should be true")
	}
}

func TestGetStatsViaFakeRunCmd(t *testing.T) {
	a := New(Config{
		StatsListen:  "127.0.0.1:8082",
		XrayStatsBin: "/usr/local/bin/xray",
		RunCmd: func(_ context.Context, _ string, _ ...string) ([]byte, error) {
			return []byte(`{"stat":[
				{"name":"user>>>u1>>>traffic>>>uplink","value":"100"},
				{"name":"user>>>u1>>>traffic>>>downlink","value":"200"}
			]}`), nil
		},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := a.AddUser(core.User{UserID: "u1", TuicUUID: "uuid1", TuicPassword: "pw1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	stats, err := a.GetStats()
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}
	if !stats.Cumulative {
		t.Error("Cumulative should be true (non-destructive read)")
	}
	if len(stats.Users) != 1 || stats.Users[0].UserID != "u1" {
		t.Fatalf("stats.Users = %+v", stats.Users)
	}
	if stats.Users[0].BytesIn != 100 || stats.Users[0].BytesOut != 200 {
		t.Errorf("counters = in %d out %d, want 100/200", stats.Users[0].BytesIn, stats.Users[0].BytesOut)
	}
}

func TestAnytlsAdapter(t *testing.T) {
	a := New(Config{Protocol: "anytls"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if a.Name() != "anytls" {
		t.Fatalf("Name() = %q, want anytls", a.Name())
	}
	if err := a.AddUser(core.User{UserID: "u1", AnytlsPassword: "pw1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 1 || stats.Users[0].UserID != "u1" {
		t.Fatalf("stats = %+v", stats.Users)
	}
	// The anytls adapter must ignore a user that only carries TUIC creds.
	if err := a.AddUser(core.User{UserID: "u2", TuicUUID: "x", TuicPassword: "y"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if stats, _ := a.GetStats(); len(stats.Users) != 1 {
		t.Errorf("anytls adapter should ignore tuic-only creds, got %+v", stats.Users)
	}
}

func TestApplyInboundConfigOnly(t *testing.T) {
	a := testAdapter()
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := a.ApplyInbound(8443, json.RawMessage(`{"serverName":"x.example","congestionControl":"bbr"}`)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.inbound.ListenPort != 8443 || a.inbound.ServerName != "x.example" {
		t.Errorf("inbound not stored: %+v", a.inbound)
	}
	// Unchanged re-apply is a no-op.
	if err := a.ApplyInbound(8443, json.RawMessage(`{"serverName":"x.example","congestionControl":"bbr"}`)); err != nil {
		t.Fatalf("re-ApplyInbound: %v", err)
	}
}

func TestXrayFamilyAdapter(t *testing.T) {
	a := New(Config{Protocol: "xray"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if a.Name() != "xray" || a.Engine() != "singbox" {
		t.Fatalf("Name()/Engine() = %q/%q, want xray/singbox", a.Name(), a.Engine())
	}
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	cfg := `{"subprotocol":"vless","flow":"xtls-rprx-vision","realityDest":"www.cloudflare.com:443","realityPrivateKey":"k","realityServerNames":["www.cloudflare.com"],"realityShortIds":["ab"]}`
	if err := a.ApplyInbound(443, json.RawMessage(cfg)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.inbound.Subprotocol != "vless" || a.inbound.RealityServerName != "www.cloudflare.com" {
		t.Errorf("inbound not stored: %+v", a.inbound)
	}
	// AddUser keyed on the xray uuid.
	if err := a.AddUser(core.User{UserID: "u1", XrayUUID: "uuid-1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if stats, _ := a.GetStats(); len(stats.Users) != 1 || stats.Users[0].UserID != "u1" {
		t.Fatalf("stats = %+v", stats.Users)
	}
	// A user with only tuic creds must be ignored by the xray-family adapter.
	if err := a.AddUser(core.User{UserID: "u2", TuicUUID: "x"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if stats, _ := a.GetStats(); len(stats.Users) != 1 {
		t.Errorf("xray-family adapter should ignore tuic-only creds, got %+v", stats.Users)
	}
}

func TestXrayFamilyApplyInboundGuards(t *testing.T) {
	a := New(Config{Protocol: "xray"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	reality := `"realityPrivateKey":"k","realityServerNames":["a.example"],"realityShortIds":["ab"]`
	cases := map[string]string{
		"non-raw transport":   `{"subprotocol":"vless","network":"ws",` + reality + `}`,
		"self-steal":          `{"subprotocol":"vless","realityMode":"self-steal",` + reality + `}`,
		"cascade":             `{"subprotocol":"vless","cascade":{"x":1},` + reality + `}`,
		"tls security":        `{"subprotocol":"vless","security":"tls",` + reality + `}`,
		"bad subprotocol":     `{"subprotocol":"shadowtls",` + reality + `}`,
		"missing reality key": `{"subprotocol":"vless","realityServerNames":["a.example"],"realityShortIds":["ab"]}`,
	}
	for name, cfg := range cases {
		if err := a.ApplyInbound(443, json.RawMessage(cfg)); err == nil {
			t.Errorf("%s: expected ApplyInbound to error, got nil", name)
		}
	}
}

func TestHysteria2Adapter(t *testing.T) {
	a := New(Config{Protocol: "hysteria"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if a.Name() != "hysteria" || a.Engine() != "singbox" {
		t.Fatalf("Name()/Engine() = %q/%q, want hysteria/singbox", a.Name(), a.Engine())
	}
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := a.ApplyInbound(443, json.RawMessage(`{"obfsPassword":"o","brutalUpMbps":50}`)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.inbound.ObfsPassword != "o" || a.inbound.BrutalUpMbps != 50 {
		t.Errorf("inbound not stored: %+v", a.inbound)
	}
	if err := a.AddUser(core.User{UserID: "u1", HysteriaPassword: "hp1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if stats, _ := a.GetStats(); len(stats.Users) != 1 || stats.Users[0].UserID != "u1" {
		t.Fatalf("stats = %+v", stats.Users)
	}
	// A user with only tuic creds must be ignored by the hysteria adapter.
	if err := a.AddUser(core.User{UserID: "u2", TuicUUID: "x"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if stats, _ := a.GetStats(); len(stats.Users) != 1 {
		t.Errorf("hysteria adapter should ignore tuic-only creds, got %+v", stats.Users)
	}
}

func TestShadowsocksAdapter(t *testing.T) {
	a := New(Config{Protocol: "shadowsocks"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if a.Name() != "shadowsocks" || a.Engine() != "singbox" {
		t.Fatalf("Name()/Engine() = %q/%q, want shadowsocks/singbox", a.Name(), a.Engine())
	}
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := a.ApplyInbound(8388, json.RawMessage(`{"method":"2022-blake3-aes-256-gcm","serverPsk":"SPSK"}`)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.inbound.Method != "2022-blake3-aes-256-gcm" || a.inbound.ServerPSK != "SPSK" {
		t.Errorf("inbound not stored: %+v", a.inbound)
	}
	// method/serverPsk are required.
	if err := a.ApplyInbound(8388, json.RawMessage(`{"method":"2022-blake3-aes-256-gcm"}`)); err == nil {
		t.Error("missing serverPsk should error")
	}
	if err := a.AddUser(core.User{UserID: "u1", XrayUUID: "uuid-1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if stats, _ := a.GetStats(); len(stats.Users) != 1 || stats.Users[0].UserID != "u1" {
		t.Fatalf("stats = %+v", stats.Users)
	}
	// A user with only tuic creds must be ignored by the ss adapter.
	if err := a.AddUser(core.User{UserID: "u2", TuicUUID: "x"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if stats, _ := a.GetStats(); len(stats.Users) != 1 {
		t.Errorf("ss adapter should ignore tuic-only creds, got %+v", stats.Users)
	}
}

func TestShadowtlsAdapter(t *testing.T) {
	a := New(Config{Protocol: "shadowtls"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if a.Name() != "shadowtls" || a.Engine() != "singbox" {
		t.Fatalf("Name()/Engine() = %q/%q, want shadowtls/singbox", a.Name(), a.Engine())
	}
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	// handshake + inner ss key are required.
	if err := a.ApplyInbound(443, json.RawMessage(`{"ssPassword":"k"}`)); err == nil {
		t.Error("missing handshake should error")
	}
	if err := a.ApplyInbound(443, json.RawMessage(`{"handshake":"www.microsoft.com:443"}`)); err == nil {
		t.Error("missing ssPassword should error")
	}
	cfg := `{"handshake":"www.microsoft.com:443","ssMethod":"2022-blake3-aes-128-gcm","ssPassword":"INNER-KEY"}`
	if err := a.ApplyInbound(443, json.RawMessage(cfg)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.inbound.ShadowtlsHandshake != "www.microsoft.com:443" || a.inbound.ServerPSK != "INNER-KEY" {
		t.Errorf("inbound not stored: %+v", a.inbound)
	}
	if err := a.AddUser(core.User{UserID: "u1", ShadowtlsPassword: "stpw1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if stats, _ := a.GetStats(); len(stats.Users) != 1 || stats.Users[0].UserID != "u1" {
		t.Fatalf("stats = %+v", stats.Users)
	}
	// A user with only tuic creds must be ignored by the shadowtls adapter.
	if err := a.AddUser(core.User{UserID: "u2", TuicUUID: "x"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if stats, _ := a.GetStats(); len(stats.Users) != 1 {
		t.Errorf("shadowtls adapter should ignore tuic-only creds, got %+v", stats.Users)
	}
}
