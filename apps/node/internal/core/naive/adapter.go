package naive

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

const Name = "naive"

const defaultReloadTimeout = 15 * time.Second

// caddyLivenessGrace is how long N7 waits after spawning caddy before checking
// it's still running, long enough to catch an immediate config/port/ACME exit,
// short enough not to stall the applyInbound RPC.
const caddyLivenessGrace = 1500 * time.Millisecond

// Config is the per-instance settings for a NaiveProxyAdapter.
type Config struct {
	// Inbound is the static Caddyfile settings (hostname, ports, fronting).
	// Slice 23 will move these into the inbounds table per node.
	Inbound InboundConfig

	// CaddyfilePath is where the generated Caddyfile is written. The caddy
	// subprocess is launched with `--config <CaddyfilePath>`; reloads
	// re-read it through `caddy reload`.
	CaddyfilePath string

	// CaddyBin is the path to the Caddy binary built with the
	// klzgrad/forwardproxy@naive plugin (typically /usr/local/bin/caddy-naive
	// produced by bootstrap-naive.sh). Empty → **config-only mode**: the
	// adapter writes the Caddyfile but never spawns or reloads caddy.
	// Useful for tests and dev environments without caddy installed.
	CaddyBin string

	// ReloadTimeout caps how long `caddy reload` may run. Default 15s.
	ReloadTimeout time.Duration

	// runCmd is an injection point for tests. nil → real exec.CommandContext.
	runCmd func(ctx context.Context, name string, args ...string) ([]byte, error)
}

// Adapter implements core.CoreAdapter for NaiveProxy via Caddy.
type Adapter struct {
	cfg    Config
	logger *slog.Logger

	// mu protects in-memory state; held only for fast ops. The slow render +
	// caddy spawn/reload runs under restartMu so Healthy()/GetStats don't
	// block behind a reload. Bug #10.
	mu      sync.Mutex
	users   map[string]User // key: userId
	started bool

	proc *subprocess.Subprocess

	// restartMu serializes regenerateAndReload; never held with mu across IO.
	restartMu sync.Mutex
}

func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.CaddyfilePath == "" {
		cfg.CaddyfilePath = "/etc/caddy/Caddyfile"
	}
	if cfg.ReloadTimeout == 0 {
		cfg.ReloadTimeout = defaultReloadTimeout
	}
	if cfg.runCmd == nil {
		cfg.runCmd = realRunCmd
	}
	return &Adapter{
		cfg:    cfg,
		logger: logger,
		users:  make(map[string]User),
	}
}

func realRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	return out, err
}

func (a *Adapter) Name() string { return Name }

// Engine reports the native proxy core (caddy-naive; no alternate engine).
func (a *Adapter) Engine() string { return "naive" }

// Start either launches caddy now (when bootstrap-time config already has
// Hostname) or defers, same pattern as mtproto/amneziawg adapters that
// wait for the panel's first ApplyInbound before they have enough to
// render a config. Caddy can't open a TLS site without the FQDN (it'd
// fail ACME), and Hostname only arrives via applyInbound (set on the
// panel-side Profile), so deferring is the only sane move at install time.
//
// Caught live cycle #8 2026-05-13: agent crash-looped with
// `render Caddyfile: Hostname is required` because Start tried to render
// before applyInbound landed.
func (a *Adapter) Start(ctx context.Context) error {
	a.mu.Lock()
	noHost := a.cfg.Inbound.Hostname == ""
	a.mu.Unlock()
	if noHost {
		a.logger.Info("naive adapter: hostname not set, waiting for ApplyInbound from panel")
		return nil
	}
	// regenerateAndReload handles the cold-start path (proc==nil → spawn) as
	// well as reload, so Start just delegates.
	return a.regenerateAndReload(ctx)
}

// Stop gracefully terminates caddy. The on-disk Caddyfile is left in place.
func (a *Adapter) Stop(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.started = false
	if a.proc == nil {
		return nil
	}
	err := a.proc.Stop(ctx)
	a.proc = nil
	return err
}

