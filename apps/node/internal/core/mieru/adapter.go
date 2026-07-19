package mieru

import (
	"context"
	"crypto/sha256"
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

	// StatePath stores the panel user ID to Mieru credential mapping across
	// node-agent restarts. The generated mita config cannot restore panel IDs.
	StatePath string

	// Inbound is the static settings (listen port, MTU, logging).
	Inbound InboundConfig

	// RunCmd is the injectable command runner used by AddUser/RemoveUser/
	// ApplyInbound to invoke `mita apply config`, `mita reload`, and `mita start`. Defaults
	// to os/exec; tests inject a fake.
	RunCmd RunCmdFunc
}

// RunCmdFunc executes an external command. Mirrors other adapters.
type RunCmdFunc func(ctx context.Context, name string, args ...string) ([]byte, error)

type Adapter struct {
	cfg    Config
	logger *slog.Logger

	// mu protects in-memory state; held only for fast ops. The slow render +
	// `mita apply/reload` CLI runs under restartMu so Healthy()/GetStats don't
	// block behind a reload. Bug #10.
	mu      sync.Mutex
	users   map[string]User // userId → User
	started bool
	// proxyRunning tracks whether this adapter has moved mita's systemd-owned
	// RPC daemon from IDLE to RUNNING.
	proxyRunning bool
	// awaitingSync protects an existing pre-state-file config during the
	// one-time migration until the panel sends the authoritative user list.
	awaitingSync bool
	// N6 - sha256 of the last successfully-applied rendered config. A sync that
	// produces an identical blob skips the two `mita apply/reload` CLI forks.
	renderedHash [32]byte

	// restartMu serializes regenerateAndReload; never held with mu across IO.
	restartMu sync.Mutex
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

// Engine reports the native proxy core (mita; no alternate engine).
func (a *Adapter) Engine() string { return "mieru" }

// Start writes the initial config and brings mita up. We invoke
// `mita apply config <path>` rather than spawning mita directly, mita's
// own systemd unit owns the lifecycle. The adapter just rewrites config
// + tells mita to reload.
//
// In config-only mode (BinaryPath empty) Start writes the JSON and stops
// there, useful for tests and for dev hosts without mita installed.
func (a *Adapter) Start(ctx context.Context) error {
	stateFound, err := a.loadState()
	if err != nil {
		return err
	}
	if !stateFound && a.cfg.StatePath != "" {
		migrated, err := a.startExistingConfig(ctx)
		if err != nil {
			return err
		}
		if migrated {
			return nil
		}
	}

	a.mu.Lock()
	noUsers := len(a.users) == 0
	if noUsers {
		a.started = true
	}
	a.mu.Unlock()
	if noUsers {
		a.logger.Info("mieru waiting for the first panel user sync")
		return nil
	}
	return a.regenerateAndReload(ctx)
}

func (a *Adapter) Stop(_ context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.started = false
	// mita is owned by its systemd unit. Leaving it running keeps user traffic
	// alive during a node-agent restart or upgrade.
	return nil
}

// AddUser registers a user in mita's user list. Idempotent.
//
// Reload is graceful, existing sessions survive; new connections use the
// updated user list.
func (a *Adapter) AddUser(user core.User) error {
	if user.XrayUUID == "" || user.Username == "" {
		return nil
	}
	a.mu.Lock()
	desired := User{Name: user.Username, Password: user.XrayUUID}
	if existing, ok := a.users[user.UserID]; ok && existing == desired {
		a.mu.Unlock()
		return nil
	}
	previous, existed := a.users[user.UserID]
	previousAwaitingSync := a.awaitingSync
	a.users[user.UserID] = desired
	a.awaitingSync = false
	if err := a.persistStateLocked(); err != nil {
		if existed {
			a.users[user.UserID] = previous
		} else {
			delete(a.users, user.UserID)
		}
		a.awaitingSync = previousAwaitingSync
		a.mu.Unlock()
		return err
	}
	started := a.started
	a.mu.Unlock()
	if !started {
		return nil
	}
	return a.regenerateAndReload(context.Background())
}

func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	removed, ok := a.users[userID]
	if !ok {
		a.mu.Unlock()
		return nil
	}
	delete(a.users, userID)
	if err := a.persistStateLocked(); err != nil {
		a.users[userID] = removed
		a.mu.Unlock()
		return err
	}
	started := a.started
	a.mu.Unlock()
	if !started {
		return nil
	}
	return a.regenerateAndReload(context.Background())
}

// inboundCfgWire mirrors `MieruInboundCfg` in shared/transport.ts.
type inboundCfgWire struct {
	MTU int `json:"mtu"`
}

