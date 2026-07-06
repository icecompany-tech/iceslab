package mtproto

import (
	"strings"
	"testing"
)

func TestDeriveSecret_DeterministicAndShape(t *testing.T) {
	inboundID := "inbound-uuid-1"
	domain := "www.cloudflare.com"

	a := DeriveSecret(inboundID, domain)
	b := DeriveSecret(inboundID, domain)
	if a != b {
		t.Errorf("DeriveSecret should be deterministic: %q vs %q", a, b)
	}
	if !strings.HasPrefix(a, "ee") {
		t.Errorf("Secret must start with `ee` (Fake-TLS marker): %q", a)
	}
	// `ee` (2) + 16-byte secret hex (32) + domain hex (len(domain)*2)
	expectedLen := 2 + 32 + len(domain)*2
	if len(a) != expectedLen {
		t.Errorf("Secret length: got %d want %d", len(a), expectedLen)
	}
}

func TestDeriveSecret_DomainChangeRotates(t *testing.T) {
	a := DeriveSecret("inbound-1", "www.cloudflare.com")
	b := DeriveSecret("inbound-1", "www.google.com")
	if a == b {
		t.Errorf("Domain change MUST rotate the secret")
	}
	// Both head AND tail differ, head because the seed `inboundID:domain`
	// includes the domain, tail because the domain hex is appended.
}

func TestDeriveSecret_DifferentInboundsDifferentSecrets(t *testing.T) {
	a := DeriveSecret("inbound-1", "www.cloudflare.com")
	b := DeriveSecret("inbound-2", "www.cloudflare.com")
	if a == b {
		t.Errorf("Different inbound IDs must produce different secrets")
	}
}

func TestInboundValidation(t *testing.T) {
	cases := []struct {
		name    string
		mut     func(*InboundConfig)
		wantErr string
	}{
		{"missing domain", func(c *InboundConfig) { c.Domain = "" }, "Domain is required"},
		{"slash in domain", func(c *InboundConfig) { c.Domain = "evil/path" }, "forbidden"},
		{"colon in domain", func(c *InboundConfig) { c.Domain = "h:p" }, "forbidden"},
		{"missing secret", func(c *InboundConfig) { c.Secret = "" }, "Secret is required"},
		{"secret without ee prefix", func(c *InboundConfig) { c.Secret = "deadbeef" }, "must start with"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := InboundConfig{
				Domain: "www.cloudflare.com",
				Secret: DeriveSecret("inbound-1", "www.cloudflare.com"),
			}
			tc.mut(&cfg)
			if err := cfg.validate(); err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validate: got %v want error containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestInboundDefaults(t *testing.T) {
	cfg := (&InboundConfig{}).withDefaults()
	if cfg.Domain != "www.cloudflare.com" {
		t.Errorf("Domain default: got %q", cfg.Domain)
	}
	if cfg.ListenPort != 443 {
		t.Errorf("ListenPort default: got %d", cfg.ListenPort)
	}
	if cfg.StatsPort != 3129 {
		t.Errorf("StatsPort default: got %d", cfg.StatsPort)
	}
}

func TestRenderConfig_TomlShape_MatchesUpstream(t *testing.T) {
	// Schema verified against 9seconds/mtg/example.config.toml on
	// 2026-05-07. Critical: SINGLE `secret = "..."` (mtg rejects
	// `secrets = [...]` arrays); stats are nested in `[stats.prometheus]`,
	// NOT a flat `stats-bind-to` key.
	domain := "www.cloudflare.com"
	secret := DeriveSecret("inbound-1", domain)
	cfg := InboundConfig{
		Domain: domain, Secret: secret, ListenPort: 443, StatsPort: 3129,
	}
	blob, err := renderConfig(cfg)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	out := string(blob)

	for _, want := range []string{
		`secret = "` + secret + `"`,
		`bind-to = "0.0.0.0:443"`,
		`prefer-ip = "prefer-ipv4"`,
		`[stats.prometheus]`,
		`enabled = true`,
		`bind-to = "127.0.0.1:3129"`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing fragment %q in render:\n%s", want, out)
		}
	}

	// Anti-regression: must NOT emit the array form mtg rejects, nor the
	// flat stats key from an earlier broken iteration.
	for _, banned := range []string{
		`secrets = [`,
		`stats-bind-to = "`,
		`network-timeout = "`,
	} {
		if strings.Contains(out, banned) {
			t.Errorf("forbidden fragment %q in render (upstream schema mismatch):\n%s", banned, out)
		}
	}
}

func TestRenderConfig_RequiresSecret(t *testing.T) {
	_, err := renderConfig(InboundConfig{Domain: "www.cloudflare.com"})
	if err == nil || !strings.Contains(err.Error(), "Secret is required") {
		t.Errorf("expected Secret-required error, got %v", err)
	}
}