// AddUser registers / updates a user. No-op for users without naive
// credentials. Idempotent.
//
// Note: `caddy reload` is graceful (no session drop), but ALREADY-CONNECTED
// clients keep their session until idle/tunnel timeout (~10 min), that's
// upstream NaiveProxy behaviour, not something we can shortcut. Disabling a
// user blocks new connections only; document this in admin UI (slice 23).
func (a *Adapter) AddUser(user core.User) error {
	if user.NaivePassword == "" {
		return nil
	}
	a.mu.Lock()
	desired := User{Username: user.Username, Password: user.NaivePassword}
	if existing, ok := a.users[user.UserID]; ok && existing == desired {
		a.mu.Unlock()
		return nil
	}
	a.users[user.UserID] = desired
	a.mu.Unlock()
	return a.regenerateAndReload(context.Background())
}

// RemoveUser drops the user from the Caddyfile. Idempotent.
func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	if _, ok := a.users[userID]; !ok {
		a.mu.Unlock()
		return nil
	}
	delete(a.users, userID)
	a.mu.Unlock()
	return a.regenerateAndReload(context.Background())
}

// GetStats returns the tracked user list with zero counters. Per-user stats
// require parsing Caddy access-logs (Phase 3), upstream forwardproxy@naive
// doesn't expose them via API.
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	users := make([]core.UserStats, 0, len(a.users))
	for id := range a.users {
		users = append(users, core.UserStats{UserID: id})
	}
	return &core.Stats{Users: users}, nil
}

// Healthy reports whether caddy is up. In config-only mode (no CaddyBin)
// the adapter is healthy as soon as Start has written the Caddyfile.
func (a *Adapter) Healthy() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.started {
		return false
	}
	if a.cfg.CaddyBin == "" {
		return true
	}
	return a.proc != nil && a.proc.Running()
}

// ApplyInbound parses panel-pushed Naive config, diffs vs the live
// cfg.Inbound, and on change rewrites the Caddyfile + triggers `caddy reload`.
// Reload is graceful, no in-flight session drop, but ALREADY-CONNECTED
// clients keep their session until idle/tunnel timeout (~10 min), that's
// upstream NaiveProxy behaviour, not something we can shortcut.
//
// Idempotent: byte-equivalent input → no-op (no rewrite, no reload).
//
// Hostname change is the gotcha: Caddy will request a fresh Let's Encrypt
// cert for the new FQDN, and LE rate-limits 5 cert-issuances per 7 days per
// FQDN. The adapter doesn't enforce that, UI should warn admins. If the
// limit is hit, `caddy reload` succeeds but new TLS handshakes fail until
// the cooldown.
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("naive ApplyInbound: parse cfg: %w", err)
	}

	a.mu.Lock()
	// Wave-14 C1: port now flows from the panel binding into the Caddyfile
	// site address. Pre-wave port was install-time only (ACME-bound, typically
	// 443) and admin port changes from the UI were silently dropped. Fallback
	// chain: panel-pushed port → install-time ListenPort. Note: changing the
	// port forces caddy to re-ACME-challenge the new socket, which can take
	// 10-30s during the cutover.
	effectivePort := port
	if effectivePort == 0 {
		effectivePort = a.cfg.Inbound.ListenPort
	}
	newInbound := wire.toInboundConfig(effectivePort)
	if inboundEqual(a.cfg.Inbound, newInbound) {
		a.mu.Unlock()
		a.logger.Info("naive ApplyInbound: config unchanged, skipping reload")
		return nil
	}

	a.cfg.Inbound = newInbound
	a.mu.Unlock()
	a.logger.Info("naive ApplyInbound: config changed, regenerating Caddyfile",
		"hostname", newInbound.Hostname,
		"masqueradeRoot", newInbound.MasqueradeRoot)

	// Background context, caller's request may have a short deadline,
	// but we want caddy to come back up even if the caller times out
	// (matches the xray/hysteria/awg adapter pattern).
	return a.regenerateAndReload(context.Background())
}

