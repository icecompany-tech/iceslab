package mieru

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
)

const stateVersion = 1

type persistedState struct {
	Version int             `json:"version"`
	Users   map[string]User `json:"users"`
}

// persistStateLocked writes the panel-ID mapping while a.mu is held. The file
// contains credentials, so it uses the same crash-safe 0600 writer as configs.
func (a *Adapter) persistStateLocked() error {
	if a.cfg.StatePath == "" {
		return nil
	}
	state := persistedState{Version: stateVersion, Users: a.users}
	blob, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal mieru state: %w", err)
	}
	dir := filepath.Dir(a.cfg.StatePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir mieru state dir %s: %w", dir, err)
	}
	if err := atomicfile.Write(a.cfg.StatePath, blob, 0o600); err != nil {
		return fmt.Errorf("write mieru state: %w", err)
	}
	return nil
}

func (a *Adapter) loadState() (bool, error) {
	if a.cfg.StatePath == "" {
		return false, nil
	}
	blob, err := os.ReadFile(a.cfg.StatePath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("read mieru state: %w", err)
	}
	var state persistedState
	if err := json.Unmarshal(blob, &state); err != nil {
		return false, fmt.Errorf("parse mieru state: %w", err)
	}
	if state.Version != stateVersion {
		return false, fmt.Errorf("unsupported mieru state version %d", state.Version)
	}
	if state.Users == nil {
		state.Users = make(map[string]User)
	}
	for id, user := range state.Users {
		if id == "" || user.Name == "" || user.Password == "" {
			return false, fmt.Errorf("invalid mieru state user %q", id)
		}
	}

	a.mu.Lock()
	a.users = state.Users
	a.mu.Unlock()
	return true, nil
}

// startExistingConfig is the one-time migration path for nodes installed
// before the durable state file existed. It leaves the live config untouched;
// the next panel binding sync writes authoritative state via AddUser.
func (a *Adapter) startExistingConfig(ctx context.Context) (bool, error) {
	if a.cfg.ConfigPath == "" {
		return false, nil
	}
	blob, err := os.ReadFile(a.cfg.ConfigPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("read existing mieru config: %w", err)
	}
	var existing serverConfig
	if err := json.Unmarshal(blob, &existing); err != nil {
		return false, fmt.Errorf("parse existing mieru config: %w", err)
	}
	if len(existing.Users) == 0 {
		return false, nil
	}
	if a.cfg.BinaryPath != "" {
		if out, err := a.cfg.RunCmd(ctx, a.cfg.BinaryPath, "start"); err != nil {
			return false, fmt.Errorf("mita start existing config: %w (%s)", err, string(out))
		}
	}

	a.mu.Lock()
	a.started = true
	a.proxyRunning = a.cfg.BinaryPath != ""
	a.awaitingSync = true
	a.renderedHash = sha256.Sum256(blob)
	a.mu.Unlock()
	a.logger.Info("mieru preserved existing config while awaiting panel user sync",
		"users", len(existing.Users))
	return true, nil
}
