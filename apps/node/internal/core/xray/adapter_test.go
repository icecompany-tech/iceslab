package xray

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

func newTestAdapter(t *testing.T) (*Adapter, string) {
	t.Helper()
	configPath := filepath.Join(t.TempDir(), "config.json")
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{
		ConfigPath: configPath,
		Inbound:    validInbound(),
	}, logger)
	return a, configPath
}

func TestNameMatchesProtocol(t *testing.T) {
	a, _ := newTestAdapter(t)
	if a.Name() != Name {
		t.Errorf("Name: got %q want %q", a.Name(), Name)
	}
}

func TestStartWritesConfigInConfigOnlyMode(t *testing.T) {
	a, path := newTestAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("config file should exist after Start, got: %v", err)
	}
}

func TestAddUserSkipsWhenNoXrayUUID(t *testing.T) {
	a, _ := newTestAdapter(t)
	_ = a.Start(context.Background())

	if err := a.AddUser(core.User{UserID: "u-1", HysteriaPassword: "x"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 0 {
		t.Errorf("user without XrayUUID should not be tracked, got %d", len(stats.Users))
	}
}

func TestAddUserStoresAndPersists(t *testing.T) {
	a, path := newTestAdapter(t)
	_ = a.Start(context.Background())

	if err := a.AddUser(core.User{
		UserID:   "alice",
		XrayUUID: "00000000-0000-0000-0000-000000000001",
	}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	stats, _ := a.GetStats()
	if len(stats.Users) != 1 || stats.Users[0].UserID != "alice" {
		t.Errorf("expected tracked user 'alice', got %+v", stats.Users)
	}

	// Config on disk reflects the new client.
	blob, _ := os.ReadFile(path)
	if !contains(blob, "00000000-0000-0000-0000-000000000001") {
		t.Errorf("config did not include user UUID, got: %s", string(blob))
	}
	if !contains(blob, `"email": "alice"`) {
		t.Errorf("config did not include user email, got: %s", string(blob))
	}
}

func TestAddUserIsIdempotent(t *testing.T) {
	a, path := newTestAdapter(t)
	_ = a.Start(context.Background())
	user := core.User{UserID: "u", XrayUUID: "uuid"}
	_ = a.AddUser(user)

	// Capture mtime, then re-add: file should NOT be rewritten (no-op).
	before, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	_ = a.AddUser(user)
	after, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if !after.ModTime().Equal(before.ModTime()) {
		t.Errorf("idempotent AddUser should not rewrite config; mtime changed")
	}

	stats, _ := a.GetStats()
	if len(stats.Users) != 1 {
		t.Errorf("expected 1 user, got %d", len(stats.Users))
	}
}

func TestAddUserUUIDRotationRewritesConfig(t *testing.T) {
	a, path := newTestAdapter(t)
	_ = a.Start(context.Background())
	_ = a.AddUser(core.User{UserID: "u", XrayUUID: "old-uuid"})
	_ = a.AddUser(core.User{UserID: "u", XrayUUID: "new-uuid"})

	blob, _ := os.ReadFile(path)
	if contains(blob, "old-uuid") {
		t.Errorf("old UUID still present after rotation")
	}
	if !contains(blob, "new-uuid") {
		t.Errorf("new UUID missing after rotation")
	}
}

func TestRemoveUserDropsUser(t *testing.T) {
	a, path := newTestAdapter(t)
	_ = a.Start(context.Background())
	_ = a.AddUser(core.User{UserID: "alice", XrayUUID: "uuid"})

	if err := a.RemoveUser("alice"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 0 {
		t.Errorf("expected 0 users after RemoveUser, got %d", len(stats.Users))
	}
	blob, _ := os.ReadFile(path)
	if contains(blob, "uuid") {
		t.Errorf("UUID still in config after RemoveUser")
	}
}

func TestRemoveUserIsIdempotent(t *testing.T) {
	a, _ := newTestAdapter(t)
	_ = a.Start(context.Background())
	if err := a.RemoveUser("never-added"); err != nil {
		t.Errorf("RemoveUser of unknown user should be no-op, got %v", err)
	}
}

func TestHealthyConfigOnlyMode(t *testing.T) {
	a, _ := newTestAdapter(t)
	if a.Healthy() {
		t.Errorf("expected unhealthy before Start")
	}
	_ = a.Start(context.Background())
	if !a.Healthy() {
		t.Errorf("expected healthy after Start in config-only mode")
	}
}

// Wave-14 C1 regression: panel-pushed port lands in xray's REALITY listen
// port. Pre-wave the `port` arg was discarded with `_ = port` and admin
// port changes from the UI were silently dropped. Fallback: panel=0 →
// install-time ListenPort.
func TestApplyInbound_PortChangeRegenerates(t *testing.T) {
	a, _ := newTestAdapter(t)
	body, _ := json.Marshal(map[string]any{
		"realityDest":        "www.cloudflare.com:443",
		"realityServerNames": []string{"www.cloudflare.com"},
		"realityPrivateKey":  "fake-private-key-for-testing",
		"realityShortIds":    []string{"abc123"},
	})
	if err := a.ApplyInbound(8443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.cfg.Inbound.ListenPort != 8443 {
		t.Errorf("ListenPort not updated, got %d want 8443", a.cfg.Inbound.ListenPort)
	}
}

func TestApplyInbound_PortZeroFallsBackToInstallTime(t *testing.T) {
	a, _ := newTestAdapter(t)
	// Pre-seed install-time port (validInbound returns ListenPort=0; we
	// simulate the post-install state where install-iceslab-node.sh wrote
	// the env var that landed here).
	a.cfg.Inbound.ListenPort = 11111
	body, _ := json.Marshal(map[string]any{
		"realityDest":        "www.cloudflare.com:443",
		"realityServerNames": []string{"www.cloudflare.com"},
		"realityPrivateKey":  "fake-private-key-for-testing",
		"realityShortIds":    []string{"abc123"},
	})
	if err := a.ApplyInbound(0, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.cfg.Inbound.ListenPort != 11111 {
		t.Errorf("port=0 should fall back to install-time 11111, got %d", a.cfg.Inbound.ListenPort)
	}
}

func TestSortedClientsDeterministic(t *testing.T) {
	users := map[string]xrayClient{
		"c": {Email: "c"},
		"a": {Email: "a"},
		"b": {Email: "b"},
	}
	got := sortedClients(users)
	want := []string{"a", "b", "c"}
	for i, c := range got {
		if c.Email != want[i] {
			t.Errorf("sortedClients[%d]: got %s want %s", i, c.Email, want[i])
		}
	}
}

// helper used by tests above
func contains(haystack []byte, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	if len(haystack) < len(needle) {
		return false
	}
	for i := 0; i <= len(haystack)-len(needle); i++ {
		if string(haystack[i:i+len(needle)]) == needle {
			return true
		}
	}
	return false
}

// silence unused "json" warning if config_test.go doesn't import it elsewhere
var _ = json.Marshal
