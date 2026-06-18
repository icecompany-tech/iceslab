package shadowsocks

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

const Name = "shadowsocks"

// apiCallTimeout caps the live HandlerService calls (`xray api adu`/`rmu`).
const apiCallTimeout = 5 * time.Second

// Config is the per-instance settings for a ShadowsocksAdapter.
type Config struct {
	// BinaryPath to the `xray` executable (we share xray-core for SS).
	// If empty, the adapter runs in config-only mode.
	BinaryPath string

	// ConfigPath is where the generated config.json is written.
	ConfigPath string

	// Inbound is the SS inbound's static settings.
	Inbound InboundConfig

	// RunCmd is the injectable command runner for `xray api statsquery`.
	// Defaults to os/exec; tests inject a fake.
	RunCmd RunCmdFunc
}

// RunCmdFunc executes an external command synchronously, returning combined
// output. Mirrors the type used by other adapters for consistency.
type RunCmdFunc func(ctx context.Context, name string, args ...string) ([]byte, error)

type Adapter struct {
	cfg    Config
	logger *slog.Logger

	// mu protects in-memory state; held only for fast ops. The slow
	// render + subprocess Stop/Start runs under restartMu so Healthy()/
	// GetStats never block behind a restart. Bug #1.
	mu      sync.Mutex
	users   map[string]ssClient // key: userId
	started bool

	proc *subprocess.Subprocess

	// restartMu serializes regenerateAndRestart; never held with mu across IO.
	restartMu sync.Mutex
}

func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.RunCmd == nil {
		cfg.RunCmd = defaultRunCmd
	}
	return &Adapter{
		cfg:    cfg,
		logger: logger,
		users:  make(map[string]ssClient),
	}
}

func defaultRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

func (a *Adapter) Name() string { return Name }

// Start writes the initial config and spawns xray. If the inbound has no
// Method set (deferred via ApplyInbound), Start is a no-op.
func (a *Adapter) Start(ctx context.Context) error {
	a.mu.Lock()
	noMethod := a.cfg.Inbound.Method == ""
	a.mu.Unlock()
	if noMethod {
		a.logger.Info("shadowsocks adapter: no Method yet — waiting for ApplyInbound from panel")
		return nil
	}
	return a.regenerateAndRestart(ctx)
}

// Stop terminates the subprocess. The on-disk config is left in place. Reads +
// clears the shared fields under a.mu, then does the slow proc.Stop with the
// lock released so Healthy()/GetStats never block behind it (Bug #1).
func (a *Adapter) Stop(ctx context.Context) error {
	a.mu.Lock()
	a.started = false
	proc := a.proc
	a.proc = nil
	a.mu.Unlock()

	if proc == nil {
		return nil
	}
	return proc.Stop(ctx)
}

// AddUser registers a user. We use user.XrayUUID as the SS password —
// matches what the panel emits in subscription URIs (see slice 24d notes).
// Idempotent.
func (a *Adapter) AddUser(user core.User) error {
	if user.XrayUUID == "" {
		// User has no shared credential — nothing to add for SS either.
		return nil
	}
	a.mu.Lock()
	desired := ssClient{Password: user.XrayUUID, Email: user.UserID}
	if existing, ok := a.users[user.UserID]; ok && existing == desired {
		a.mu.Unlock()
		return nil
	}
	a.users[user.UserID] = desired
	started := a.started
	a.mu.Unlock()
	if !started {
		// Not started yet — Method might not be configured. Cache the user
		// and let Start/ApplyInbound flush it later.
		return nil
	}
	// N1 - live add via xray's HandlerService (SS rides xray-core); fall back
	// to a full restart if it isn't possible.
	if a.liveUpdateUser(context.Background(), liveAdd, desired) {
		return nil
	}
	return a.regenerateAndRestart(context.Background())
}

func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	removed, ok := a.users[userID]
	if !ok {
		a.mu.Unlock()
		return nil
	}
	delete(a.users, userID)
	started := a.started
	a.mu.Unlock()
	if !started {
		return nil
	}
	if a.liveUpdateUser(context.Background(), liveRemove, removed) {
		return nil
	}
	return a.regenerateAndRestart(context.Background())
}

