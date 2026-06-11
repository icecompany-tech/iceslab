// Package subprocess wraps `os/exec` for proxy-core binaries: it adds
// log-streaming to slog, a graceful Stop with SIGTERM-then-SIGKILL deadline,
// crash detection (a watcher goroutine on Wait() so Healthy() reflects
// real subprocess liveness), and a `Running()` query. Hysteria, Xray,
// NaiveProxy adapters all spawn an upstream binary — this package is the
// shared lifecycle manager.
package subprocess

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"sync"
	"time"
)

// StopGracePeriod is how long Stop waits for the process to exit after SIGTERM
// before escalating to SIGKILL.
const StopGracePeriod = 5 * time.Second

type Config struct {
	// Name appears in log lines (`source=<name>`) and error messages.
	Name string
	// Binary is the absolute path to the executable.
	Binary string
	// Args are passed verbatim after the binary name.
	Args []string
	// Logger receives one entry per line of stdout/stderr (Info/Error level).
	Logger *slog.Logger
}

// Subprocess is a single managed os/exec process. Methods are goroutine-safe.
//
// Concurrency model:
//   - Start spawns the OS process AND a watcher goroutine that blocks in
//     cmd.Wait(). When Wait returns, the watcher closes `exited` and stores
//     the error under mu. This is the SINGLE writer for ProcessState — all
//     reads (Running, Stop) take mu, so there's no data race even when the
//     process crashes mid-Healthy poll.
//   - Stop signals SIGTERM, blocks on either `exited`, the grace timeout,
//     or ctx cancellation. On timeout/cancel, it SIGKILLs and waits a
//     final time for `exited` so we never leak the watcher.
type Subprocess struct {
	cfg Config

	mu       sync.Mutex
	cmd      *exec.Cmd
	exited   chan struct{} // closed by the watcher goroutine on Wait() return
	exitErr  error         // set by watcher before closing `exited`; read under mu
}

// New builds a Subprocess; nothing is spawned until Start is called.
func New(cfg Config) *Subprocess {
	return &Subprocess{cfg: cfg}
}

// Start spawns the process. Stdout/stderr are streamed line-by-line into the
// configured logger. A watcher goroutine is spawned to call cmd.Wait() — its
// return marks the process as exited, which is what Running() observes.
//
// Returns an error if the binary cannot be exec'd or if Start has already
// been called.
func (s *Subprocess) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd != nil {
		return fmt.Errorf("%s: already started", s.cfg.Name)
	}

	cmd := exec.CommandContext(ctx, s.cfg.Binary, s.cfg.Args...)
	cmd.Stdout = newLogWriter(s.cfg.Logger, slog.LevelInfo, s.cfg.Name)
	cmd.Stderr = newLogWriter(s.cfg.Logger, slog.LevelError, s.cfg.Name)
	// N5 - put the child in its own process group so Stop (and ctx-cancel) can
	// signal the WHOLE group (-pgid), reaping any grandchildren the core forks
	// (helper procs, ACME/cert workers). Without this an orphaned grandchild
	// keeps the listen port and triggers a restart-storm on the next spawn.
	// Platform-specific (unix process groups); see subprocess_unix.go.
	setProcessGroup(cmd)
	// N4 - bound cmd.Wait(): if a grandchild inherits the stdout/stderr fd and
	// outlives the parent, Wait() would block forever, deadlocking the watcher
	// (and any restartMu held across it). WaitDelay forces the pipes closed +
	// kills leftovers after the grace period so Wait always returns.
	cmd.WaitDelay = StopGracePeriod
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn %s: %w", s.cfg.Name, err)
	}
	s.cmd = cmd
	exited := make(chan struct{})
	s.exited = exited
	s.exitErr = nil
	s.cfg.Logger.Info(s.cfg.Name+" subprocess started", "pid", cmd.Process.Pid)

	// Crash watcher. Without this, a subprocess that segfaults leaves
	// s.cmd non-nil and Running() previously returned true (it read
	// ProcessState which was nil since nothing called Wait). Healthy()
	// would lie. With the watcher: Wait() returns on any exit
	// (clean or crash), we record the error, close `exited`. Running()
	// observes the closed channel and returns false.
	//
	// IMPORTANT: on crash we ALSO clear s.cmd so the adapter can call
	// Start() again for restart-on-crash. Without this nil-out, a second
	// Start() returns "already started" forever even though the process
	// is dead.
	go func() {
		err := cmd.Wait()
		s.mu.Lock()
		s.exitErr = err
		// Only clear s.cmd if it still points at this very process — Stop()
		// may have already cleared+restarted. Compare-and-swap by pointer.
		if s.cmd == cmd {
			s.cmd = nil
			s.exited = nil
		}
		s.mu.Unlock()
		close(exited)
		if err != nil {
			s.cfg.Logger.Warn(s.cfg.Name+" subprocess exited", "err", err)
		} else {
			s.cfg.Logger.Info(s.cfg.Name + " subprocess exited cleanly")
		}
	}()
	return nil
}

