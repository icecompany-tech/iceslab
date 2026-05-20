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

	mu      sync.Mutex
	users   map[string]User // key: userId
	started bool

	proc *subprocess.Subprocess
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

// Start either launches caddy now (when bootstrap-time config already has
// Hostname) or defers — same pattern as mtproto/amneziawg adapters that
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
	defer a.mu.Unlock()

	if a.cfg.Inbound.Hostname == "" {
		a.logger.Info("naive adapter: hostname not set — waiting for ApplyInbound from panel")
		return nil
	}

	if err := a.writeCurrentCaddyfileLocked(); err != nil {
		return err
	}

	if a.cfg.CaddyBin == "" {
		a.started = true
		a.logger.Info("naive Caddyfile written (config-only mode)")
		return nil
	}

	return a.spawnCaddyLocked(ctx)
}

// spawnCaddyLocked starts the caddy subprocess. Caller must hold a.mu and
// must have ensured the Caddyfile is up to date on disk first.
func (a *Adapter) spawnCaddyLocked(ctx context.Context) error {
	proc := subprocess.New(subprocess.Config{
		Name:   Name,
		Binary: a.cfg.CaddyBin,
		Args:   []string{"run", "--config", a.cfg.CaddyfilePath, "--adapter", "caddyfile"},
		Logger: a.logger,
	})
	if err := proc.Start(ctx); err != nil {
		return fmt.Errorf("start caddy: %w", err)
	}
	a.proc = proc
	a.started = true
	a.logger.Info("naive (caddy) started", "config", a.cfg.CaddyfilePath)
	return nil
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
// clients keep their session until idle/tunnel timeout (~10 min) — that's
// upstream NaiveProxy behaviour, not something we can shortcut. Disabling a
// user blocks new connections only; document this in admin UI (slice 23).
func (a *Adapter) AddUser(user core.User) error {
	if user.NaivePassword == "" {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	desired := User{Username: user.Username, Password: user.NaivePassword}
	if existing, ok := a.users[user.UserID]; ok && existing == desired {
		return nil
	}
	a.users[user.UserID] = desired
	return a.regenerateAndReloadLocked(context.Background())
}

// RemoveUser drops the user from the Caddyfile. Idempotent.
func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.users[userID]; !ok {
		return nil
	}
	delete(a.users, userID)
	return a.regenerateAndReloadLocked(context.Background())
}

// GetStats returns the tracked user list with zero counters. Per-user stats
// require parsing Caddy access-logs (Phase 3) — upstream forwardproxy@naive
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
// Reload is graceful — no in-flight session drop, but ALREADY-CONNECTED
// clients keep their session until idle/tunnel timeout (~10 min) — that's
// upstream NaiveProxy behaviour, not something we can shortcut.
//
// Idempotent: byte-equivalent input → no-op (no rewrite, no reload).
//
// Hostname change is the gotcha: Caddy will request a fresh Let's Encrypt
// cert for the new FQDN, and LE rate-limits 5 cert-issuances per 7 days per
// FQDN. The adapter doesn't enforce that — UI should warn admins. If the
// limit is hit, `caddy reload` succeeds but new TLS handshakes fail until
// the cooldown.
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("naive ApplyInbound: parse cfg: %w", err)
	}

	a.mu.Lock()
	defer a.mu.Unlock()

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
		a.logger.Info("naive ApplyInbound: config unchanged, skipping reload")
		return nil
	}

	a.cfg.Inbound = newInbound
	a.logger.Info("naive ApplyInbound: config changed, regenerating Caddyfile",
		"hostname", newInbound.Hostname,
		"masqueradeRoot", newInbound.MasqueradeRoot)

	// Background context — caller's request may have a short deadline,
	// but we want caddy to come back up even if the caller times out
	// (matches the xray/hysteria/awg adapter pattern).
	return a.regenerateAndReloadLocked(context.Background())
}

// regenerateAndReloadLocked must be called with a.mu held. It writes the
// current users-map to the Caddyfile and either:
//   - cold-starts caddy if this is the first ApplyInbound (proc==nil)
//   - tells the running caddy to reload via `caddy reload` — graceful,
//     no session drop, no port re-bind
//
// Cold-start path matters: at install time the agent registers with no
// Hostname (it comes from panel applyInbound), Start() deferred caddy
// spawn. Without this branch the first reload after applyInbound would
// hit "no caddy running, can't reload" and the proxy would never come
// online.
func (a *Adapter) regenerateAndReloadLocked(parent context.Context) error {
	if err := a.writeCurrentCaddyfileLocked(); err != nil {
		return err
	}

	if a.cfg.CaddyBin == "" {
		a.logger.Info("naive Caddyfile written (config-only mode)", "users", len(a.users))
		return nil
	}

	if a.proc == nil {
		return a.spawnCaddyLocked(parent)
	}

	ctx, cancel := context.WithTimeout(parent, a.cfg.ReloadTimeout)
	defer cancel()
	out, err := a.cfg.runCmd(ctx, a.cfg.CaddyBin,
		"reload", "--config", a.cfg.CaddyfilePath, "--adapter", "caddyfile")
	if err != nil {
		return fmt.Errorf("caddy reload: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	a.logger.Info("naive (caddy) reloaded", "users", len(a.users))
	return nil
}

func (a *Adapter) writeCurrentCaddyfileLocked() error {
	users := usersSlice(a.users)
	blob, err := renderCaddyfile(a.cfg.Inbound, users)
	if err != nil {
		return fmt.Errorf("render Caddyfile: %w", err)
	}
	return writeCaddyfile(a.cfg.CaddyfilePath, blob)
}

func usersSlice(in map[string]User) []User {
	out := make([]User, 0, len(in))
	for _, u := range in {
		out = append(out, u)
	}
	return out
}