type liveOp int

const (
	liveAdd liveOp = iota
	liveRemove
)

// buildAduInbound renders the JSON `xray api adu` consumes for a Shadowsocks
// inbound. It MUST be a full config with a top-level "inbounds" array: adu reads
// conf.InboundConfigs (the "inbounds" key), so a bare {tag,protocol,settings}
// object decodes to ZERO inbounds and xray adds nobody yet exits 0 (silent
// no-op). The single inbound carries tag + protocol + a settings block with just
// the one user; buildUserInboundSettings keeps the client shape (password +
// email) identical to the full config.
func buildAduInbound(inbound InboundConfig, target ssClient) ([]byte, error) {
	c := inbound.withDefaults()
	return json.Marshal(map[string]any{
		"inbounds": []any{
			map[string]any{
				"tag":      c.Tag,
				"protocol": "shadowsocks",
				"settings": buildUserInboundSettings(c, []ssClient{target}),
			},
		},
	})
}

// liveUpdateUser adds/removes a single SS user on the RUNNING xray via the
// HandlerService and keeps the on-disk config in sync. Returns true on success;
// false tells the caller to fall back to a restart. restartMu-guarded.
func (a *Adapter) liveUpdateUser(ctx context.Context, op liveOp, target ssClient) bool {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	a.mu.Lock()
	clients := sortedClients(a.users)
	inbound := a.cfg.Inbound
	cfgPath := a.cfg.ConfigPath
	binPath := a.cfg.BinaryPath
	run := a.cfg.RunCmd
	proc := a.proc
	a.mu.Unlock()

	if binPath == "" || run == nil || proc == nil || !proc.Running() {
		return false
	}

	blob, err := renderConfig(inbound, clients)
	if err != nil {
		return false
	}
	if cfgPath != "" {
		if err := writeConfig(cfgPath, blob); err != nil {
			return false
		}
	}

	cfg := inbound.withDefaults()
	cctx, cancel := context.WithTimeout(ctx, apiCallTimeout)
	defer cancel()
	server := fmt.Sprintf("--server=127.0.0.1:%d", cfg.ApiPort)

	switch op {
	case liveAdd:
		data, err := buildAduInbound(inbound, target)
		if err != nil {
			return false
		}
		tmp, err := os.CreateTemp("", "ice-ss-adu-*.json")
		if err != nil {
			return false
		}
		tmpPath := tmp.Name()
		defer os.Remove(tmpPath)
		if _, err := tmp.Write(data); err != nil {
			_ = tmp.Close()
			return false
		}
		if err := tmp.Close(); err != nil {
			return false
		}
		out, err := runLiveOp(cctx, run, binPath, "api", "adu", server, tmpPath)
		if err != nil {
			a.logger.Warn("ss api adu failed; falling back to restart",
				"email", target.Email, "err", err, "out", strings.TrimSpace(string(out)))
			return false
		}
		// adu exits 0 even when it adds nobody (bad payload, per-user gRPC error,
		// or a single-user SS inbound that isn't a live UserManager). Trust the
		// "Added N user(s)" count, not the exit code, so a silent no-op still
		// falls back to the restart that actually applies the user.
		if !liveOpSucceeded(out, "Added") {
			a.logger.Warn("ss api adu added no user (exit 0); falling back to restart",
				"email", target.Email, "out", strings.TrimSpace(string(out)))
			return false
		}
		a.logger.Info("shadowsocks user added live (no restart)", "email", target.Email)
		return true
	case liveRemove:
		out, err := runLiveOp(cctx, run, binPath, "api", "rmu", server, "-tag="+cfg.Tag, target.Email)
		if err != nil {
			a.logger.Warn("ss api rmu failed; falling back to restart",
				"email", target.Email, "err", err, "out", strings.TrimSpace(string(out)))
			return false
		}
		if !liveOpSucceeded(out, "Removed") {
			a.logger.Warn("ss api rmu removed no user (exit 0); falling back to restart",
				"email", target.Email, "out", strings.TrimSpace(string(out)))
			return false
		}
		a.logger.Info("shadowsocks user removed live (no restart)", "email", target.Email)
		return true
	default:
		return false
	}
}

