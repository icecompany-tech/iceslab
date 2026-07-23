package mieru

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

type recordingRunner struct {
	mu    sync.Mutex
	calls [][]string
}

func (r *recordingRunner) run(_ context.Context, name string, args ...string) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, append([]string{name}, args...))
	return nil, nil
}

func newConfigOnlyAdapter(t *testing.T) *Adapter {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(Config{
		Inbound: InboundConfig{ListenPort: 2012, MTU: 1400, LoggingLevel: "INFO"},
	}, logger)
}

func TestNameMatchesProtocol(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if a.Name() != Name {
		t.Errorf("Name: got %q want %q", a.Name(), Name)
	}
}

func TestAddUser(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.AddUser(core.User{
		UserID:   "u-1",
		Username: "alice",
		XrayUUID: "uuid-a",
	}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	u := a.users["u-1"]
	if u.Name != "alice" || u.Password != "uuid-a" {
		t.Errorf("user mapping: got %+v", u)
	}
}

func TestAddUserSkipsWithoutUUID(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.AddUser(core.User{UserID: "u-1", Username: "alice"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if len(a.users) != 0 {
		t.Errorf("user without XrayUUID should not be tracked")
	}
}

func TestAddUserSkipsWithoutUsername(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.AddUser(core.User{UserID: "u-1", XrayUUID: "uuid-a"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if len(a.users) != 0 {
		t.Errorf("user without Username should not be tracked (mieru needs name+password)")
	}
}

func TestAddUserIsIdempotent(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	user := core.User{UserID: "u-1", Username: "alice", XrayUUID: "uuid-a"}
	_ = a.AddUser(user)
	_ = a.AddUser(user)
	_ = a.AddUser(user)
	if len(a.users) != 1 {
		t.Errorf("expected 1 user after 3x AddUser, got %d", len(a.users))
	}
}

func TestRemoveUser(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	_ = a.AddUser(core.User{UserID: "u-1", Username: "alice", XrayUUID: "uuid-a"})
	if err := a.RemoveUser("u-1"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	if len(a.users) != 0 {
		t.Errorf("user not removed")
	}
}

func TestApplyInbound_MTUChange(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{"mtu": 1280})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.cfg.Inbound.MTU != 1280 {
		t.Errorf("MTU not updated: got %d", a.cfg.Inbound.MTU)
	}
}

func TestApplyInbound_NoOpOnSameMTU(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{"mtu": 1400})
	// Wave-14 C1: port participates in idempotency. Pass install-time port
	// (2012 from newConfigOnlyAdapter) for true no-op.
	if err := a.ApplyInbound(2012, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.started {
		t.Errorf("same-MTU apply should not have started in config-only mode")
	}
}

// Wave-14 C1 regression: panel-pushed port change triggers reload + updates
// ListenPort so portBindings in the next render carry the new port.
func TestApplyInbound_PortChangeRegenerates(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{"mtu": 1400})
	if err := a.ApplyInbound(9012, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.cfg.Inbound.ListenPort != 9012 {
		t.Errorf("port not updated, got %d want 9012", a.cfg.Inbound.ListenPort)
	}
}

func TestApplyInbound_RejectsMalformedJSON(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.ApplyInbound(443, []byte("{not json")); err == nil {
		t.Errorf("expected parse error")
	}
}

func TestStart_InvokesMitaApplyReloadAndStart(t *testing.T) {
	runner := &recordingRunner{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	dir := t.TempDir()
	a := New(Config{
		BinaryPath: "/usr/local/bin/mita",
		ConfigPath: dir + "/server.yaml",
		StatePath:  dir + "/users.state.json",
		Inbound:    InboundConfig{ListenPort: 2012, MTU: 1400, LoggingLevel: "INFO"},
		RunCmd:     runner.run,
	}, logger)
	if err := a.AddUser(core.User{UserID: "u-1", Username: "alice", XrayUUID: "uuid-a"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// The packaged systemd unit starts only the RPC daemon. `mita start` is
	// still required to move the proxy from IDLE to RUNNING.
	if len(runner.calls) < 3 {
		t.Fatalf("expected at least 3 mita calls, got %d: %v", len(runner.calls), runner.calls)
	}
	first := strings.Join(runner.calls[0], " ")
	if !strings.Contains(first, "apply config") {
		t.Errorf("first call should be `apply config`, got %q", first)
	}
	second := strings.Join(runner.calls[1], " ")
	if !strings.Contains(second, "reload") {
		t.Errorf("second call should be `reload`, got %q", second)
	}
	third := strings.Join(runner.calls[2], " ")
	if !strings.Contains(third, "start") {
		t.Errorf("third call should be `start`, got %q", third)
	}
}

func TestStartWithoutUsersWaitsForFirstUser(t *testing.T) {
	runner := &recordingRunner{}
	dir := t.TempDir()
	a := New(Config{
		BinaryPath: "/usr/local/bin/mita",
		ConfigPath: filepath.Join(dir, "server.json"),
		StatePath:  filepath.Join(dir, "users.state.json"),
		Inbound:    InboundConfig{ListenPort: 2012, MTU: 1400, LoggingLevel: "INFO"},
		RunCmd:     runner.run,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start without users: %v", err)
	}
	if len(runner.calls) != 0 {
		t.Fatalf("empty adapter should wait for panel sync, got calls: %v", runner.calls)
	}
	if !a.Healthy() {
		t.Fatal("adapter should be healthy while waiting for the first user")
	}

	if err := a.AddUser(core.User{UserID: "u-1", Username: "alice", XrayUUID: "uuid-a"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if len(runner.calls) != 3 {
		t.Fatalf("first user should apply, reload, and start mita; got %v", runner.calls)
	}
}

func TestUsersPersistAcrossAdapterRestart(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{
		ConfigPath: filepath.Join(dir, "server.json"),
		StatePath:  filepath.Join(dir, "users.state.json"),
		Inbound:    InboundConfig{ListenPort: 8443, MTU: 1400, LoggingLevel: "INFO"},
	}
	a := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := a.AddUser(core.User{UserID: "panel-id", Username: "alice", XrayUUID: "uuid-a"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	info, err := os.Stat(cfg.StatePath)
	if err != nil {
		t.Fatalf("stat state: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("state permissions: got %o want 600", got)
	}

	restarted := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := restarted.Start(context.Background()); err != nil {
		t.Fatalf("Start after restart: %v", err)
	}
	if got := restarted.users["panel-id"]; got != (User{Name: "alice", Password: "uuid-a"}) {
		t.Fatalf("persisted user not restored: %+v", got)
	}

	if err := restarted.RemoveUser("panel-id"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	again := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := again.Start(context.Background()); err != nil {
		t.Fatalf("Start after removal: %v", err)
	}
	if len(again.users) != 0 {
		t.Fatalf("removed user came back after restart: %+v", again.users)
	}
}

func TestStartRejectsCorruptStateWithoutReplacingConfig(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "server.json")
	statePath := filepath.Join(dir, "users.state.json")
	existing := []byte(`{"users":[{"name":"alice","password":"uuid-a"}]}`)
	if err := os.WriteFile(configPath, existing, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	if err := os.WriteFile(statePath, []byte(`{"version":1,"users":`), 0o600); err != nil {
		t.Fatalf("write corrupt state: %v", err)
	}
	runner := &recordingRunner{}
	a := New(Config{
		BinaryPath: "/usr/local/bin/mita",
		ConfigPath: configPath,
		StatePath:  statePath,
		RunCmd:     runner.run,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := a.Start(context.Background()); err == nil {
		t.Fatal("Start should reject corrupt state")
	}
	after, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if string(after) != string(existing) {
		t.Fatal("corrupt state handling replaced the live config")
	}
	if len(runner.calls) != 0 {
		t.Fatalf("corrupt state should not invoke mita, got %v", runner.calls)
	}
}

func TestStartPreservesExistingConfigDuringStateMigration(t *testing.T) {
	runner := &recordingRunner{}
	dir := t.TempDir()
	configPath := filepath.Join(dir, "server.json")
	existing, err := renderConfig(
		InboundConfig{ListenPort: 8443, MTU: 1400, LoggingLevel: "INFO"},
		[]User{{Name: "alice", Password: "uuid-a"}},
	)
	if err != nil {
		t.Fatalf("render existing config: %v", err)
	}
	if err := os.WriteFile(configPath, existing, 0o600); err != nil {
		t.Fatalf("write existing config: %v", err)
	}
	a := New(Config{
		BinaryPath: "/usr/local/bin/mita",
		ConfigPath: configPath,
		StatePath:  filepath.Join(dir, "missing.state.json"),
		Inbound:    InboundConfig{ListenPort: 8443, MTU: 1400, LoggingLevel: "INFO"},
		RunCmd:     runner.run,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start migration: %v", err)
	}
	after, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config after Start: %v", err)
	}
	if string(after) != string(existing) {
		t.Fatal("Start replaced the existing live config before panel resync")
	}
	if len(runner.calls) != 1 || !strings.Contains(strings.Join(runner.calls[0], " "), "start") {
		t.Fatalf("migration should only ensure the existing config is running, got %v", runner.calls)
	}
}

func TestStopDoesNotStopSystemdOwnedMita(t *testing.T) {
	runner := &recordingRunner{}
	a := New(Config{
		BinaryPath: "/usr/local/bin/mita",
		RunCmd:     runner.run,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := a.Stop(context.Background()); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if len(runner.calls) != 0 {
		t.Fatalf("agent shutdown must leave systemd-owned mita running, got %v", runner.calls)
	}
}
