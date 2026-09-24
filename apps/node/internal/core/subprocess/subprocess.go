// Package subprocess wraps `os/exec` for proxy-core binaries: it adds
// log-streaming to slog, a graceful Stop with SIGTERM-then-SIGKILL deadline,
// crash detection (a watcher goroutine on Wait() so Healthy() reflects
// real subprocess liveness), and a `Running()` query. Hysteria, Xray,
// NaiveProxy adapters all spawn an upstream binary, this package is the
// shared lifecycle manager.
package subprocess

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// StopGracePeriod is how long Stop waits for the process to exit after SIGTERM
// before escalating to SIGKILL.
const StopGracePeriod = 5 * time.Second

// DefaultMaxRestarts / DefaultRestartBackoff (N9): the crash-restart policy the
// proxy-core adapters pass to subprocess.Config. Tuned to ride out transient
// crashes (OOM blip, a flaky upstream reload) without masking a hard
// crash-loop: 5 attempts inside restartResetWindow, then give up and let the
// panel healthcheck report the core down.
const (
	DefaultMaxRestarts    = 5
	DefaultRestartBackoff = 2 * time.Second
)

// restartResetWindow (N9): a process that stays up at least this long is judged
// "stable", so its crash-restart counter resets. A single crash after a long
// healthy run isn't penalised by crashes from hours ago; a tight crash-loop
// still exhausts MaxRestarts within the window.
const restartResetWindow = 60 * time.Second

// Memory watchdog (2026-08-04, operator request). Restart the core BEFORE it
// eats the box, instead of waiting for the kernel OOM killer to do it at a
// random moment. The honest trade: a restart drops every live connection, so
// we swap an unpredictable OOM for a predictable one. That's why the limit is
// meant to sit high (see MemoryLimitBytes) and why every restart is counted
// and reported - a watchdog nobody can see turns "cores keep dying" into
// "users complain while the panel stays green".
const defaultMemoryCheckInterval = 30 * time.Second

// var, not const, purely so tests can shrink the windows; production code never
// assigns to these.
var (
	// memoryBreachesToRestart: consecutive over-limit samples before we act.
	// One sample can catch a transient spike (a burst of connections being
	// set up); two spaced by the check interval means it actually settled
	// above the line.
	memoryBreachesToRestart = 2
	// memoryMinUptime: a process younger than this is never memory-killed.
	// Guards the one way this can go badly wrong - a limit set below the
	// core's normal footprint would otherwise produce an endless
	// kill/respawn storm. With this, the worst case is one restart per
	// memoryMinUptime, and the log says the limit is too low.
	memoryMinUptime = 5 * time.Minute
)

// RestartReason labels why the supervisor respawned the core. Reported to the
// panel so an operator can tell "the core is crashing" (a bug) from "the core
// hit the memory ceiling" (the watchdog doing its job).
type RestartReason string

const (
	RestartReasonCrash  RestartReason = "crash"
	RestartReasonMemory RestartReason = "memory"
)

// RestartEvent is handed to Config.OnRestart just before a respawn. Adapters
// accumulate these: the counters must NOT live on Subprocess, because a config
// push builds a brand-new Subprocess and would reset them to zero, which is
// exactly when an operator is looking at the number.
type RestartEvent struct {
	Reason RestartReason
	// Attempt / Max are the crash-restart budget position (RestartReasonCrash
	// only; a memory restart doesn't spend the crash budget).
	Attempt int
	Max     int
	// RSSBytes / LimitBytes are the measurement that triggered a memory
	// restart. Zero for crashes.
	RSSBytes   uint64
	LimitBytes uint64
	At         time.Time
}