// runLiveOp runs an `xray api` subcommand, retrying briefly on a process-level
// failure. Right after a restart xray is up (proc.Running()) but may not yet be
// listening on the loopback api port, so the first adu/rmu gets connection-
// refused; a short bounded retry rides out that window instead of falling back
// to a connection-dropping restart. The caller's context caps total time.
func runLiveOp(ctx context.Context, run RunCmdFunc, binary string, args ...string) ([]byte, error) {
	var out []byte
	var err error
	for attempt := 0; attempt < 6; attempt++ {
		out, err = run(ctx, binary, args...)
		if err == nil {
			return out, nil
		}
		select {
		case <-ctx.Done():
			return out, err
		case <-time.After(250 * time.Millisecond):
		}
	}
	return out, err
}

// liveOpSucceeded parses xray's "<verb> N user(s) in total." summary line and
// reports whether N >= 1. `xray api adu`/`rmu` print per-user errors but still
// exit 0, so the exit code is not a success signal; the count is. verb is
// "Added" (adu) or "Removed" (rmu).
func liveOpSucceeded(out []byte, verb string) bool {
	s := string(out)
	idx := strings.Index(s, verb+" ")
	if idx < 0 {
		return false
	}
	rest := s[idx+len(verb)+1:]
	n, seen := 0, false
	for i := 0; i < len(rest) && rest[i] >= '0' && rest[i] <= '9'; i++ {
		n = n*10 + int(rest[i]-'0')
		seen = true
	}
	return seen && n >= 1
}

// inboundCfgWire mirrors `ShadowsocksInboundCfg` in
// packages/shared/src/transport.ts.
type inboundCfgWire struct {
	Method    string `json:"method"`
	ServerPSK string `json:"serverPsk"`
}

// ApplyInbound parses the panel-pushed SS config, swaps it into the live
// adapter's InboundConfig, and regenerates+restarts xray. Idempotent.
//
// Wave-14 C1: port now flows from the panel binding through to the SS2022
// listen port. Pre-wave port was install-time only and admin port changes
// from the UI were silently dropped (TODO marker remained from slice 50).
// Fallback chain: panel-pushed port → install-time ListenPort → 8388
// (SS historic default, applied by withDefaults at render).
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("shadowsocks ApplyInbound: parse cfg: %w", err)
	}
	if wire.Method == "" {
		return fmt.Errorf("shadowsocks ApplyInbound: method is required")
	}
	if wire.ServerPSK == "" {
		return fmt.Errorf("shadowsocks ApplyInbound: serverPsk is required")
	}

	a.mu.Lock()
	effectivePort := port
	if effectivePort == 0 {
		effectivePort = a.cfg.Inbound.ListenPort
	}
	if a.cfg.Inbound.Method == wire.Method &&
		a.cfg.Inbound.ServerPSK == wire.ServerPSK &&
		a.cfg.Inbound.ListenPort == effectivePort {
		a.mu.Unlock()
		a.logger.Info("shadowsocks ApplyInbound: config unchanged, skipping restart")
		return nil
	}

	a.cfg.Inbound.Method = wire.Method
	a.cfg.Inbound.ServerPSK = wire.ServerPSK
	if effectivePort != 0 {
		a.cfg.Inbound.ListenPort = effectivePort
	}
	newPort := a.cfg.Inbound.ListenPort
	a.mu.Unlock()
	a.logger.Info("shadowsocks ApplyInbound: config changed, regenerating + restarting",
		"method", wire.Method, "port", newPort)
	return a.regenerateAndRestart(context.Background())
}

