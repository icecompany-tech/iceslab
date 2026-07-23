package hysteria

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

func newTestAdapter(t *testing.T) *Adapter {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(Config{}, logger)
}

func TestAddUserStoresPassword(t *testing.T) {
	a := newTestAdapter(t)

	if err := a.AddUser(core.User{
		UserID:           "u-1",
		Username:         "alice",
		HysteriaPassword: "secret",
	}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	id, ok := a.LookupByPassword("secret")
	if !ok || id != "u-1" {
		t.Errorf("Lookup: got id=%q ok=%v want id=u-1 ok=true", id, ok)
	}
}

func TestAddUserSkipsWhenNoHysteriaPassword(t *testing.T) {
	a := newTestAdapter(t)

	// User with only Xray credentials, Hysteria adapter should ignore.
	if err := a.AddUser(core.User{UserID: "u-2", XrayUUID: "uuid"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	stats, _ := a.GetStats()
	if len(stats.Users) != 0 {
		t.Errorf("user without HysteriaPassword should not be tracked, got %d users", len(stats.Users))
	}
}

func TestAddUserIsIdempotent(t *testing.T) {
	a := newTestAdapter(t)

	user := core.User{UserID: "u-3", HysteriaPassword: "p"}
	_ = a.AddUser(user)
	_ = a.AddUser(user)
	_ = a.AddUser(user)

	stats, _ := a.GetStats()
	if len(stats.Users) != 1 {
		t.Errorf("expected 1 user after 3x AddUser, got %d", len(stats.Users))
	}
}

func TestRemoveUserClearsPassword(t *testing.T) {
	a := newTestAdapter(t)
	_ = a.AddUser(core.User{UserID: "u-4", HysteriaPassword: "p"})

	if err := a.RemoveUser("u-4"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}

	if _, ok := a.LookupByPassword("p"); ok {
		t.Errorf("password should be cleared after RemoveUser")
	}
}

func TestRemoveUserIsIdempotent(t *testing.T) {
	a := newTestAdapter(t)
	if err := a.RemoveUser("never-added"); err != nil {
		t.Errorf("RemoveUser of unknown id should be a no-op, got %v", err)
	}
}

func TestPasswordChangeReplacesEntry(t *testing.T) {
	a := newTestAdapter(t)

	_ = a.AddUser(core.User{UserID: "u-5", HysteriaPassword: "old"})
	// Re-add same user with rotated password, old entry should be cleared
	// after RemoveUser, then new entry written.
	_ = a.RemoveUser("u-5")
	_ = a.AddUser(core.User{UserID: "u-5", HysteriaPassword: "new"})

	if _, ok := a.LookupByPassword("old"); ok {
		t.Errorf("old password should not be valid after rotation")
	}
	if id, ok := a.LookupByPassword("new"); !ok || id != "u-5" {
		t.Errorf("new password should map to u-5, got id=%q ok=%v", id, ok)
	}
}

func TestGetStatsReportsTrackedUsers(t *testing.T) {
	a := newTestAdapter(t)
	_ = a.AddUser(core.User{UserID: "a", HysteriaPassword: "p1"})
	_ = a.AddUser(core.User{UserID: "b", HysteriaPassword: "p2"})

	stats, err := a.GetStats()
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}
	if len(stats.Users) != 2 {
		t.Errorf("expected 2 users, got %d", len(stats.Users))
	}
}

func TestNameMatchesProtocol(t *testing.T) {
	a := newTestAdapter(t)
	if a.Name() != Name {
		t.Errorf("Name: got %q want %q", a.Name(), Name)
	}
}

func TestHealthyBeforeStart(t *testing.T) {
	a := newTestAdapter(t)
	if a.Healthy() {
		t.Errorf("Healthy: expected false before Start (callback server is nil)")
	}
}

func TestHealthyAfterCallbackStart(t *testing.T) {
	a := newTestAdapter(t)
	// Simulate a started callback server without a subprocess (BinaryPath="").
	a.callbackSrv = &http.Server{}
	if !a.Healthy() {
		t.Errorf("Healthy: expected true with callback up and no subprocess configured")
	}
}

// Under systemd, Start() skips the in-process spawn by design, so a.proc stays
// nil forever. Healthy() used to read that nil as "hysteria is down" and every
// systemd-managed node reported unhealthy permanently, which is precisely the
// state in which a node going genuinely bad raises no new alarm. The unit's own
// liveness is the answer now, so a dead unit must still read unhealthy.
func newSystemdAdapter(t *testing.T, runner *recordingRunner) *Adapter {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{
		BinaryPath:  "/usr/bin/hysteria",
		ServiceUnit: "hysteria-server.service",
		RunCmd:      runner.run,
	}, logger)
	a.callbackSrv = &http.Server{} // callback up, subprocess deliberately absent
	return a
}

func TestHealthy_SystemdModeAsksSystemd(t *testing.T) {
	runner := &recordingRunner{}
	a := newSystemdAdapter(t, runner)

	if !a.Healthy() {
		t.Fatal("Healthy: systemd-managed node with an active unit must report healthy")
	}
	calls := runner.snapshot()
	if len(calls) != 1 {
		t.Fatalf("expected exactly one probe, got %v", calls)
	}
	if got, want := strings.Join(calls[0], " "),
		"systemctl is-active --quiet hysteria-server.service"; got != want {
		t.Errorf("probe: got %q want %q", got, want)
	}
}

func TestHealthy_SystemdModeReportsDeadUnit(t *testing.T) {
	runner := &recordingRunner{err: errors.New("inactive")}
	a := newSystemdAdapter(t, runner)

	if a.Healthy() {
		t.Error("Healthy: unit is not active, node must not report healthy")
	}
}

func TestHealthy_SystemdProbeIsCached(t *testing.T) {
	// The panel healthchecks every node on a fan-out; forking systemctl on each
	// call would put an external process on that path.
	runner := &recordingRunner{}
	a := newSystemdAdapter(t, runner)

	for range 5 {
		a.Healthy()
	}
	if n := len(runner.snapshot()); n != 1 {
		t.Errorf("expected the probe to be cached after the first call, ran it %d times", n)
	}
}

func TestHealthy_SpawnModeStillRequiresTheSubprocess(t *testing.T) {
	// No ServiceUnit: we own the subprocess, so its absence is real evidence.
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{BinaryPath: "/usr/bin/hysteria"}, logger)
	a.callbackSrv = &http.Server{}

	if a.Healthy() {
		t.Error("Healthy: spawn mode with no running subprocess must report unhealthy")
	}
}