type Config struct {
	// Name appears in log lines (`source=<name>`) and error messages.
	Name string
	// Binary is the absolute path to the executable.
	Binary string
	// Args are passed verbatim after the binary name.
	Args []string
	// Logger receives one entry per line of stdout/stderr (Info/Error level).
	Logger *slog.Logger
	// N9 - restart-on-crash policy. MaxRestarts == 0 (the default) disables
	// auto-restart: a crash leaves the process down until something calls Start
	// again (legacy behaviour). When > 0, the crash watcher respawns the process
	// after an UNEXPECTED exit (not a Stop), up to MaxRestarts times within
	// restartResetWindow, waiting RestartBackoff between attempts.
	MaxRestarts    int
	RestartBackoff time.Duration

	// MemoryLimitBytes arms the memory watchdog when > 0: the process is
	// restarted once its RSS stays above this for memoryBreachesToRestart
	// consecutive samples. Callers derive it as a PERCENTAGE of host RAM
	// rather than an absolute number, so the same agent build behaves
	// sensibly on a 1 GB and a 32 GB box.
	//
	// Set it HIGH. A restart kills every live connection (no drain exists),
	// so the ceiling should mean "this is about to end badly anyway", not
	// "this is more than I expected".
	//
	// Requires MaxRestarts > 0: the watchdog kills, and it's the crash
	// watcher that brings the process back. With auto-restart off, arming
	// this would just stop the core, so it is refused and logged.
	MemoryLimitBytes uint64
	// MemoryCheckInterval between RSS samples. Defaults to 30s.
	MemoryCheckInterval time.Duration
	// ReadRSS reads a process's resident set size in bytes. nil means the
	// platform default (/proc/<pid>/statm on Linux). Tests inject a fake to
	// drive the watchdog without a real memory hog.
	ReadRSS func(pid int) (uint64, error)
	// OnRestart is called just before each respawn (and never for a Stop).
	// Optional. Must not block: it runs on the watcher goroutine.
	OnRestart func(RestartEvent)
}

// Subprocess is a single managed os/exec process. Methods are goroutine-safe.
//
// Concurrency model:
//   - Start spawns the OS process AND a watcher goroutine that blocks in
//     cmd.Wait(). When Wait returns, the watcher closes `exited` and stores
//     the error under mu. This is the SINGLE writer for ProcessState, all
//     reads (Running, Stop) take mu, so there's no data race even when the
//     process crashes mid-Healthy poll.
//   - Stop signals SIGTERM, blocks on either `exited`, the grace timeout,
//     or ctx cancellation. On timeout/cancel, it SIGKILLs and waits a
//     final time for `exited` so we never leak the watcher.
type Subprocess struct {
	cfg Config

	mu      sync.Mutex
	cmd     *exec.Cmd
	exited  chan struct{} // closed by the watcher goroutine on Wait() return
	exitErr error         // set by watcher before closing `exited`; read under mu
	// N9 - restart-on-crash bookkeeping (all under mu).
	ctx          context.Context // Start ctx, reused so a respawn stays ctx-bound
	stopping     bool            // set by Stop so the watcher won't respawn
	restartCount int             // crashes within the current reset window
	lastSpawnAt  time.Time       // when the live process was spawned
	// Memory watchdog state (under mu). memKill is set by the watchdog right
	// before it signals the process, so the crash watcher can tell an
	// intentional memory restart from a real crash and label it accordingly.
	memKill bool
	memRSS  uint64 // last RSS sample, 0 until the watchdog takes one
	// How the most recent process ended, kept past the respawn that clears
	// exitErr, and the stderr of the most recent spawn, for ExitReason.
	lastExit    error
	lastExitSet bool
	stderr      *logWriter
}

// New builds a Subprocess; nothing is spawned until Start is called.
func New(cfg Config) *Subprocess {
	return &Subprocess{cfg: cfg}
}

// Start spawns the process. Stdout/stderr are streamed line-by-line into the
// configured logger. A watcher goroutine is spawned to call cmd.Wait(), its
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
	// Fresh Start (after New or a Stop): clear the crash-restart state so a new
	// lifecycle gets a full restart budget and isn't blocked by an old Stop.
	s.stopping = false
	s.restartCount = 0
	return s.spawnLocked(ctx)
}