// ApplyInbound updates the inbound settings (MTU + port). MTU change is
// non-disruptive, existing sessions keep their negotiated MTU until
// reconnect. Port change DOES restart the listener (new socket bind).
//
// Wave-14 C1: port now flows from the panel binding to mieru's portBindings.
// Pre-wave port was install-time only and admin port changes from the UI
// were silently dropped. Fallback chain:
//
//	panel-pushed port → install-time ListenPort → 2012 (mieru default).
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("mieru ApplyInbound: parse cfg: %w", err)
	}

	a.mu.Lock()
	effectivePort := port
	if effectivePort == 0 {
		effectivePort = a.cfg.Inbound.ListenPort
	}
	if a.cfg.Inbound.MTU == wire.MTU && a.cfg.Inbound.ListenPort == effectivePort {
		a.mu.Unlock()
		a.logger.Info("mieru ApplyInbound: config unchanged, skipping")
		return nil
	}
	a.cfg.Inbound.MTU = wire.MTU
	if effectivePort != 0 {
		a.cfg.Inbound.ListenPort = effectivePort
	}
	newPort := a.cfg.Inbound.ListenPort
	awaitingSync := a.awaitingSync && len(a.users) == 0
	a.mu.Unlock()
	a.logger.Info("mieru ApplyInbound: config changed",
		"mtu", wire.MTU, "port", newPort)
	if awaitingSync {
		a.logger.Info("mieru preserving existing config until panel user sync")
		return nil
	}
	return a.regenerateAndReload(context.Background())
}

// GetStats returns tracked users with zero counters. mita exposes
// `mita get-metrics --output json` for real numbers, wiring that
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

// regenerateAndReload renders config + runs `mita apply/reload`. Bug #10:
// must NOT be called with a.mu held. restartMu serializes reloads; a.mu is
// taken only for the snapshot + the final started flag so Healthy()/GetStats
// don't block behind the multi-second CLI calls.
func (a *Adapter) regenerateAndReload(ctx context.Context) error {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	a.mu.Lock()
	users := sortedUsers(a.users)
	inbound := a.cfg.Inbound
	cfgPath := a.cfg.ConfigPath
	binPath := a.cfg.BinaryPath
	run := a.cfg.RunCmd
	wasProxyRunning := a.proxyRunning
	a.mu.Unlock()

	blob, err := renderConfig(inbound, users)
	if err != nil {
		return fmt.Errorf("render mieru config: %w", err)
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
		a.logger.Info("mieru config written (config-only mode)", "users", len(users))
		return nil
	}

	// N6 - skip the two CLI forks when the rendered config is byte-identical to
	// the last one we applied. add/remove of an unrelated protocol's users, or a
	// no-op resync, otherwise paid `mita apply` + `mita reload` for nothing.
	hash := sha256.Sum256(blob)
	a.mu.Lock()
	unchanged := a.started && a.renderedHash == hash
	a.mu.Unlock()
	if unchanged {
		if len(users) == 0 || wasProxyRunning {
			a.logger.Debug("mieru config unchanged, skipping mita apply/reload", "users", len(users))
			return nil
		}
		if out, err := run(ctx, binPath, "start"); err != nil {
			return fmt.Errorf("mita start: %w (%s)", err, string(out))
		}
		a.mu.Lock()
		a.proxyRunning = true
		a.mu.Unlock()
		return nil
	}

	// `mita apply config <path>` parses + applies the new config without
	// dropping existing sessions. Then `mita reload` (or just SIGHUP via
	// `mita`) finalises.
	if out, err := run(ctx, binPath, "apply", "config", cfgPath); err != nil {
		return fmt.Errorf("mita apply config: %w (%s)", err, string(out))
	}
	if out, err := run(ctx, binPath, "reload"); err != nil {
		// Reload might be a no-op for some mita versions where `apply
		// config` is sufficient; warn rather than fail.
		a.logger.Warn("mita reload returned non-zero (often safe after apply)",
			"err", err, "out", string(out))
	}
	if len(users) > 0 && !wasProxyRunning {
		// The packaged systemd unit runs mita's RPC daemon, whose proxy starts
		// in IDLE. `start` is idempotent when a previous agent already brought
		// it to RUNNING, so this also handles node-agent restarts safely.
		if out, err := run(ctx, binPath, "start"); err != nil {
			return fmt.Errorf("mita start: %w (%s)", err, string(out))
		}
	}
	if len(users) == 0 && wasProxyRunning {
		if out, err := run(ctx, binPath, "stop"); err != nil {
			return fmt.Errorf("mita stop after last user removal: %w (%s)", err, string(out))
		}
	}

	a.mu.Lock()
	a.started = true
	a.proxyRunning = len(users) > 0
	a.renderedHash = hash
	a.mu.Unlock()
	a.logger.Info("mieru (mita) reloaded", "users", len(users), "mtu", inbound.MTU)
	return nil
}
