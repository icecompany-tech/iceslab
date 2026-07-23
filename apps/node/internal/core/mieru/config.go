// Package mieru implements CoreAdapter for the Mieru stealth proxy via
// the `mita` server binary (enfein/mieru). Slice 40.
//
// Architecture:
//   - mita is a single Go binary running as its own systemd unit; the
//     adapter doesn't spawn it directly. mita stores its config as
//     binary protobuf at `/etc/mita/server.conf.pb`; admins (and us)
//     update it by writing a JSON config and invoking
//     `mita apply config <path.json>`.
//   - Multi-user via a `users` array inside the JSON; mita's `reload`
//     subcommand applies user-list changes without dropping sessions.
//   - Per-user creds: name = panel username, password = xrayUuid (no
//     extra credential surface).
//
// Verified against `enfein/mieru/docs/operation.md` (and
// `docs/server-install.md`) on 2026-05-07. Config is JSON, NOT YAML:
// an earlier iteration of this file emitted YAML and was wrong.
package mieru

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
	"sort"
)

// User represents one mita user (name + password).
type User struct {
	Name     string `json:"name"`
	Password string `json:"password"`
}

// InboundConfig holds per-instance settings.
type InboundConfig struct {
	// ListenPort is the public TCP+UDP port. Default 2012.
	ListenPort int

	// MTU caps the inner-payload size. Default 1400; drop to 1280 on
	// PPPoE / weird VPN paths.
	MTU int

	// LoggingLevel: INFO sane default; DEBUG logs per-connection events
	// (don't enable in prod, very noisy).
	LoggingLevel string
}

func (c *InboundConfig) withDefaults() InboundConfig {
	out := *c
	if out.ListenPort == 0 {
		out.ListenPort = 2012
	}
	if out.MTU == 0 {
		out.MTU = 1400
	}
	if out.LoggingLevel == "" {
		out.LoggingLevel = "INFO"
	}
	return out
}

func (c *InboundConfig) validate() error {
	// Upstream minimum is 1280 (per docs/operation.md); 1500 is the
	// hard ceiling for typical Ethernet path-MTU.
	if c.MTU != 0 && (c.MTU < 1280 || c.MTU > 1500) {
		return fmt.Errorf("MTU %d out of range (1280-1500)", c.MTU)
	}
	if c.LoggingLevel != "" {
		switch c.LoggingLevel {
		case "DEBUG", "INFO", "WARN", "ERROR":
		default:
			return fmt.Errorf("LoggingLevel %q not in DEBUG/INFO/WARN/ERROR", c.LoggingLevel)
		}
	}
	return nil
}

// portBinding mirrors mita's JSON config schema.
type portBinding struct {
	Port     int    `json:"port"`
	Protocol string `json:"protocol"` // "TCP" or "UDP"
}

// jsonUser is what mita's `users` array element looks like. We only
// emit the required fields; mita supports `allowPrivateIP`,
// `allowLoopbackIP`, and `quotas[]` per-user, but the panel doesn't
// surface those today.
type jsonUser struct {
	Name     string `json:"name"`
	Password string `json:"password"`
}

type serverConfig struct {
	PortBindings []portBinding `json:"portBindings"`
	Users        []jsonUser    `json:"users"`
	MTU          int           `json:"mtu"`
	LoggingLevel string        `json:"loggingLevel"`
}

// renderConfig produces a deterministic mita JSON config. mita applies
// the file via `mita apply config <path.json>` and stores the result
// internally as protobuf at `/etc/mita/server.conf.pb`, we never see
// or touch that file directly.
func renderConfig(inbound InboundConfig, users []User) ([]byte, error) {
	if err := inbound.validate(); err != nil {
		return nil, err
	}
	cfg := inbound.withDefaults()

	jsonUsers := make([]jsonUser, 0, len(users))
	for _, u := range users {
		if u.Name == "" {
			return nil, errors.New("mieru: empty user name")
		}
		if u.Password == "" {
			return nil, errors.New("mieru: empty user password")
		}
		jsonUsers = append(jsonUsers, jsonUser{Name: u.Name, Password: u.Password})
	}

	doc := serverConfig{
		PortBindings: []portBinding{
			{Port: cfg.ListenPort, Protocol: "TCP"},
			{Port: cfg.ListenPort, Protocol: "UDP"},
		},
		Users:        jsonUsers,
		MTU:          cfg.MTU,
		LoggingLevel: cfg.LoggingLevel,
	}
	return json.MarshalIndent(doc, "", "  ")
}

// writeConfig atomically writes mita's JSON via the shared atomicfile
// helper (fsync(file) + fsync(dir)). Mode 0o600, file contains every
// user's password.
func writeConfig(path string, blob []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	return atomicfile.Write(path, blob, 0o600)
}

// sortedUsers returns users in deterministic order (by name) so renderConfig
// is byte-stable across map iterations.
func sortedUsers(in map[string]User) []User {
	out := make([]User, 0, len(in))
	for _, u := range in {
		out = append(out, u)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
