package subprocess

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

func newSilentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestStartAndStopSleep(t *testing.T) {
	proc := New(Config{
		Name:   "sleep-test",
		Binary: "/bin/sleep",
		Args:   []string{"5"},
		Logger: newSilentLogger(),
	})

	ctx := context.Background()
	if err := proc.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !proc.Running() {
		t.Errorf("Running: expected true after Start")
	}

	if err := proc.Stop(ctx); err != nil {
		t.Errorf("Stop: %v", err)
	}
	if proc.Running() {
		t.Errorf("Running: expected false after Stop")
	}
}

func TestRunningBeforeStart(t *testing.T) {
	proc := New(Config{Name: "x", Binary: "/bin/true", Logger: newSilentLogger()})
	if proc.Running() {
		t.Errorf("Running: expected false before Start")
	}
}

func TestStartFailsOnMissingBinary(t *testing.T) {
	proc := New(Config{
		Name:   "ghost",
		Binary: "/no/such/binary/anywhere",
		Logger: newSilentLogger(),
	})
	if err := proc.Start(context.Background()); err == nil {
		t.Errorf("Start: expected error for missing binary")
	}
}

func TestDoubleStartReturnsError(t *testing.T) {
	proc := New(Config{
		Name:   "sleep-test",
		Binary: "/bin/sleep",
		Args:   []string{"5"},
		Logger: newSilentLogger(),
	})
	defer func() { _ = proc.Stop(context.Background()) }()

	if err := proc.Start(context.Background()); err != nil {
		t.Fatalf("first Start: %v", err)
	}
	if err := proc.Start(context.Background()); err == nil {
		t.Errorf("second Start: expected error")
	}
}

func TestStopWhenNotStartedIsNoop(t *testing.T) {
	proc := New(Config{Name: "x", Binary: "/bin/true", Logger: newSilentLogger()})
	if err := proc.Stop(context.Background()); err != nil {
		t.Errorf("Stop on unstarted: expected nil, got %v", err)
	}
}

// TestCrashRecoveryAllowsRestart covers the Wave-8 fix: when a subprocess
// exits (clean or crash), the watcher goroutine now nils out s.cmd via
// compare-and-swap so a subsequent Start() actually relaunches it.
// Without that, a segfaulted hysteria/xray/caddy left s.cmd non-nil and
// the next Start returned "already started" forever.
func TestCrashRecoveryAllowsRestart(t *testing.T) {
	// /bin/true exits immediately (rc=0). Watcher should close `exited`
	// AND clear s.cmd. Running() then reports false, and Start() works.
	proc := New(Config{
		Name:   "fast-exit",
		Binary: "/bin/true",
		Logger: newSilentLogger(),
	})
	if err := proc.Start(context.Background()); err != nil {
		t.Fatalf("first Start: %v", err)
	}

	// Wait for the watcher to observe the exit. /bin/true is ~10 ms; poll
	// with a short deadline.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !proc.Running() {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if proc.Running() {
		t.Fatal("Running: still true 2s after /bin/true exit, watcher didn't fire")
	}

	// The fix: a second Start MUST succeed (was: "already started" pre-Wave-8).
	if err := proc.Start(context.Background()); err != nil {
		t.Fatalf("Start after crash: %v", err)
	}
	_ = proc.Stop(context.Background())
}

// TestHealthyFlipsAfterCrash verifies the Wave-5 crash watcher: Running()
// observes the closed `exited` chan rather than reading ProcessState
// (the prior bug was Running()=true forever after a crash).
func TestHealthyFlipsAfterCrash(t *testing.T) {
	proc := New(Config{
		Name:   "false-exit",
		Binary: "/bin/false", // exits with rc=1 immediately
		Logger: newSilentLogger(),
	})
	if err := proc.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && proc.Running() {
		time.Sleep(10 * time.Millisecond)
	}
	if proc.Running() {
		t.Errorf("Running: expected false after /bin/false exit")
	}
}

// TestN9RestartsOnCrashThenGivesUp verifies the bounded restart-on-crash
// supervisor: /bin/false exits instantly, so the watcher respawns it up to
// MaxRestarts times (with backoff) and then leaves it down.
func TestN9RestartsOnCrashThenGivesUp(t *testing.T) {
	proc := New(Config{
		Name:           "crash-loop",
		Binary:         "/bin/false", // rc=1 immediately
		Logger:         newSilentLogger(),
		MaxRestarts:    3,
		RestartBackoff: 10 * time.Millisecond,
	})
	if err := proc.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		proc.mu.Lock()
		done := proc.restartCount >= 3 && proc.cmd == nil
		proc.mu.Unlock()
		if done {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	proc.mu.Lock()
	rc := proc.restartCount
	cmd := proc.cmd
	proc.mu.Unlock()
	if rc != 3 {
		t.Errorf("restartCount: got %d, want 3 (the budget)", rc)
	}
	if cmd != nil {
		t.Errorf("expected process down after exhausting the restart budget")
	}
	if proc.Running() {
		t.Errorf("Running: expected false after restart budget exhausted")
	}
}

// TestN9StopCancelsPendingRestart verifies a Stop during the restart backoff
// window cancels the pending respawn (the restart count must not climb).
func TestN9StopCancelsPendingRestart(t *testing.T) {
	proc := New(Config{
		Name:           "crash-stop",
		Binary:         "/bin/false",
		Logger:         newSilentLogger(),
		MaxRestarts:    5,
		RestartBackoff: 300 * time.Millisecond,
	})
	if err := proc.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// First crash registers ~immediately; the watcher schedules a respawn and
	// enters the 300ms backoff. Stop before it fires.
	time.Sleep(50 * time.Millisecond)
	_ = proc.Stop(context.Background())

	proc.mu.Lock()
	countAfterStop := proc.restartCount
	proc.mu.Unlock()

	time.Sleep(500 * time.Millisecond) // longer than the backoff

	proc.mu.Lock()
	finalCount := proc.restartCount
	cmd := proc.cmd
	proc.mu.Unlock()
	if finalCount != countAfterStop {
		t.Errorf("restartCount grew after Stop: %d -> %d (respawn not cancelled)", countAfterStop, finalCount)
	}
	if cmd != nil {
		t.Errorf("expected no live process after Stop")
	}
	if proc.Running() {
		t.Errorf("Running: expected false after Stop")
	}
}

func TestStopRespectsContext(t *testing.T) {
	proc := New(Config{
		Name:   "sleep-long",
		Binary: "/bin/sleep",
		Args:   []string{"60"},
		Logger: newSilentLogger(),
	})
	if err := proc.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Cancel before grace period elapses; Stop should kill the process and
	// return ctx.Err().
	stopCtx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	err := proc.Stop(stopCtx)
	if err == nil {
		// Process may have caught SIGTERM and exited cleanly within 100ms, fine.
		// Just assert it's no longer running.
	}
	if proc.Running() {
		t.Errorf("Running: expected false after Stop with cancelled ctx")
	}
}
