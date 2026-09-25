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

// E34, 25.09 on nl-01: the first push's `awg-quick up` lost 443/udp to a
// hysteria the installer had started, a later peer sync's syncconf found no
// device and its systemctl fallback brought awg0 up with every peer, and the
// node kept reporting amneziawg as not running for as long as it stayed up:
// running was the outcome of the last apply, and the fallback never set it.
// Now it is the interface: whatever brought it up, the next healthcheck asks.
func TestCLI_HealthyFollowsTheInterfaceAfterAFailedApplyAndAFallback(t *testing.T) {
	var mu sync.Mutex
	up := false
	fake := &fakeCLI{
		handler: func(name string, args []string) ([]byte, error) {
			mu.Lock()
			defer mu.Unlock()
			switch {
			case name == "awg-quick" && args[0] == "up":
				return []byte("RTNETLINK answers: Address already in use"), errors.New("exit status 1")
			case name == "awg" && args[0] == "syncconf":
				return []byte("Unable to modify interface: No such device"), errors.New("exit status 1")
			case name == "systemctl" && args[0] == "restart":
				up = true
				return nil, nil
			case name == "awg" && args[0] == "show":
				if !up {
					return []byte("Unable to access interface: No such device"), errors.New("exit status 1")
				}
			}
			return nil, nil
		},
	}
	a, _ := newManagedAdapter(t, fake)
	// A freshly installed node: no server key until the panel's first push.
	a.cfg.Inbound.PrivateKey = ""

	if err := a.ApplyInbound(443, wirePayload(t, nil)); err == nil {
		t.Fatalf("the first apply must fail: awg-quick up lost the port")
	}
	if a.Healthy() {
		t.Fatalf("no interface after the failed apply, yet Healthy says running")
	}

	if err := a.AddUser(core.User{
		UserID:             "u",
		AmneziaWGPublicKey: testWGPubKeyA,
		AmneziaWGAllowedIP: "10.0.0.5/32",
	}); err != nil {
		t.Fatalf("AddUser: the systemctl fallback should succeed, got: %v", err)
	}
	if seq := strings.Join(fake.sequence(), "\n"); !strings.Contains(seq, "systemctl restart awg-quick@awg0") {
		t.Fatalf("expected the systemctl fallback, got:\n%s", seq)
	}
	if !a.Healthy() {
		t.Errorf("the fallback brought awg0 up, the next healthcheck must say running")
	}
}

// E37: a node updated from before E37 has the wide `! -o awg0` MASQUERADE rule
// in POSTROUTING from its last `awg-quick up`, and the new PostDown names the
// narrow rule, so no hook would ever take the old one away. The adapter does,
// on the first apply that meets the interface: every copy, and only that rule.
func TestCLI_TheFirstApplyRemovesThePreE37MasqueradeRule(t *testing.T) {
	const wide = "iptables -t nat -D POSTROUTING ! -o awg0 -j MASQUERADE"
	for _, c := range []struct {
		name  string
		apply func(a *Adapter) error
	}{
		// Agent restart after the update: the interface is up from the old config.
		{"start on a live interface", func(a *Adapter) error { return a.Start(context.Background()) }},
		// A peer change reaching an interface this agent did not bring up.
		{"peer sync", func(a *Adapter) error {
			return a.AddUser(core.User{UserID: "u", AmneziaWGPublicKey: testWGPubKeyA, AmneziaWGAllowedIP: "10.66.66.5/32"})
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			var mu sync.Mutex
			copies := 2 // an interface bounced once with a failing PostDown
			fake := &fakeCLI{
				handler: func(name string, args []string) ([]byte, error) {
					mu.Lock()
					defer mu.Unlock()
					switch {
					case name == "awg-quick" && args[0] == "up":
						return []byte("awg-quick: `awg0' already exists"), errors.New("exit status 1")
					case name == "iptables":
						if name+" "+strings.Join(args, " ") != wide {
							t.Errorf("iptables was asked for something else: %v", args)
						}
						if copies == 0 {
							return []byte("iptables: Bad rule (does a matching rule exist in that chain?)."), errors.New("exit status 1")
						}
						copies--
					}
					return nil, nil
				},
			}
			a, _ := newManagedAdapter(t, fake)
			if err := c.apply(a); err != nil {
				t.Fatalf("apply: %v", err)
			}
			if copies != 0 {
				t.Fatalf("%d copies of the wide rule are left", copies)
			}
			count := func() int {
				n := 0
				for _, s := range fake.sequence() {
					if s == wide {
						n++
					}
				}
				return n
			}
			// Two that removed, one refusal that ended the loop.
			if got := count(); got != 3 {
				t.Errorf("iptables -D ran %d times, want 3", got)
			}
			// Once per process: the next change does not ask again.
			_ = a.AddUser(core.User{UserID: "v", AmneziaWGPublicKey: testWGPubKeyB, AmneziaWGAllowedIP: "10.66.66.6/32"})
			if got := count(); got != 3 {
				t.Errorf("the next change asked iptables again: %d", got)
			}
		})
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