// spawnLocked execs the binary and launches its crash watcher. Caller MUST hold
// s.mu and have ensured s.cmd == nil. ctx is retained on the struct so a
// crash-restart respawn stays bound to the same lifetime (ctx-cancel still
// kills it).
func (s *Subprocess) spawnLocked(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, s.cfg.Binary, s.cfg.Args...)
	cmd.Stdout = newLogWriter(s.cfg.Logger, slog.LevelInfo, s.cfg.Name)
	stderr := &logWriter{logger: s.cfg.Logger, level: slog.LevelError, source: s.cfg.Name}
	cmd.Stderr = stderr
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
	s.ctx = ctx
	s.stderr = stderr
	s.lastSpawnAt = time.Now()
	exited := make(chan struct{})
	s.exited = exited
	s.exitErr = nil
	s.cfg.Logger.Info(s.cfg.Name+" subprocess started", "pid", cmd.Process.Pid)
	go s.watch(cmd, exited, ctx)
	if s.cfg.MemoryLimitBytes > 0 {
		if s.cfg.MaxRestarts <= 0 {
			// Arming the watchdog without a restart policy would kill the core
			// and leave it down, which is strictly worse than the OOM we're
			// trying to pre-empt. Refuse, loudly.
			s.cfg.Logger.Error(s.cfg.Name+" memory watchdog NOT armed: needs MaxRestarts > 0",
				"limitBytes", s.cfg.MemoryLimitBytes)
		} else {
			go s.watchMemory(cmd, exited, ctx)
		}
	}
	return nil
}

