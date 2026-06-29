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
