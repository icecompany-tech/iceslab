package amneziawg

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

func newTestAdapter(t *testing.T) (*Adapter, string) {
	t.Helper()
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "awg0.conf")
	a := New(Config{
		Inbound:    validInbound(),
		ConfigPath: cfgPath,
		// AwgQuickBin/AwgBin empty → config-only mode, no CLI is invoked.
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.cfg.Inbound.Interface = "awg0" // ensure deterministic
	return a, cfgPath
}

func TestAdapter_StartWritesConfig(t *testing.T) {
	a, cfgPath := newTestAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	blob, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if !strings.Contains(string(blob), "[Interface]") {
		t.Errorf("config missing [Interface] block: %s", blob)
	}
	if strings.Contains(string(blob), "[Peer]") {
		t.Errorf("expected no [Peer] before AddUser, got: %s", blob)
	}
	if !a.Healthy() {
		t.Errorf("adapter should be healthy after Start in config-only mode")
	}
}

func TestAdapter_AddUserSkipsWithoutCreds(t *testing.T) {
	a, _ := newTestAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	// Both fields missing → no-op.
	if err := a.AddUser(core.User{UserID: "u1"}); err != nil {
		t.Fatalf("AddUser empty: %v", err)
	}
	// Only public key, no IP → no-op.
	if err := a.AddUser(core.User{UserID: "u1", AmneziaWGPublicKey: "pub"}); err != nil {
		t.Fatalf("AddUser without IP: %v", err)
	}
	if len(a.peers) != 0 {
		t.Errorf("expected 0 peers, got %d", len(a.peers))
	}
}

func TestAdapter_AddRemoveUser(t *testing.T) {
	a, cfgPath := newTestAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	user := core.User{
		UserID:             "u-alice",
		AmneziaWGPublicKey: testWGPubKeyA,
		AmneziaWGAllowedIP: "10.0.0.42",
	}
	if err := a.AddUser(user); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if len(a.peers) != 1 {
		t.Errorf("expected 1 peer, got %d", len(a.peers))
	}
	blob, _ := os.ReadFile(cfgPath)
	if !strings.Contains(string(blob), "PublicKey = "+testWGPubKeyA) ||
		!strings.Contains(string(blob), "AllowedIPs = 10.0.0.42/32") {
		t.Errorf("config missing alice peer: %s", blob)
	}

	// Idempotent re-add — same data, should not error.
	if err := a.AddUser(user); err != nil {
		t.Fatalf("AddUser repeat: %v", err)
	}
	if len(a.peers) != 1 {
		t.Errorf("expected still 1 peer after idempotent AddUser, got %d", len(a.peers))
	}

	if err := a.RemoveUser(user.UserID); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	if len(a.peers) != 0 {
		t.Errorf("expected 0 peers after RemoveUser, got %d", len(a.peers))
	}
	// Idempotent remove.
	if err := a.RemoveUser(user.UserID); err != nil {
		t.Fatalf("RemoveUser repeat: %v", err)
	}
}

func TestAdapter_AddUserWithCIDRIP(t *testing.T) {
	// Caller passes CIDR form already — adapter should not double-suffix.
	a, cfgPath := newTestAdapter(t)
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
	blob, _ := os.ReadFile(cfgPath)
	if strings.Contains(string(blob), "10.0.0.5/32/32") {
		t.Errorf("AllowedIPs got double-suffixed: %s", blob)
	}
	if !strings.Contains(string(blob), "AllowedIPs = 10.0.0.5/32") {
		t.Errorf("expected single /32 suffix: %s", blob)
	}
}

func TestAdapter_GetStats(t *testing.T) {
	a, _ := newTestAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	a.AddUser(core.User{UserID: "u1", AmneziaWGPublicKey: testWGPubKeyA, AmneziaWGAllowedIP: "10.0.0.2/32"})
	a.AddUser(core.User{UserID: "u2", AmneziaWGPublicKey: testWGPubKeyB, AmneziaWGAllowedIP: "10.0.0.3/32"})
	stats, err := a.GetStats()
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}
	if len(stats.Users) != 2 {
		t.Errorf("expected 2 user stat entries, got %d", len(stats.Users))
	}
}