// watch blocks on cmd.Wait() and, on exit, records the result, marks the
// process not-running, and (N9) optionally respawns it.
//
// Without the watcher a segfaulted subprocess would leave s.cmd non-nil and
// Running() lying. With it: Wait() returns on any exit, we record the error,
// nil out s.cmd (so a future Start works) and close `exited` (so Running()/Stop
// observe it). When a restart policy is configured AND the exit was unexpected
// (not a Stop, still the current cmd, budget left) we back off and respawn.
func (s *Subprocess) watch(cmd *exec.Cmd, exited chan struct{}, ctx context.Context) {
	err := cmd.Wait()

	s.mu.Lock()
	s.exitErr = err
	s.lastExit = err
	s.lastExitSet = true
	// Only act if this watcher's cmd is still the active one, Stop() or an
	// earlier restart may have already swapped it out. Compare by pointer.
	isCurrent := s.cmd == cmd
	if isCurrent {
		s.cmd = nil
		s.exited = nil
	}
	restart := false
	exhausted := false
	var backoff time.Duration
	var attempt, maxR int
	// memKill: this exit is the memory watchdog's doing, not a crash. Read and
	// clear it here so a later real crash isn't mislabelled.
	memKill := isCurrent && s.memKill
	s.memKill = false
	rss := s.memRSS
	if isCurrent && !s.stopping && s.cfg.MaxRestarts > 0 {
		switch {
		case memKill:
			// A memory restart is planned maintenance, so it does NOT spend the
			// crash budget: five ceiling hits over a week must not leave the
			// core down. memoryMinUptime is what bounds this instead - it caps
			// memory restarts at one per that window even with a silly limit.
			s.restartCount = 0
			restart = true
			backoff = s.cfg.RestartBackoff
			maxR = s.cfg.MaxRestarts
		default:
			if time.Since(s.lastSpawnAt) > restartResetWindow {
				s.restartCount = 0 // stable run, fresh budget
			}
			if s.restartCount < s.cfg.MaxRestarts {
				s.restartCount++
				restart = true
				backoff = s.cfg.RestartBackoff
				attempt = s.restartCount
				maxR = s.cfg.MaxRestarts
			} else {
				exhausted = true
				maxR = s.cfg.MaxRestarts
			}
		}
	}
	limit := s.cfg.MemoryLimitBytes
	onRestart := s.cfg.OnRestart
	s.mu.Unlock()

	close(exited)
	switch {
	case memKill:
		s.cfg.Logger.Warn(s.cfg.Name+" subprocess exited (memory watchdog)",
			"rssBytes", rss, "limitBytes", limit)
	case err != nil:
		s.cfg.Logger.Warn(s.cfg.Name+" subprocess exited", "err", err)
	default:
		s.cfg.Logger.Info(s.cfg.Name + " subprocess exited cleanly")
	}
	if restart && onRestart != nil {
		ev := RestartEvent{Reason: RestartReasonCrash, Attempt: attempt, Max: maxR, At: time.Now()}
		if memKill {
			ev = RestartEvent{
				Reason: RestartReasonMemory, Max: maxR,
				RSSBytes: rss, LimitBytes: limit, At: time.Now(),
			}
		}
		onRestart(ev)
	}
	if exhausted {
		s.cfg.Logger.Error(s.cfg.Name+" exceeded crash-restart budget, leaving down",
			"max", maxR, "window", restartResetWindow)
		return
	}
	if !restart {
		return
	}

	// Back off before respawning, but bail immediately if the lifetime ctx is
	// cancelled (agent shutting down).
	if backoff > 0 {
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// A Stop (or another Start) during the backoff window wins, don't respawn.
	if s.stopping || s.cmd != nil {
		return
	}
	s.cfg.Logger.Warn(s.cfg.Name+" restarting after crash", "attempt", attempt, "max", maxR)
	if err := s.spawnLocked(ctx); err != nil {
		s.cfg.Logger.Error(s.cfg.Name+" crash-restart failed", "err", err)
	}
}

// watchMemory samples the process's RSS and restarts it once it stays above
// MemoryLimitBytes. One goroutine per spawned process; it exits when that
// process exits (`exited` closed) or the lifetime ctx is cancelled, so a
// respawn gets a fresh watchdog with a clean breach counter.
//
// It does not respawn anything itself: it signals the process and lets the
// crash watcher's restart path bring it back, tagged via s.memKill. One
// restart mechanism, not two.
func (s *Subprocess) watchMemory(cmd *exec.Cmd, exited chan struct{}, ctx context.Context) {
	interval := s.cfg.MemoryCheckInterval
	if interval <= 0 {
		interval = defaultMemoryCheckInterval
	}
	read := s.cfg.ReadRSS
	if read == nil {
		read = readRSSBytes
	}
	limit := s.cfg.MemoryLimitBytes
	pid := cmd.Process.Pid

	tick := time.NewTicker(interval)
	defer tick.Stop()
	breaches := 0
	readFailed := false

	for {
		select {
		case <-ctx.Done():
			return
		case <-exited:
			return
		case <-tick.C:
		}

		rss, err := read(pid)
		if err != nil {
			// Unsupported platform or the process just went away. Log once so a
			// dev box doesn't spam, then keep looping: the process may still be
			// alive and the next read may work.
			if !readFailed {
				readFailed = true
				s.cfg.Logger.Warn(s.cfg.Name+" memory watchdog: cannot read RSS, ceiling not enforced",
					"pid", pid, "err", err)
			}
			continue
		}
		readFailed = false

		s.mu.Lock()
		s.memRSS = rss
		spawnedAt := s.lastSpawnAt
		stillCurrent := s.cmd == cmd
		s.mu.Unlock()
		if !stillCurrent {
			return // swapped out by a config push; that process has its own watchdog
		}

		if rss <= limit {
			breaches = 0
			continue
		}
		breaches++
		if breaches < memoryBreachesToRestart {
			s.cfg.Logger.Warn(s.cfg.Name+" memory above ceiling",
				"rssBytes", rss, "limitBytes", limit,
				"breach", breaches, "needed", memoryBreachesToRestart)
			continue
		}
		if uptime := time.Since(spawnedAt); uptime < memoryMinUptime {
			// Over the ceiling this soon after a start means the ceiling is
			// below the core's normal footprint. Restarting would just storm.
			s.cfg.Logger.Error(s.cfg.Name+" memory above ceiling right after start, NOT restarting "+
				"(ceiling looks set too low, raise it)",
				"rssBytes", rss, "limitBytes", limit, "uptime", uptime.String())
			breaches = 0
			continue
		}

		s.mu.Lock()
		// Re-check under the lock: a Stop or a config-push swap may have landed
		// while we were deciding, and killing then would fight them.
		if s.stopping || s.cmd != cmd {
			s.mu.Unlock()
			return
		}
		s.memKill = true
		s.mu.Unlock()

		s.cfg.Logger.Warn(s.cfg.Name+" memory ceiling hit, restarting core "+
			"(live connections will drop)",
			"rssBytes", rss, "limitBytes", limit, "pid", pid)
		if err := terminateGroup(cmd); err != nil {
			s.cfg.Logger.Warn(s.cfg.Name+" memory watchdog: sigterm failed", "err", err)
		}
		select {
		case <-exited:
		case <-time.After(StopGracePeriod):
			_ = killGroup(cmd)
		}
		return // the crash watcher respawns; the new process gets a new watchdog
	}
}

// RSSBytes returns the watchdog's most recent resident-size sample, or 0 when
// the watchdog is disarmed or hasn't sampled yet. Reporting only; the panel
// shows it next to the ceiling so an operator can see how close a core runs.
func (s *Subprocess) RSSBytes() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.memRSS
}