// ───── ApplyInbound (slice 24b2) ─────

// recordingRunner captures every RunCmd invocation for assertions. err, when
// set, is returned from every call so tests can drive the failure path.
type recordingRunner struct {
	mu    sync.Mutex
	calls [][]string
	err   error
}

func (r *recordingRunner) run(_ context.Context, name string, args ...string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, append([]string{name}, args...))
	return r.err
}

func (r *recordingRunner) snapshot() [][]string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([][]string(nil), r.calls...)
}

func newApplyInboundAdapter(t *testing.T, runner *recordingRunner) (*Adapter, string) {
	t.Helper()
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{
		Hostname:    "hy2.example.com",
		ACMEEmail:   "admin@example.com",
		ListenPort:  443,
		ConfigPath:  cfgPath,
		ServiceUnit: "hysteria-server.service",
		RunCmd:      runner.run,
	}, logger)
	return a, cfgPath
}

func TestApplyInbound_WritesConfigAndRestartsService(t *testing.T) {
	runner := &recordingRunner{}
	a, cfgPath := newApplyInboundAdapter(t, runner)

	body, _ := json.Marshal(map[string]any{
		"obfsPassword":  "salt",
		"masqueradeUrl": "https://www.bing.com",
	})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	blob, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read written config: %v", err)
	}
	body2 := string(blob)
	if !strings.Contains(body2, "password: salt") {
		t.Errorf("written config missing obfs password:\n%s", body2)
	}
	if !strings.Contains(body2, "url: https://www.bing.com") {
		t.Errorf("written config missing masquerade url:\n%s", body2)
	}

	if got := len(runner.calls); got != 1 {
		t.Fatalf("expected 1 systemctl call, got %d: %v", got, runner.calls)
	}
	want := []string{"systemctl", "restart", "hysteria-server.service"}
	for i, v := range want {
		if runner.calls[0][i] != v {
			t.Errorf("call arg[%d]: got %q want %q (full: %v)", i, runner.calls[0][i], v, runner.calls[0])
		}
	}
}

func TestApplyInbound_IsIdempotent(t *testing.T) {
	runner := &recordingRunner{}
	a, _ := newApplyInboundAdapter(t, runner)

	body, _ := json.Marshal(map[string]any{"obfsPassword": "salt"})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("first ApplyInbound: %v", err)
	}
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("second ApplyInbound: %v", err)
	}
	if got := len(runner.calls); got != 1 {
		t.Errorf("expected 1 restart for two identical applies, got %d: %v", got, runner.calls)
	}
}

func TestApplyInbound_RestartFiresOnEveryRealChange(t *testing.T) {
	runner := &recordingRunner{}
	a, _ := newApplyInboundAdapter(t, runner)

	first, _ := json.Marshal(map[string]any{"obfsPassword": "v1"})
	second, _ := json.Marshal(map[string]any{"obfsPassword": "v2"})

	_ = a.ApplyInbound(443, first)
	_ = a.ApplyInbound(443, second)

	if got := len(runner.calls); got != 2 {
		t.Errorf("expected 2 restarts for differing applies, got %d", got)
	}
}

func TestApplyInbound_NoConfigPath_AcceptsInMemory(t *testing.T) {
	runner := &recordingRunner{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{RunCmd: runner.run}, logger) // no ConfigPath, no ServiceUnit

	body, _ := json.Marshal(map[string]any{"obfsPassword": "x"})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if len(runner.calls) != 0 {
		t.Errorf("no ConfigPath → no systemctl call expected, got %v", runner.calls)
	}

	// Same body again → diff says equal, no work either way
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("second ApplyInbound: %v", err)
	}
}

func TestApplyInbound_NoServiceUnit_WritesButNoRestart(t *testing.T) {
	runner := &recordingRunner{}
	dir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{
		Hostname:   "h",
		ACMEEmail:  "e@x",
		ConfigPath: filepath.Join(dir, "config.yaml"),
		RunCmd:     runner.run,
		// ServiceUnit deliberately empty
	}, logger)

	body, _ := json.Marshal(map[string]any{"obfsPassword": "x"})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if len(runner.calls) != 0 {
		t.Errorf("empty ServiceUnit → no systemctl call expected, got %v", runner.calls)
	}
	if _, err := os.Stat(filepath.Join(dir, "config.yaml")); err != nil {
		t.Errorf("config should still be written when ServiceUnit empty: %v", err)
	}
}

func TestApplyInbound_RejectsMalformedJSON(t *testing.T) {
	runner := &recordingRunner{}
	a, _ := newApplyInboundAdapter(t, runner)

	if err := a.ApplyInbound(443, []byte("{not json")); err == nil {
		t.Errorf("expected parse error on malformed JSON")
	}
	if len(runner.calls) != 0 {
		t.Errorf("no systemctl on parse error, got %v", runner.calls)
	}
}
