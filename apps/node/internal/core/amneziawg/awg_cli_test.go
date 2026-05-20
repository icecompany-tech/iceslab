package amneziawg

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

// fakeCLI records every CLI invocation and lets tests script per-command
// behaviour. Goroutine-safe so it can be shared across the adapter's locks.
type fakeCLI struct {
	mu    sync.Mutex
	calls []call

	// handler: (binary, args) → (stdout/stderr, error). Default returns OK.
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

func newManagedAdapter(t *testing.T, fake *fakeCLI) (*Adapter, string) {
	t.Helper()
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "awg0.conf")
	a := New(Config{
		Inbound:      validInbound(),
		ConfigPath:   cfgPath,
		AwgBin:       "awg",
		AwgQuickBin:  "awg-quick",
		SystemctlBin: "systemctl",
		SyncTimeout:  500 * time.Millisecond,
		runCmd:       fake.run,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.cfg.Inbound.Interface = "awg0"
	return a, cfgPath
}

func TestCLI_StartCallsAwgQuickUp(t *testing.T) {
	fake := &fakeCLI{}
	a, _ := newManagedAdapter(t, fake)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	seq := fake.sequence()
	if len(seq) == 0 || !strings.HasPrefix(seq[0], "awg-quick up awg0") {
		t.Errorf("expected first call to be 'awg-quick up awg0', got %v", seq)
	}
}

func TestCLI_StartTreatsAlreadyExistsAsSuccess(t *testing.T) {
	fake := &fakeCLI{
		handler: func(name string, args []string) ([]byte, error) {
			if name == "awg-quick" && len(args) > 0 && args[0] == "up" {
				return []byte("RTNETLINK answers: File already exists"), errors.New("exit status 1")
			}
			return nil, nil
		},
	}
	a, _ := newManagedAdapter(t, fake)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("expected Start to swallow 'already exists', got: %v", err)
	}
	if !a.started {
		t.Errorf("started flag should be true after benign 'already exists'")
	}
}

func TestCLI_StartFailsOnRealAwgQuickError(t *testing.T) {
	fake := &fakeCLI{
		handler: func(name string, args []string) ([]byte, error) {
			if name == "awg-quick" && len(args) > 0 && args[0] == "up" {
				return []byte("Address 10.0.0.1/24 already assigned"), errors.New("exit status 1")
			}
			return nil, nil
		},
	}
	a, _ := newManagedAdapter(t, fake)
	err := a.Start(context.Background())
	if err == nil {
		t.Fatalf("expected Start to fail on non-benign awg-quick error")
	}
	if !strings.Contains(err.Error(), "awg-quick up") {
		t.Errorf("error should mention awg-quick up: %v", err)
	}
}

func TestCLI_StopCallsAwgQuickDown(t *testing.T) {
	fake := &fakeCLI{}
	a, _ := newManagedAdapter(t, fake)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := a.Stop(context.Background()); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	seq := strings.Join(fake.sequence(), "\n")
	if !strings.Contains(seq, "awg-quick down awg0") {
		t.Errorf("expected awg-quick down awg0 in calls:\n%s", seq)
	}
	if a.started {
		t.Errorf("started flag should be false after Stop")
	}
}

func TestCLI_AddUserPipelinesStripAndSyncconf(t *testing.T) {
	fake := &fakeCLI{}
	a, cfgPath := newManagedAdapter(t, fake)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := a.AddUser(core.User{
		UserID:             "u",
		AmneziaWGPublicKey: testWGPubKeyA,
		AmneziaWGAllowedIP: "10.0.0.5/32",
	}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	seq := fake.sequence()
	// Expected order: awg-quick up → awg-quick strip → awg syncconf
	var sawStrip, sawSync bool
	for i, c := range seq {
		if strings.HasPrefix(c, "awg-quick strip "+cfgPath) {
			sawStrip = true
			if !sawSync {
				// strip must come before sync
				for _, later := range seq[i+1:] {
					if strings.HasPrefix(later, "awg syncconf awg0 ") {
						sawSync = true
						break
					}
				}
			}
		}
	}
	if !sawStrip {
		t.Errorf("expected awg-quick strip on the config path; got %v", seq)
	}
	if !sawSync {
		t.Errorf("expected awg syncconf to run AFTER awg-quick strip; got %v", seq)
	}
}

func TestCLI_SyncconfTimeoutFallsBackToSystemctl(t *testing.T) {
	// awg syncconf hangs longer than SyncTimeout → ctx.Done() fires →
	// adapter falls back to systemctl restart.
	fake := &fakeCLI{
		handler: func(name string, args []string) ([]byte, error) {
			if name == "awg" && len(args) > 0 && args[0] == "syncconf" {
				time.Sleep(800 * time.Millisecond)
				return nil, errors.New("context deadline exceeded")
			}
			return nil, nil
		},
	}
	a, _ := newManagedAdapter(t, fake)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := a.AddUser(core.User{
		UserID:             "u",
		AmneziaWGPublicKey: testWGPubKeyA,
		AmneziaWGAllowedIP: "10.0.0.5/32",
	}); err != nil {
		t.Fatalf("AddUser should fall back successfully, got: %v", err)
	}
	seq := strings.Join(fake.sequence(), "\n")
	if !strings.Contains(seq, "systemctl restart awg-quick@awg0") {
		t.Errorf("expected systemctl restart fallback after timeout, got:\n%s", seq)
	}
}

func TestCLI_SyncconfErrorWithoutSystemctlReturnsError(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeCLI{
		handler: func(name string, args []string) ([]byte, error) {
			if name == "awg" && len(args) > 0 && args[0] == "syncconf" {
				return nil, errors.New("kernel module hung")
			}
			return nil, nil
		},
	}
	a := New(Config{
		Inbound:     validInbound(),
		ConfigPath:  filepath.Join(dir, "awg0.conf"),
		AwgBin:      "awg",
		AwgQuickBin: "awg-quick",
		// SystemctlBin intentionally empty.
		runCmd: fake.run,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.cfg.Inbound.Interface = "awg0"

	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	err := a.AddUser(core.User{
		UserID:             "u",
		AmneziaWGPublicKey: testWGPubKeyA,
		AmneziaWGAllowedIP: "10.0.0.5/32",
	})
	if err == nil {
		t.Fatalf("expected error when syncconf fails and no systemctl is configured")
	}
	if !strings.Contains(err.Error(), "no SystemctlBin") {
		t.Errorf("expected error to mention missing SystemctlBin, got: %v", err)
	}
}

func TestCLI_HealthyFalseWhenAwgShowFails(t *testing.T) {
	fake := &fakeCLI{
		handler: func(name string, args []string) ([]byte, error) {
			if name == "awg" && len(args) > 0 && args[0] == "show" {
				return nil, errors.New("interface awg0 not running")
			}
			return nil, nil
		},
	}
	a, _ := newManagedAdapter(t, fake)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if a.Healthy() {
		t.Errorf("Healthy should be false when 'awg show' fails")
	}
}

func TestCLI_NoCLIInConfigOnlyMode(t *testing.T) {
	// Sanity check: config-only mode (AwgQuickBin empty) must NOT call any CLI.
	fake := &fakeCLI{}
	dir := t.TempDir()
	a := New(Config{
		Inbound:    validInbound(),
		ConfigPath: filepath.Join(dir, "awg0.conf"),
		runCmd:     fake.run,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.cfg.Inbound.Interface = "awg0"

	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	a.AddUser(core.User{UserID: "u", AmneziaWGPublicKey: testWGPubKeyA, AmneziaWGAllowedIP: "10.0.0.5/32"})
	if err := a.Stop(context.Background()); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if got := fake.sequence(); len(got) != 0 {
		t.Errorf("config-only mode must not invoke CLI, got: %v", got)
	}
}
