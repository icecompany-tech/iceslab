package mieru

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"sync"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

const Name = "mieru"

// Config is per-instance settings for the MieruAdapter.
type Config struct {
	// BinaryPath to the `mita` executable. Empty → config-only mode.
	BinaryPath string

	// ConfigPath is where the generated YAML is written. mita reads it via
	// `mita apply config <path>`.
	ConfigPath string

	// Inbound is the static settings (listen port, MTU, logging).
	Inbound InboundConfig

	// RunCmd is the injectable command runner used by AddUser/RemoveUser/
	// ApplyInbound to invoke `mita apply config` and `mita reload`. Defaults
	// to os/exec; tests inject a fake.
	RunCmd RunCmdFunc
}

// RunCmdFunc executes an external command. Mirrors other adapters.
type RunCmdFunc func(ctx context.Context, name string, args ...string) ([]byte, error)

type Adapter struct {
	cfg    Config
	logger *slog.Logger

	mu      sync.Mutex
	users   map[string]User // userId → User
	started bool
}

func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.RunCmd == nil {
		cfg.RunCmd = defaultRunCmd
	}
	return &Adapter{
		cfg:    cfg,
		logger: logger,
		users:  make(map[string]User),
	}
}

func defaultRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

func (a *Adapter) Name() string { return Name }

// Start writes the initial config and brings mita up. We invoke
// `mita apply config <path>` rather than spawning mita directly — mita's
// own systemd unit owns the lifecycle. The adapter just rewrites config
// + tells mita to reload.
//
// In config-only mode (BinaryPath empty) Start writes the YAML and stops
// there — useful for tests and for dev hosts without mita installed.
func (a *Adapter) Start(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.regenerateAndReloadLocked(ctx)
}

func (a *Adapter) Stop(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.started = false
	if a.cfg.BinaryPath == "" {
		return nil
	}
	// Best-effort `mita stop` — if mita is run as a systemd unit, this is
	// a no-op. If it's running standalone, mita exits.
	if _, err := a.cfg.RunCmd(ctx, a.cfg.BinaryPath, "stop"); err != nil {
		a.logger.Warn("mita stop returned non-zero (often safe)", "err", err)
	}
	return nil
}

// AddUser registers a user in mita's user list. Idempotent.
//
// Reload is graceful — existing sessions survive; new connections use the
// updated user list.
func (a *Adapter) AddUser(user core.User) error {
	if user.XrayUUID == "" || user.Username == "" {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	desired := User{Name: user.Username, Password: user.XrayUUID}
	if existing, ok := a.users[user.UserID]; ok && existing == desired {
		return nil
	}
	a.users[user.UserID] = desired
	if !a.started {
		return nil
	}
	return a.regenerateAndReloadLocked(context.Background())
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
	return a.regenerateAndReloadLocked(context.Background())
}

// inboundCfgWire mirrors `MieruInboundCfg` in shared/transport.ts.
type inboundCfgWire struct {
	MTU int `json:"mtu"`
}

// ApplyInbound updates the inbound settings (currently just MTU). MTU
// change is non-disruptive — existing sessions keep their negotiated
// MTU until reconnect.
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	// TODO(slice 50, wave-13 audit): wire `port` into mieru config — until
	// then install-time port is authoritative for this adapter.
	_ = port
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("mieru ApplyInbound: parse cfg: %w", err)
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	if a.cfg.Inbound.MTU == wire.MTU {
		a.logger.Info("mieru ApplyInbound: MTU unchanged, skipping")
		return nil
	}
	a.cfg.Inbound.MTU = wire.MTU
	a.logger.Info("mieru ApplyInbound: MTU changed", "mtu", wire.MTU)
	return a.regenerateAndReloadLocked(context.Background())
}

// GetStats returns tracked users with zero counters. mita exposes
// `mita get-metrics --output json` for real numbers — wiring that
// is a follow-up (mirrors the SS adapter's soft-fail philosophy).
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	users := make([]core.UserStats, 0, len(a.users))
	for id := range a.users {
		users = append(users, core.UserStats{UserID: id})
	}
	return &core.Stats{Users: users}, nil
}

func (a *Adapter) Healthy() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.started
}

func (a *Adapter) regenerateAndReloadLocked(ctx context.Context) error {
	users := sortedUsers(a.users)
	blob, err := renderConfig(a.cfg.Inbound, users)
	if err != nil {
		return fmt.Errorf("render mieru config: %w", err)
	}
	if a.cfg.ConfigPath != "" {
		if err := writeConfig(a.cfg.ConfigPath, blob); err != nil {
			return err
		}
	}
	if a.cfg.BinaryPath == "" {
		a.started = true
		a.logger.Info("mieru config written (config-only mode)", "users", len(users))
		return nil
	}

	// `mita apply config <path>` parses + applies the new config without
	// dropping existing sessions. Then `mita reload` (or just SIGHUP via
	// `mita`) finalises.
	if out, err := a.cfg.RunCmd(ctx, a.cfg.BinaryPath, "apply", "config", a.cfg.ConfigPath); err != nil {
		return fmt.Errorf("mita apply config: %w (%s)", err, string(out))
	}
	if out, err := a.cfg.RunCmd(ctx, a.cfg.BinaryPath, "reload"); err != nil {
		// Reload might be a no-op for some mita versions where `apply
		// config` is sufficient; warn rather than fail.
		a.logger.Warn("mita reload returned non-zero (often safe after apply)",
			"err", err, "out", string(out))
	}

	a.started = true
	a.logger.Info("mieru (mita) reloaded", "users", len(users), "mtu", a.cfg.Inbound.MTU)
	return nil
}