// Stop gracefully terminates the process: SIGTERM, wait up to StopGracePeriod
// or until ctx is cancelled, then SIGKILL. Returns nil if the process exited
// cleanly within the grace window.
//
// Safe to call after the process has already crashed — exited is already
// closed, we just clear state and return.
func (s *Subprocess) Stop(_ context.Context) error {
	s.mu.Lock()
	cmd := s.cmd
	exited := s.exited
	s.cmd = nil
	s.exited = nil
	s.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return nil
	}

	// Fast-path: already exited (crash or earlier Stop).
	select {
	case <-exited:
		return nil
	default:
	}

	// N5 - signal the whole process group (Setpgid in Start made the child a
	// group leader). Reaps grandchildren too. See subprocess_unix.go.
	if err := terminateGroup(cmd); err != nil {
		s.cfg.Logger.Warn("sigterm failed", "name", s.cfg.Name, "err", err)
	}

	select {
	case <-exited:
		return nil
	case <-time.After(StopGracePeriod):
		_ = killGroup(cmd)
		// Block until the watcher reaps the killed process — otherwise
		// the goroutine outlives Stop and ProcessState races with any
		// later (mis-)use of cmd.
		<-exited
		return fmt.Errorf("%s did not stop within %s, killed", s.cfg.Name, StopGracePeriod)
	}
}

// Running reports whether the process has been started and has not exited.
// Safe to call concurrently with Stop / crash — the watcher goroutine is
// the single source of truth for "exited."
func (s *Subprocess) Running() bool {
	s.mu.Lock()
	exited := s.exited
	cmd := s.cmd
	s.mu.Unlock()
	if cmd == nil || cmd.Process == nil || exited == nil {
		return false
	}
	select {
	case <-exited:
		return false
	default:
		return true
	}
}

// ───── log-line writer (moved from hysteria/adapter.go) ─────

func newLogWriter(logger *slog.Logger, level slog.Level, source string) io.Writer {
	return &logWriter{logger: logger, level: level, source: source}
}

type logWriter struct {
	logger *slog.Logger
	level  slog.Level
	source string
	mu     sync.Mutex
	buf    []byte
}

func (w *logWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf = append(w.buf, p...)
	for {
		idx := indexNewline(w.buf)
		if idx < 0 {
			break
		}
		line := string(w.buf[:idx])
		w.buf = w.buf[idx+1:]
		w.logger.Log(context.Background(), w.level, line, "source", w.source)
	}
	return len(p), nil
}

func indexNewline(b []byte) int {
	for i, c := range b {
		if c == '\n' {
			return i
		}
	}
	return -1
}

// Sentinel for callers that want to assert "no error AND was running".
var ErrNotStarted = errors.New("subprocess not started")
