package naive

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

// fakeCLI mirrors the helper from amneziawg/awg_cli_test.go: records every
// runCmd invocation and lets tests script per-command behaviour.
type fakeCLI struct {
	mu      sync.Mutex
	calls   []call
	handler func(name string, args []string) ([]byte, error)
}

type call struct {
	name string
	args []string
}

func (f *fakeCLI) run(_ context.Context, name string, args ...string) ([]byte, error) {
	f.mu.Lock()
	f.calls = append(f.calls, call{name: name, args: append([]string(nil), args...)})
	h := f.handler
	f.mu.Unlock()
	if h == nil {
		return nil, nil
	}
	return h(name, args)
}

func (f *fakeCLI) sequence() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.calls))
	for _, c := range f.calls {
		out = append(out, c.name+" "+strings.Join(c.args, " "))
	}
	return out
}

func newConfigOnlyAdapter(t *testing.T) (*Adapter, string) {
	t.Helper()
	caddyfile := filepath.Join(t.TempDir(), "Caddyfile")
	a := New(Config{
		Inbound:       validInbound(),
		CaddyfilePath: caddyfile,
		// CaddyBin empty → no subprocess, no CLI invocations.
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return a, caddyfile
}

// newManagedTestAdapter returns an adapter configured as if `caddy` were
// installed but with runCmd mocked AND the spawn-on-Start step skipped.
// We pre-set started=true so AddUser/RemoveUser exercise the reload path
// without trying to fork a real binary.
func newManagedTestAdapter(t *testing.T, fake *fakeCLI) (*Adapter, string) {
	t.Helper()
	caddyfile := filepath.Join(t.TempDir(), "Caddyfile")
	a := New(Config{
		Inbound:       validInbound(),
		CaddyfilePath: caddyfile,
		CaddyBin:      "/usr/local/bin/caddy-naive",
		ReloadTimeout: 500 * time.Millisecond,
		runCmd:        fake.run,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Write the initial Caddyfile so reload has something to point at.
	blob, err := renderCaddyfile(a.cfg.Inbound, usersSlice(a.users))
	if err != nil {
		t.Fatalf("render seed Caddyfile: %v", err)
	}
	if err := writeCaddyfile(a.cfg.CaddyfilePath, blob); err != nil {
		t.Fatalf("seed Caddyfile: %v", err)
	}
	a.started = true
	// Non-nil proc forces regenerateAndReload into the reload branch (via
	// injected runCmd) instead of the production cold-start path that shells
	// out to subprocess.New, caddy binary isn't on PATH in CI.
	a.proc = &subprocess.Subprocess{}
	return a, caddyfile
}

func TestName(t *testing.T) {
	a, _ := newConfigOnlyAdapter(t)
	if a.Name() != Name {
		t.Errorf("Name: got %q want %q", a.Name(), Name)
	}
}

func TestStart_ConfigOnlyWritesCaddyfile(t *testing.T) {
	a, path := newConfigOnlyAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !bytes.Contains(blob, []byte(":443, n1.example.com {")) {
		t.Errorf("Caddyfile missing expected header: %s", blob)
	}
	if !a.Healthy() {
		t.Errorf("Healthy should be true after Start in config-only mode")
	}
}

func TestAddUser_SkipsWithoutPassword(t *testing.T) {
	a, _ := newConfigOnlyAdapter(t)
	_ = a.Start(context.Background())
	if err := a.AddUser(core.User{UserID: "u", Username: "alice"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 0 {
		t.Errorf("user without NaivePassword should not be tracked; got %d", len(stats.Users))
	}
}

func TestAddUser_StoresAndPersists(t *testing.T) {
	a, path := newConfigOnlyAdapter(t)
	_ = a.Start(context.Background())
	err := a.AddUser(core.User{
		UserID:        "u-alice",
		Username:      "alice",
		NaivePassword: "secret-pw",
	})
	if err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 1 || stats.Users[0].UserID != "u-alice" {
		t.Errorf("expected tracked user u-alice, got %+v", stats.Users)
	}
	blob, _ := os.ReadFile(path)
	if !bytes.Contains(blob, []byte("basic_auth alice secret-pw")) {
		t.Errorf("Caddyfile missing alice basic_auth, got: %s", blob)
	}
}

func TestAddUser_Idempotent(t *testing.T) {
	a, path := newConfigOnlyAdapter(t)
	_ = a.Start(context.Background())
	user := core.User{UserID: "u", Username: "alice", NaivePassword: "p"}
	_ = a.AddUser(user)
	before, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	// Sleep just enough that mtime would differ if the file gets re-written.
	time.Sleep(20 * time.Millisecond)
	_ = a.AddUser(user)
	after, _ := os.Stat(path)
	if !after.ModTime().Equal(before.ModTime()) {
		t.Errorf("idempotent re-add should not rewrite Caddyfile; mtime changed")
	}
}

func TestAddUser_PasswordRotationRewrites(t *testing.T) {
	a, path := newConfigOnlyAdapter(t)
	_ = a.Start(context.Background())
	_ = a.AddUser(core.User{UserID: "u", Username: "alice", NaivePassword: "old"})
	_ = a.AddUser(core.User{UserID: "u", Username: "alice", NaivePassword: "new"})
	blob, _ := os.ReadFile(path)
	if bytes.Contains(blob, []byte("old")) {
		t.Errorf("old password still present after rotation: %s", blob)
	}
	if !bytes.Contains(blob, []byte("new")) {
		t.Errorf("new password missing after rotation: %s", blob)
	}
}

func TestRemoveUser_DropsAndIdempotent(t *testing.T) {
	a, path := newConfigOnlyAdapter(t)
	_ = a.Start(context.Background())
	_ = a.AddUser(core.User{UserID: "u", Username: "alice", NaivePassword: "p"})
	if err := a.RemoveUser("u"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 0 {
		t.Errorf("expected 0 users after RemoveUser; got %d", len(stats.Users))
	}
	blob, _ := os.ReadFile(path)
	if bytes.Contains(blob, []byte("basic_auth")) {
		t.Errorf("basic_auth line still in Caddyfile after RemoveUser: %s", blob)
	}
	// Idempotent.
	if err := a.RemoveUser("u"); err != nil {
		t.Errorf("RemoveUser of already-removed user must be no-op; got %v", err)
	}
	if err := a.RemoveUser("never-added"); err != nil {
		t.Errorf("RemoveUser of unknown user must be no-op; got %v", err)
	}
}

func TestHealthy_BeforeStart(t *testing.T) {
	a, _ := newConfigOnlyAdapter(t)
	if a.Healthy() {
		t.Errorf("Healthy must be false before Start")
	}
}

// Wave-14 C1 regression: panel-pushed port lands in Caddyfile site
// header. validInbound() leaves ListenPort=0 so install-time port is 443
// after toInboundConfig's caddyfile.go withDefaults; a panel push of 8443
// must update the rendered site line.
func TestApplyInbound_PortChangeRegeneratesCaddyfile(t *testing.T) {
	a, path := newConfigOnlyAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	body, _ := json.Marshal(map[string]any{
		"hostname":       "n1.example.com",
		"tlsEmail":       "ops@example.com",
		"masqueradeRoot": "",
	})
	if err := a.ApplyInbound(8443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.cfg.Inbound.ListenPort != 8443 {
		t.Errorf("ListenPort not updated, got %d want 8443", a.cfg.Inbound.ListenPort)
	}
	blob, _ := os.ReadFile(path)
	if !bytes.Contains(blob, []byte(":8443, n1.example.com {")) {
		t.Errorf("Caddyfile missing :8443 header, got:\n%s", blob)
	}
}

// ───── Mocked-caddy reload pipeline ─────

func TestReload_AddUserCallsCaddyReload(t *testing.T) {
	fake := &fakeCLI{}
	a, _ := newManagedTestAdapter(t, fake)

	if err := a.AddUser(core.User{
		UserID:        "u",
		Username:      "alice",
		NaivePassword: "p",
	}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	seq := fake.sequence()
	if len(seq) != 1 {
		t.Fatalf("expected exactly 1 caddy invocation, got: %v", seq)
	}
	if !strings.Contains(seq[0], "/usr/local/bin/caddy-naive reload --config") {
		t.Errorf("expected caddy reload --config call; got: %s", seq[0])
	}
	if !strings.Contains(seq[0], "--adapter caddyfile") {
		t.Errorf("expected --adapter caddyfile in reload; got: %s", seq[0])
	}
}

func TestReload_NoReloadOnIdempotentAddUser(t *testing.T) {
	fake := &fakeCLI{}
	a, _ := newManagedTestAdapter(t, fake)
	user := core.User{UserID: "u", Username: "a", NaivePassword: "p"}
	_ = a.AddUser(user)
	// Repeat, must not invoke caddy reload again.
	_ = a.AddUser(user)
	if got := len(fake.calls); got != 1 {
		t.Errorf("expected 1 reload call total (no-op re-add must not trigger reload); got %d", got)
	}
}

func TestReload_FailurePropagates(t *testing.T) {
	fake := &fakeCLI{
		handler: func(name string, args []string) ([]byte, error) {
			return []byte("adapt caddyfile: parse error"), errors.New("exit status 1")
		},
	}
	a, _ := newManagedTestAdapter(t, fake)
	err := a.AddUser(core.User{UserID: "u", Username: "a", NaivePassword: "p"})
	if err == nil {
		t.Fatalf("expected AddUser to surface caddy reload failure")
	}
	if !strings.Contains(err.Error(), "caddy reload") {
		t.Errorf("error should mention caddy reload; got: %v", err)
	}
}

func TestReload_HonoursTimeout(t *testing.T) {
	// Reload that never returns, adapter should bail out at ReloadTimeout.
	fake := &fakeCLI{
		handler: func(name string, args []string) ([]byte, error) {
			time.Sleep(800 * time.Millisecond)
			return nil, errors.New("context deadline exceeded")
		},
	}
	a, _ := newManagedTestAdapter(t, fake) // ReloadTimeout=500ms
	start := time.Now()
	err := a.AddUser(core.User{UserID: "u", Username: "a", NaivePassword: "p"})
	elapsed := time.Since(start)
	if err == nil {
		t.Fatalf("expected error when reload exceeds ReloadTimeout")
	}
	if elapsed > 1500*time.Millisecond {
		t.Errorf("reload should have bailed at ~500ms, took %v", elapsed)
	}
}

func TestReload_NoCaddyCallsInConfigOnly(t *testing.T) {
	// Sanity: config-only mode must NEVER invoke any CLI.
	fake := &fakeCLI{}
	caddyfile := filepath.Join(t.TempDir(), "Caddyfile")
	a := New(Config{
		Inbound:       validInbound(),
		CaddyfilePath: caddyfile,
		runCmd:        fake.run,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	_ = a.Start(context.Background())
	_ = a.AddUser(core.User{UserID: "u", Username: "a", NaivePassword: "p"})
	_ = a.RemoveUser("u")
	_ = a.Stop(context.Background())
	if got := fake.sequence(); len(got) != 0 {
		t.Errorf("config-only mode must not invoke CLI, got: %v", got)
	}
}
