package mieru

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
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

func TestStart_InvokesMitaApplyAndReload(t *testing.T) {
	runner := &recordingRunner{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	dir := t.TempDir()
	a := New(Config{
		BinaryPath: "/usr/local/bin/mita",
		ConfigPath: dir + "/server.yaml",
		Inbound:    InboundConfig{ListenPort: 2012, MTU: 1400, LoggingLevel: "INFO"},
		RunCmd:     runner.run,
	}, logger)

	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Should have called: mita apply config <path> + mita reload
	if len(runner.calls) < 2 {
		t.Fatalf("expected at least 2 mita calls, got %d: %v", len(runner.calls), runner.calls)
	}
	first := strings.Join(runner.calls[0], " ")
	if !strings.Contains(first, "apply config") {
		t.Errorf("first call should be `apply config`, got %q", first)
	}
	second := strings.Join(runner.calls[1], " ")
	if !strings.Contains(second, "reload") {
		t.Errorf("second call should be `reload`, got %q", second)
	}
}