// GetStats reports per-user SS byte counters via xray's StatsService.
// Same mechanism as the xray adapter (slice 24c part 1) — `xray api
// statsquery -reset` over the loopback gRPC inbound. Soft-fails to zero
// counters on error so a transient stats failure doesn't stall the panel
// poller for the rest of the node's adapters.
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.Lock()
	binary := a.cfg.BinaryPath
	apiPort := a.cfg.Inbound.ApiPort
	if apiPort == 0 {
		apiPort = 8081
	}
	users := make([]core.UserStats, 0, len(a.users))
	for id := range a.users {
		users = append(users, core.UserStats{UserID: id})
	}
	run := a.cfg.RunCmd
	a.mu.Unlock()

	if binary == "" || run == nil {
		return &core.Stats{Users: users}, nil
	}

	// Cycle #6 (2026-05-12) — the SS adapter is registered whenever
	// XRAY_BINARY is set (because SS rides the xray binary), even on nodes
	// that don't actually run an SS inbound. Polling stats every cron tick
	// then hits `failed to dial 127.0.0.1:8081 (xray api inbound not up)`
	// and spammed `WARN shadowsocks GetStats: statsquery failed` every 30s
	// forever. Short-circuit when there are no SS users to query — that's
	// the only state we'd ever populate, so an empty stats response is
	// semantically identical AND we never hit the dead API port.
	if len(users) == 0 {
		return &core.Stats{Users: users}, nil
	}

	counters, err := queryUserStats(context.Background(), run, binary, apiPort)
	if err != nil {
		// Demote to Debug — operators on hysteria-only nodes shouldn't see
		// SS-stats failures in their default `journalctl -u iceslab-node`
		// view; the adapter is registered defensively for "maybe an SS
		// inbound shows up later" and stats noise is operationally
		// meaningless until the inbound exists.
		a.logger.Debug("shadowsocks GetStats: statsquery failed", "err", err)
		return &core.Stats{Users: users}, nil
	}

	out := make([]core.UserStats, 0, len(users))
	var totalIn, totalOut int64
	for _, u := range users {
		c := counters[u.UserID]
		out = append(out, core.UserStats{
			UserID:   u.UserID,
			BytesIn:  c.UplinkBytes,
			BytesOut: c.DownlinkBytes,
		})
		totalIn += c.UplinkBytes
		totalOut += c.DownlinkBytes
	}
	return &core.Stats{
		Users:         out,
		TotalBytesIn:  totalIn,
		TotalBytesOut: totalOut,
	}, nil
}

func (a *Adapter) Healthy() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.started {
		return false
	}
	if a.cfg.BinaryPath == "" {
		return true
	}
	return a.proc != nil && a.proc.Running()
}

// regenerateAndRestart renders config + (re)starts the subprocess. Bug #1:
// must NOT be called with a.mu held. restartMu serializes restarts; a.mu is
// taken only for the snapshot + final proc swap so Healthy()/GetStats don't
// block behind the multi-second Stop/Start.
func (a *Adapter) regenerateAndRestart(ctx context.Context) error {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	a.mu.Lock()
	clients := sortedClients(a.users)
	inbound := a.cfg.Inbound
	cfgPath := a.cfg.ConfigPath
	binPath := a.cfg.BinaryPath
	a.mu.Unlock()

	blob, err := renderConfig(inbound, clients)
	if err != nil {
		return fmt.Errorf("render shadowsocks config: %w", err)
	}
	if cfgPath != "" {
		if err := writeConfig(cfgPath, blob); err != nil {
			return err
		}
	}
	if binPath == "" {
		a.mu.Lock()
		a.started = true
		a.mu.Unlock()
		a.logger.Info("shadowsocks config written (config-only mode)", "users", len(clients))
		return nil
	}

	a.mu.Lock()
	old := a.proc
	a.mu.Unlock()
	if old != nil {
		_ = old.Stop(ctx)
	}
	proc := subprocess.New(subprocess.Config{
		Name:           Name,
		Binary:         binPath,
		Args:           []string{"run", "-c", cfgPath},
		Logger:         a.logger,
		MaxRestarts:    subprocess.DefaultMaxRestarts,
		RestartBackoff: subprocess.DefaultRestartBackoff,
	})
	if err := proc.Start(ctx); err != nil {
		a.mu.Lock()
		a.proc = nil
		a.mu.Unlock()
		return fmt.Errorf("start shadowsocks (xray): %w", err)
	}
	a.mu.Lock()
	a.proc = proc
	a.started = true
	a.mu.Unlock()
	a.logger.Info("shadowsocks (xray) (re)started", "users", len(clients), "method", inbound.Method)
	return nil
}

func sortedClients(in map[string]ssClient) []ssClient {
	out := make([]ssClient, 0, len(in))
	for _, c := range in {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Email < out[j].Email })
	return out
}
