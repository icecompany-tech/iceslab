package shadowsocks

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"sort"
	"sync"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

const Name = "shadowsocks"

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

	mu      sync.Mutex
	users   map[string]ssClient // key: userId
	started bool

	proc *subprocess.Subprocess
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
	defer a.mu.Unlock()
	if a.cfg.Inbound.Method == "" {
		a.logger.Info("shadowsocks adapter: no Method yet — waiting for ApplyInbound from panel")
		return nil
	}
	return a.regenerateAndRestartLocked(ctx)
}

// Stop terminates the subprocess. The on-disk config is left in place.
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

// AddUser registers a user. We use user.XrayUUID as the SS password —
// matches what the panel emits in subscription URIs (see slice 24d notes).
// Idempotent.
func (a *Adapter) AddUser(user core.User) error {
	if user.XrayUUID == "" {
		// User has no shared credential — nothing to add for SS either.
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	desired := ssClient{Password: user.XrayUUID, Email: user.UserID}
	if existing, ok := a.users[user.UserID]; ok && existing == desired {
		return nil
	}
	a.users[user.UserID] = desired
	if !a.started {
		// Not started yet — Method might not be configured. Cache the user
		// and let Start/ApplyInbound flush it later.
		return nil
	}
	return a.regenerateAndRestartLocked(context.Background())
}

func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.users[userID]; !ok {
		return nil
	}
	delete(a.users, userID)
	if !a.started {
		return nil
	}
	return a.regenerateAndRestartLocked(context.Background())
}

// inboundCfgWire mirrors `ShadowsocksInboundCfg` in
// packages/shared/src/transport.ts.
type inboundCfgWire struct {
	Method    string `json:"method"`
	ServerPSK string `json:"serverPsk"`
}

// ApplyInbound parses the panel-pushed SS config, swaps it into the live
// adapter's InboundConfig, and regenerates+restarts xray. Idempotent.
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	// TODO(slice 50, wave-13 audit): wire `port` into the SS2022 inbound
	// rendered inside xray-core config. Install-time port stays
	// authoritative for now.
	_ = port
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
	defer a.mu.Unlock()

	if a.cfg.Inbound.Method == wire.Method && a.cfg.Inbound.ServerPSK == wire.ServerPSK {
		a.logger.Info("shadowsocks ApplyInbound: config unchanged, skipping restart")
		return nil
	}

	a.cfg.Inbound.Method = wire.Method
	a.cfg.Inbound.ServerPSK = wire.ServerPSK
	a.logger.Info("shadowsocks ApplyInbound: config changed, regenerating + restarting",
		"method", wire.Method)
	return a.regenerateAndRestartLocked(context.Background())
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

// regenerateAndRestartLocked must be called with a.mu held.
func (a *Adapter) regenerateAndRestartLocked(ctx context.Context) error {
	clients := sortedClients(a.users)
	blob, err := renderConfig(a.cfg.Inbound, clients)
	if err != nil {
		return fmt.Errorf("render shadowsocks config: %w", err)
	}
	if a.cfg.ConfigPath != "" {
		if err := writeConfig(a.cfg.ConfigPath, blob); err != nil {
			return err
		}
	}
	if a.cfg.BinaryPath == "" {
		a.started = true
		a.logger.Info("shadowsocks config written (config-only mode)", "users", len(clients))
		return nil
	}

	if a.proc != nil {
		_ = a.proc.Stop(ctx)
		a.proc = nil
	}
	proc := subprocess.New(subprocess.Config{
		Name:   Name,
		Binary: a.cfg.BinaryPath,
		Args:   []string{"run", "-c", a.cfg.ConfigPath},
		Logger: a.logger,
	})
	if err := proc.Start(ctx); err != nil {
		return fmt.Errorf("start shadowsocks (xray): %w", err)
	}
	a.proc = proc
	a.started = true
	a.logger.Info("shadowsocks (xray) (re)started", "users", len(clients), "method", a.cfg.Inbound.Method)
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
