package shadowsocks

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

func newConfigOnlyAdapter(t *testing.T) *Adapter {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(Config{
		Inbound: InboundConfig{
			Method:     "2022-blake3-aes-256-gcm",
			ServerPSK:  "BASE64-FAKE-SERVER-PSK==",
			ListenPort: 8388,
			ApiPort:    8081,
		},
		// no BinaryPath, no ConfigPath → config-only mode
	}, logger)
}

func TestNameMatchesProtocol(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if a.Name() != Name {
		t.Errorf("Name: got %q want %q", a.Name(), Name)
	}
}

func TestAddUserStoresClient(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.AddUser(core.User{UserID: "u-1", XrayUUID: "uuid-1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 1 {
		t.Errorf("expected 1 user tracked, got %d", len(stats.Users))
	}
}

func TestAddUserSkipsWhenNoXrayUUID(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.AddUser(core.User{UserID: "u-1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 0 {
		t.Errorf("user without XrayUUID should not be tracked, got %d", len(stats.Users))
	}
}

func TestAddUserIsIdempotent(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	user := core.User{UserID: "u-1", XrayUUID: "uuid-1"}
	_ = a.AddUser(user)
	_ = a.AddUser(user)
	_ = a.AddUser(user)
	stats, _ := a.GetStats()
	if len(stats.Users) != 1 {
		t.Errorf("expected 1 user after 3x AddUser, got %d", len(stats.Users))
	}
}

func TestRemoveUser(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	_ = a.AddUser(core.User{UserID: "u-1", XrayUUID: "uuid-1"})
	if err := a.RemoveUser("u-1"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 0 {
		t.Errorf("user should be cleared after RemoveUser, got %d", len(stats.Users))
	}
}

// ───── ApplyInbound ─────

func TestApplyInbound_NoOpOnIdenticalConfig(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{
		"method":    "2022-blake3-aes-256-gcm",
		"serverPsk": "BASE64-FAKE-SERVER-PSK==",
	})
	// Wave-14 C1: port now participates in idempotency check; pass the
	// install-time port (8388 from newConfigOnlyAdapter) so the apply is
	// truly a no-op vs current state.
	if err := a.ApplyInbound(8388, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.started {
		t.Errorf("config-only adapter should not have started on no-op apply")
	}
}

func TestApplyInbound_MethodChangeRegenerates(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{
		"method":    "chacha20-ietf-poly1305",
		"serverPsk": "BASE64-FAKE-SERVER-PSK==",
	})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.cfg.Inbound.Method != "chacha20-ietf-poly1305" {
		t.Errorf("method not updated, got %q", a.cfg.Inbound.Method)
	}
	if !a.started {
		t.Errorf("started should be true after regenerate")
	}
}

// Wave-14 C1 regression: panel-pushed port change triggers regenerate +
// updates InboundConfig.ListenPort so the next render emits the new port.
func TestApplyInbound_PortChangeRegenerates(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{
		"method":    "2022-blake3-aes-256-gcm",
		"serverPsk": "BASE64-FAKE-SERVER-PSK==",
	})
	// Same method/psk as install-time but different port → not a no-op.
	if err := a.ApplyInbound(9999, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.cfg.Inbound.ListenPort != 9999 {
		t.Errorf("port not updated, got %d want 9999", a.cfg.Inbound.ListenPort)
	}
	if !a.started {
		t.Errorf("started should be true after port-driven regenerate")
	}
}

func TestApplyInbound_RejectsMissingServerPsk(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{"method": "2022-blake3-aes-256-gcm"})
	if err := a.ApplyInbound(443, body); err == nil ||
		!strings.Contains(err.Error(), "serverPsk is required") {
		t.Errorf("expected serverPsk-required error, got %v", err)
	}
}

func TestApplyInbound_RejectsMissingMethod(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{})
	if err := a.ApplyInbound(443, body); err == nil || !strings.Contains(err.Error(), "method is required") {
		t.Errorf("expected method-required error, got %v", err)
	}
}

func TestApplyInbound_RejectsMalformedJSON(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.ApplyInbound(443, []byte("{not json")); err == nil {
		t.Errorf("expected parse error")
	}
}

// ───── Stats query ─────

func TestParseStatName_AcceptsUserTraffic(t *testing.T) {
	uid, dir, ok := parseStatName("user>>>u-1>>>traffic>>>uplink")
	if !ok || uid != "u-1" || dir != "uplink" {
		t.Errorf("got (%q,%q,%v)", uid, dir, ok)
	}
}

func TestParseStatName_RejectsOtherShapes(t *testing.T) {
	for _, in := range []string{
		"inbound>>>x>>>traffic>>>uplink",
		"user>>>u-1>>>other>>>uplink",
		"user>>>u-1>>>traffic",
	} {
		if _, _, ok := parseStatName(in); ok {
			t.Errorf("should reject %q", in)
		}
	}
}

func TestQueryUserStats_AggregatesCounters(t *testing.T) {
	mockOutput := []byte(`{"stat":[
		{"name":"user>>>alice>>>traffic>>>uplink","value":"1000"},
		{"name":"user>>>alice>>>traffic>>>downlink","value":"2000"},
		{"name":"user>>>bob>>>traffic>>>uplink","value":"500"}
	]}`)
	run := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return mockOutput, nil
	}
	got, err := queryUserStats(context.Background(), run, "/usr/local/bin/xray", 8081)
	if err != nil {
		t.Fatalf("queryUserStats: %v", err)
	}
	if got["alice"].UplinkBytes != 1000 || got["alice"].DownlinkBytes != 2000 {
		t.Errorf("alice: %+v", got["alice"])
	}
	if got["bob"].UplinkBytes != 500 {
		t.Errorf("bob: %+v", got["bob"])
	}
}

func TestQueryUserStats_ErrorPropagates(t *testing.T) {
	run := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return []byte("connection refused"), errors.New("exit status 1")
	}
	if _, err := queryUserStats(context.Background(), run, "xray", 8081); err == nil {
		t.Errorf("expected error from failing run")
	}
}

func TestGetStats_SoftFailsToZeroCounters(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	failingRun := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return nil, errors.New("xray not running")
	}
	a := New(Config{
		BinaryPath: "/usr/local/bin/xray",
		Inbound:    InboundConfig{Method: "2022-blake3-aes-256-gcm", ApiPort: 8081},
		RunCmd:     failingRun,
	}, logger)
	_ = a.AddUser(core.User{UserID: "u-1", XrayUUID: "uuid-1"})

	stats, err := a.GetStats()
	if err != nil {
		t.Fatalf("GetStats should soft-fail, got error: %v", err)
	}
	if len(stats.Users) != 1 {
		t.Errorf("user list should still be reported, got %d", len(stats.Users))
	}
	if stats.Users[0].BytesIn != 0 || stats.Users[0].BytesOut != 0 {
		t.Errorf("counters should be zero on stats fail, got %+v", stats.Users[0])
	}
}
