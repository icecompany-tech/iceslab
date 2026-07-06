// Package mtproto implements CoreAdapter for the Telegram MTProto proxy
// via 9seconds/mtg. Slice 41.
//
// IMPORTANT: single-secret architecture
// =======================================
// 9seconds/mtg deliberately rejects multi-secret support upstream
// (quote from author: "I think that multiple secrets solve no problems
// and just complex software"). One mtg instance == one secret.
//
// We follow that constraint: every inbound has ONE secret, derived
// deterministically from (inboundId, domain). Every panel user assigned
// to that inbound's squad receives the SAME URI. Consequences:
//
//   - No per-user traffic accounting on the agent side. mtg's Prometheus
//     stats are global, not per-user.
//   - No force-kick of one user, removing them from the panel just stops
//     emitting their URI. Already-saved URIs still work for the lifetime
//     of mtg + that secret.
//   - Domain change rotates the secret, invalidates every cached URI
//     across every user.
//   - For per-user MTProto isolation, run multiple mtg inbounds (one per
//     user-bucket) on different ports. This adapter doesn't manage that,
//     it's a panel-side modelling choice.
//
// Verified against `9seconds/mtg/example.config.toml` and README on
// 2026-05-07. An earlier iteration of this file emitted a `secrets = [...]`
// array which mtg rejects.
package mtproto

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
	"strings"
)

// InboundConfig holds per-inbound settings.
type InboundConfig struct {
	// Domain is the masquerade target for Fake-TLS handshake.
	Domain string

	// Secret is the single mtg secret in mtg's hex format
	// `ee<32-byte-secret-hex><domain-hex>`. Derive via DeriveSecret().
	Secret string

	// ListenPort is the public TCP port mtg binds to. Default 443.
	ListenPort int

	// StatsPort is the loopback Prometheus endpoint port. Default 3129.
	StatsPort int
}

func (c *InboundConfig) withDefaults() InboundConfig {
	out := *c
	if out.Domain == "" {
		out.Domain = "www.cloudflare.com"
	}
	if out.ListenPort == 0 {
		out.ListenPort = 443
	}
	if out.StatsPort == 0 {
		out.StatsPort = 3129
	}
	return out
}

func (c *InboundConfig) validate() error {
	if c.Domain == "" {
		return errors.New("Domain is required")
	}
	for _, ch := range c.Domain {
		if ch == ' ' || ch == '\n' || ch == '/' || ch == ':' {
			return fmt.Errorf("Domain contains forbidden char: %q", c.Domain)
		}
	}
	if c.Secret == "" {
		return errors.New("Secret is required")
	}
	if !strings.HasPrefix(c.Secret, "ee") {
		return fmt.Errorf("Secret must start with `ee` (Fake-TLS marker), got %q", c.Secret[:min(len(c.Secret), 4)])
	}
	// Wave-14 #11: Secret is fmt.Fprintf'd directly into TOML between
	// double-quotes, a stray `"` (or anything TOML treats as escape)
	// would break out of the string and let a hostile/buggy panel push
	// inject arbitrary TOML directives (swap bind-to to loopback, point
	// stats to attacker-controlled, etc). DeriveSecret produces pure hex
	// so the strict alphabet [0-9a-f] is the right whitelist here.
	for _, ch := range c.Secret {
		isHex := (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
		if !isHex {
			return fmt.Errorf("Secret must be all hex chars (got %q in %q)", ch, c.Secret)
		}
	}
	return nil
}

// DeriveSecret produces the per-inbound mtg secret deterministically.
//
// Format (Fake-TLS): `ee<16-byte-secret-hex><hex-encoded-domain>`
//
// The 16-byte length is spec-mandated, the Telegram client (mobile + desktop)
// rejects longer secrets with "Invalid proxy link" / "Некорректная ссылка на
// прокси". Same length upstream `mtg generate-secret` emits. Caught live
// 2026-05-13 on iPhone.
//
// We pass `seed = inboundId` so each inbound gets a unique secret without
// any extra credential storage. Same (inboundId, domain) → same secret;
// domain change rotates the secret tail; deleting and recreating the
// inbound rotates the head. Both panel and agent compute the same value.
func DeriveSecret(inboundID, domain string) string {
	h := sha256.Sum256([]byte(inboundID + ":" + domain))
	return "ee" + hex.EncodeToString(h[:16]) + hex.EncodeToString([]byte(domain))
}

// renderConfig produces the mtg TOML config. Schema verified against
// `9seconds/mtg/example.config.toml` on 2026-05-07.
//
// We hand-write the TOML rather than pulling in `pelletier/go-toml`
// because the surface is small and string output is byte-stable for
// golden-test friendly diffing. Only keys we actually use are emitted,
// mtg accepts a minimal config and uses defaults for everything else.
func renderConfig(inbound InboundConfig) ([]byte, error) {
	if err := inbound.validate(); err != nil {
		return nil, err
	}
	cfg := inbound.withDefaults()

	var b strings.Builder
	fmt.Fprintf(&b, "secret = \"%s\"\n", cfg.Secret)
	fmt.Fprintf(&b, "bind-to = \"0.0.0.0:%d\"\n", cfg.ListenPort)
	fmt.Fprintf(&b, "concurrency = 8192\n")
	fmt.Fprintf(&b, "prefer-ip = \"prefer-ipv4\"\n")
	b.WriteString("\n")

	// Prometheus stats: nested table, NOT a flat `stats-bind-to` key.
	// (An earlier iteration of this file got that wrong.)
	b.WriteString("[stats.prometheus]\n")
	b.WriteString("enabled = true\n")
	fmt.Fprintf(&b, "bind-to = \"127.0.0.1:%d\"\n", cfg.StatsPort)
	b.WriteString("metric-prefix = \"mtg\"\n")

	return []byte(b.String()), nil
}

// writeConfig atomically writes the TOML via the shared atomicfile helper
// (fsync(file) + fsync(dir)). Mode 0o600, file contains the inbound's
// MTProto secret.
func writeConfig(path string, blob []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	return atomicfile.Write(path, blob, 0o600)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