// fakeAwgDump is realistic output from `awg show awg0 dump`: tab-separated,
// first line is the interface, peer lines follow. Two peers, one with
// non-zero traffic, one untouched.
const fakeAwgDump = `srv-priv	srv-pub	1234	off	6	64	256	48	64	0	0	92327638	69242219	322809981	1135808409
BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=	psk-a	1.2.3.4:54321	10.66.66.2/32	1778646563	24390	348	25
CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=	(none)	(none)	10.66.66.3/32	0	0	0	off
`

// Verifies the pubkey->userID mapping AND the cumulative->delta accounting:
// the kernel counters are cumulative, but GetStats must emit per-poll deltas
// (first sight reports zero, growth reports the diff, a counter reset restarts
// from the current value). Regression guard for the runaway AWG traffic bug
// where every poll re-billed the lifetime total.
func TestAdapter_GetStats_ParsesDumpAndReportsDeltas(t *testing.T) {
	dir := t.TempDir()
	currentDump := fakeAwgDump
	a := New(Config{
		Inbound:     validInbound(),
		ConfigPath:  filepath.Join(dir, "awg0.conf"),
		AwgBin:      "/usr/bin/awg",
		AwgQuickBin: "/usr/bin/awg-quick",
	}, slog.Default())
	a.cfg.runCmd = func(ctx context.Context, name string, args ...string) ([]byte, error) {
		if len(args) > 0 && args[0] == "show" {
			return []byte(currentDump), nil
		}
		return nil, nil
	}
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	a.AddUser(core.User{UserID: "alice", AmneziaWGPublicKey: testWGPubKeyA, AmneziaWGAllowedIP: "10.66.66.2/32"})
	a.AddUser(core.User{UserID: "bob", AmneziaWGPublicKey: testWGPubKeyB, AmneziaWGAllowedIP: "10.66.66.3/32"})

	byID := func(s *core.Stats) map[string]core.UserStats {
		m := map[string]core.UserStats{}
		for _, u := range s.Users {
			m[u.UserID] = u
		}
		return m
	}

	// Poll 1: first sight. alice is already at 24390/348 cumulative in the
	// kernel, but we record the baseline and bill nothing.
	stats, err := a.GetStats()
	if err != nil {
		t.Fatalf("GetStats poll1: %v", err)
	}
	if got := byID(stats)["alice"]; got.BytesIn != 0 || got.BytesOut != 0 {
		t.Errorf("poll1 alice (first sight): got rx=%d tx=%d, want 0/0", got.BytesIn, got.BytesOut)
	}
	if stats.TotalBytesIn != 0 || stats.TotalBytesOut != 0 {
		t.Errorf("poll1 totals: got %d/%d, want 0/0", stats.TotalBytesIn, stats.TotalBytesOut)
	}

	// Poll 2: alice's cumulative grows 24390->30000 / 348->500. Expect the
	// delta (5610/152), NOT the cumulative.
	currentDump = strings.Replace(fakeAwgDump, "24390\t348", "30000\t500", 1)
	stats, err = a.GetStats()
	if err != nil {
		t.Fatalf("GetStats poll2: %v", err)
	}
	if got := byID(stats)["alice"]; got.BytesIn != 5610 || got.BytesOut != 152 {
		t.Errorf("poll2 alice delta: got rx=%d tx=%d, want 5610/152", got.BytesIn, got.BytesOut)
	}
	if got := byID(stats)["bob"]; got.BytesIn != 0 || got.BytesOut != 0 {
		t.Errorf("poll2 bob: got rx=%d tx=%d, want 0/0", got.BytesIn, got.BytesOut)
	}
	if stats.TotalBytesIn != 5610 || stats.TotalBytesOut != 152 {
		t.Errorf("poll2 totals: got %d/%d, want 5610/152", stats.TotalBytesIn, stats.TotalBytesOut)
	}

	// Poll 3: interface bounced — counters reset below the snapshot. Delta must
	// restart from the current value (100/40), never go negative.
	currentDump = strings.Replace(fakeAwgDump, "24390\t348", "100\t40", 1)
	stats, err = a.GetStats()
	if err != nil {
		t.Fatalf("GetStats poll3: %v", err)
	}
	if got := byID(stats)["alice"]; got.BytesIn != 100 || got.BytesOut != 40 {
		t.Errorf("poll3 alice after reset: got rx=%d tx=%d, want 100/40", got.BytesIn, got.BytesOut)
	}
}