// Stop gracefully terminates the process: SIGTERM, wait up to StopGracePeriod
// or until ctx is cancelled, then SIGKILL. Returns nil if the process exited
// cleanly within the grace window.
//
// Safe to call after the process has already crashed, exited is already
// closed, we just clear state and return.
func (s *Subprocess) Stop(_ context.Context) error {
	s.mu.Lock()
	// N9 - tell the crash watcher this exit is intentional so it doesn't
	// respawn. Set BEFORE clearing cmd and unconditionally (even on the
	// already-crashed fast path) so a Stop during a restart-backoff window
	// still cancels the pending respawn.
	s.stopping = true
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
		// Block until the watcher reaps the killed process, otherwise
		// the goroutine outlives Stop and ProcessState races with any
		// later (mis-)use of cmd.
		<-exited
		return fmt.Errorf("%s did not stop within %s, killed", s.cfg.Name, StopGracePeriod)
	}
}

// Running reports whether the process has been started and has not exited.
// Safe to call concurrently with Stop / crash, the watcher goroutine is
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

// ExitReason says how the most recent process ended, in words an operator
// can act on: the exit status ("signal: killed", "exit status 1") and the
// last line it wrote to stderr, which is usually the engine's own reason.
// Empty while nothing has exited yet.
//
// Kept past a crash-restart: the respawn clears the live exit state, and the
// reason is wanted exactly when the process is down again and the panel asks
// why (E21: the chain died of a cancelled context and the panel was told it
// "left no reason").
func (s *Subprocess) ExitReason() string {
	s.mu.Lock()
	set, err, stderr := s.lastExitSet, s.lastExit, s.stderr
	s.mu.Unlock()
	if !set {
		return ""
	}
	reason := "exited cleanly"
	if err != nil {
		reason = err.Error()
	}
	if stderr != nil {
		if line := stderr.lastLine(); line != "" {
			reason += "; last stderr line: " + line
		}
	}
	return reason
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
	// last is the most recent non-empty complete line, for ExitReason.
	last string
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
		if t := strings.TrimSpace(line); t != "" {
			w.last = t
		}
		w.logger.Log(context.Background(), w.level, line, "source", w.source)
	}
	return len(p), nil
}

// lastLine is the most recent line, or the unterminated tail when the process
// died mid-line, which is how a crash often leaves its last words.
func (w *logWriter) lastLine() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	if t := strings.TrimSpace(string(w.buf)); t != "" {
		return t
	}
	return w.last
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