// regenerateAndReloadLocked must be called with a.mu held. It writes the
// current users-map to the Caddyfile and either:
//   - cold-starts caddy if this is the first ApplyInbound (proc==nil)
//   - tells the running caddy to reload via `caddy reload`, graceful,
//     no session drop, no port re-bind
//
// Cold-start path matters: at install time the agent registers with no
// Hostname (it comes from panel applyInbound), Start() deferred caddy
// spawn. Without this branch the first reload after applyInbound would
// hit "no caddy running, can't reload" and the proxy would never come
// online.
// regenerateAndReload renders the Caddyfile and either cold-starts caddy
// (proc==nil, first ApplyInbound) or `caddy reload`s the running one. Bug #10:
// must NOT be called with a.mu held. restartMu serializes reloads; a.mu is
// taken only for the snapshot + the final proc/started swap so Healthy()/
// GetStats don't block behind the multi-second spawn/reload.
//
// Cold-start path matters: at install time the agent registers with no
// Hostname (it comes from panel applyInbound), Start() deferred caddy spawn.
// Without this branch the first reload after applyInbound would hit "no caddy
// running, can't reload" and the proxy would never come online.
func (a *Adapter) regenerateAndReload(parent context.Context) error {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	a.mu.Lock()
	users := usersSlice(a.users)
	inbound := a.cfg.Inbound
	cfgPath := a.cfg.CaddyfilePath
	bin := a.cfg.CaddyBin
	reloadTimeout := a.cfg.ReloadTimeout
	run := a.cfg.runCmd
	procExists := a.proc != nil
	a.mu.Unlock()

	blob, err := renderCaddyfile(inbound, users)
	if err != nil {
		return fmt.Errorf("render Caddyfile: %w", err)
	}
	if err := writeCaddyfile(cfgPath, blob); err != nil {
		return err
	}

	if bin == "" {
		a.mu.Lock()
		a.started = true
		a.mu.Unlock()
		a.logger.Info("naive Caddyfile written (config-only mode)", "users", len(users))
		return nil
	}

	if !procExists {
		// Cold start: spawn caddy.
		proc := subprocess.New(subprocess.Config{
			Name:           Name,
			Binary:         bin,
			Args:           []string{"run", "--config", cfgPath, "--adapter", "caddyfile"},
			Logger:         a.logger,
			MaxRestarts:    subprocess.DefaultMaxRestarts,
			RestartBackoff: subprocess.DefaultRestartBackoff,
		})
		if err := proc.Start(parent); err != nil {
			return fmt.Errorf("start caddy: %w", err)
		}
		// N7 - Start() only confirms the fork succeeded. caddy can still exit
		// within the first moment on a bad Caddyfile, a port conflict, or an
		// ACME failure. Without this gate we'd flip started=true and the panel
		// would mark the node healthy while nothing is listening. Give it a
		// brief grace, then confirm it's still alive.
		select {
		case <-parent.Done():
		case <-time.After(caddyLivenessGrace):
		}
		if !proc.Running() {
			_ = proc.Stop(parent)
			return fmt.Errorf("caddy exited within %s of start (check Caddyfile / port / ACME)", caddyLivenessGrace)
		}
		a.mu.Lock()
		a.proc = proc
		a.started = true
		a.mu.Unlock()
		a.logger.Info("naive (caddy) started", "config", cfgPath)
		return nil
	}

	ctx, cancel := context.WithTimeout(parent, reloadTimeout)
	defer cancel()
	out, err := run(ctx, bin,
		"reload", "--config", cfgPath, "--adapter", "caddyfile")
	if err != nil {
		return fmt.Errorf("caddy reload: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	a.mu.Lock()
	a.started = true
	a.mu.Unlock()
	a.logger.Info("naive (caddy) reloaded", "users", len(users))
	return nil
}

func usersSlice(in map[string]User) []User {
	out := make([]User, 0, len(in))
	for _, u := range in {
		out = append(out, u)
	}
	return out
}