func TestAdapter_GetStats_AwgFailureReturnsZeros(t *testing.T) {
	dir := t.TempDir()
	a := New(Config{
		Inbound:     validInbound(),
		ConfigPath:  filepath.Join(dir, "awg0.conf"),
		AwgBin:      "/usr/bin/awg",
		AwgQuickBin: "/usr/bin/awg-quick",
	}, slog.Default())
	a.cfg.runCmd = func(ctx context.Context, name string, args ...string) ([]byte, error) {
		if len(args) > 0 && args[0] == "show" {
			return nil, errors.New("iface down")
		}
		return nil, nil
	}
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	a.AddUser(core.User{UserID: "u1", AmneziaWGPublicKey: testWGPubKeyA, AmneziaWGAllowedIP: "10.66.66.2/32"})
	stats, err := a.GetStats()
	if err != nil {
		t.Fatalf("GetStats should fall back, not error: %v", err)
	}
	if len(stats.Users) != 1 || stats.Users[0].BytesIn != 0 {
		t.Errorf("expected zero-counter fallback, got %+v", stats.Users)
	}
}

func TestParseAwgDump_SkipsMalformed(t *testing.T) {
	rx, tx := parseAwgDump(fakeAwgDump + "garbage line with too few\n")
	if rx["BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="] != 24390 || tx["BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="] != 348 {
		t.Errorf("BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=: rx=%d tx=%d", rx["BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="], tx["BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="])
	}
	if _, ok := rx["garbage"]; ok {
		t.Errorf("malformed line should not produce entries")
	}
}

func TestAdapter_HealthyBeforeStart(t *testing.T) {
	a, _ := newTestAdapter(t)
	if a.Healthy() {
		t.Errorf("expected Healthy=false before Start")
	}
}

func TestAdapter_HealthyManagedRunsCmd(t *testing.T) {
	dir := t.TempDir()
	calls := []string{}
	a := New(Config{
		Inbound:     validInbound(),
		ConfigPath:  filepath.Join(dir, "awg0.conf"),
		AwgBin:      "/usr/bin/awg",
		AwgQuickBin: "/usr/bin/awg-quick",
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			calls = append(calls, name+" "+strings.Join(args, " "))
			return []byte(""), nil
		},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.cfg.Inbound.Interface = "awg0"

	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !a.Healthy() {
		t.Errorf("Healthy=false after Start with mocked runCmd returning success")
	}
	// Expect awg-quick up + awg show
	got := strings.Join(calls, "\n")
	if !strings.Contains(got, "awg-quick up awg0") {
		t.Errorf("expected `awg-quick up awg0` in calls:\n%s", got)
	}
	if !strings.Contains(got, "awg show awg0") {
		t.Errorf("expected `awg show awg0` in Healthy probe:\n%s", got)
	}
}

func TestAdapter_SyncconfFallbackToSystemctl(t *testing.T) {
	dir := t.TempDir()
	calls := []string{}
	syncconfFails := func(ctx context.Context, name string, args ...string) ([]byte, error) {
		calls = append(calls, name+" "+strings.Join(args, " "))
		// awg syncconf returns error; everything else succeeds.
		if name == "/usr/bin/awg" && len(args) > 0 && args[0] == "syncconf" {
			return []byte("kernel module hung"), errBoom
		}
		return []byte(""), nil
	}
	a := New(Config{
		Inbound:      validInbound(),
		ConfigPath:   filepath.Join(dir, "awg0.conf"),
		AwgBin:       "/usr/bin/awg",
		AwgQuickBin:  "/usr/bin/awg-quick",
		SystemctlBin: "/usr/bin/systemctl",
		runCmd:       syncconfFails,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.cfg.Inbound.Interface = "awg0"

	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := a.AddUser(core.User{
		UserID:             "u1",
		AmneziaWGPublicKey: testWGPubKeyA,
		AmneziaWGAllowedIP: "10.0.0.5/32",
	}); err != nil {
		t.Fatalf("AddUser: %v (expected fallback to succeed)", err)
	}
	got := strings.Join(calls, "\n")
	if !strings.Contains(got, "systemctl restart awg-quick@awg0") {
		t.Errorf("expected fallback systemctl restart, got:\n%s", got)
	}
}

type stubErr string

func (s stubErr) Error() string { return string(s) }

var errBoom = stubErr("boom")
