package hysteria

import (
	"strings"
	"testing"
)

func TestRenderConfig_MinimalValid(t *testing.T) {
	cfg := Config{
		Hostname:         "hy2.example.com",
		ACMEEmail:        "admin@example.com",
		AuthCallbackHost: "127.0.0.1",
		AuthCallbackPort: 9000,
		ListenPort:       443,
	}
	blob, err := renderConfig(cfg, InboundConfig{})
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	got := string(blob)
	want := `listen: :443

acme:
  domains:
    - hy2.example.com
  email: admin@example.com

auth:
  type: http
  http:
    url: http://127.0.0.1:9000/auth

ignoreClientBandwidth: true
`
	if got != want {
		t.Errorf("minimal render mismatch\n--- got ---\n%s--- want ---\n%s", got, want)
	}
}

func TestRenderConfig_WithObfsAndMasquerade(t *testing.T) {
	cfg := Config{
		Hostname:   "hy2.example.com",
		ACMEEmail:  "a@b.io",
		ListenPort: 8443,
	}
	inbound := InboundConfig{
		ObfsPassword:  "salt-pw",
		MasqueradeURL: "https://www.bing.com",
	}
	blob, err := renderConfig(cfg, inbound)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	got := string(blob)

	for _, want := range []string{
		"listen: :8443",
		"  email: a@b.io",
		"obfs:\n  type: salamander\n  salamander:\n    password: salt-pw\n",
		"masquerade:\n  type: proxy\n  proxy:\n    url: https://www.bing.com\n    rewriteHost: true\n",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing expected fragment %q in render:\n%s", want, got)
		}
	}
}

func TestRenderConfig_WithBrutalBandwidth(t *testing.T) {
	cfg := Config{Hostname: "h", ACMEEmail: "e@x"}
	blob, err := renderConfig(cfg, InboundConfig{
		BrutalUpMbps:   100,
		BrutalDownMbps: 200,
	})
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	got := string(blob)
	if !strings.Contains(got, "bandwidth:\n  up: 100 mbps\n  down: 200 mbps\n") {
		t.Errorf("missing bandwidth section, got:\n%s", got)
	}
}

func TestRenderConfig_RequiresHostname(t *testing.T) {
	_, err := renderConfig(Config{ACMEEmail: "x@y"}, InboundConfig{})
	if err == nil || !strings.Contains(err.Error(), "Hostname is required") {
		t.Fatalf("expected Hostname-required error, got %v", err)
	}
}

func TestRenderConfig_RequiresACMEEmail(t *testing.T) {
	_, err := renderConfig(Config{Hostname: "h"}, InboundConfig{})
	if err == nil || !strings.Contains(err.Error(), "ACMEEmail is required") {
		t.Fatalf("expected ACMEEmail-required error, got %v", err)
	}
}

// Wave-14 #2 regression: renderConfig must reject panel-pushed ObfsPassword
// or MasqueradeURL containing YAML metacharacters (newline, ':', '{', '[',
// '#') because they can break out of the scalar value and inject top-level
// YAML — e.g., disabling cert validation in acme: or swapping auth: source.
func TestRenderConfig_RejectsInjectedObfsAndMasquerade(t *testing.T) {
	baseCfg := Config{Hostname: "h", ACMEEmail: "a@b", ListenPort: 443}
	cases := []struct {
		name    string
		obfs    string
		masq    string
		wantSub string
	}{
		{"newline in ObfsPassword", "pw\nacme:\n  domains:\n    - evil.com", "https://www.bing.com", "ObfsPassword"},
		{"colon in ObfsPassword", "key:value", "https://www.bing.com", "ObfsPassword"},
		{"hash in ObfsPassword", "pw#comment", "https://www.bing.com", "ObfsPassword"},
		{"newline in MasqueradeURL", "", "https://x.com\nfake:", "MasqueradeURL"},
		{"non-URL MasqueradeURL", "", "not a url at all spaces", "MasqueradeURL"},
		{"ftp scheme MasqueradeURL", "", "ftp://x.com", "MasqueradeURL"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := renderConfig(baseCfg, InboundConfig{ObfsPassword: tc.obfs, MasqueradeURL: tc.masq})
			if err == nil {
				t.Errorf("expected validation error for malicious %s", tc.wantSub)
				return
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Errorf("error message %q should mention %q", err.Error(), tc.wantSub)
			}
		})
	}
}

func TestRenderConfig_DefaultPortAndAuth(t *testing.T) {
	// ListenPort=0, AuthCallbackHost="", AuthCallbackPort=0 → defaults applied
	cfg := Config{Hostname: "h", ACMEEmail: "e@x"}
	blob, err := renderConfig(cfg, InboundConfig{})
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	got := string(blob)
	if !strings.Contains(got, "listen: :443") {
		t.Errorf("default ListenPort 443 not applied: %s", got)
	}
	if !strings.Contains(got, "url: http://127.0.0.1:9000/auth") {
		t.Errorf("default auth callback not applied: %s", got)
	}
}

func TestInboundEqual(t *testing.T) {
	a := InboundConfig{ObfsPassword: "x", MasqueradeURL: "y", BrutalUpMbps: 1, BrutalDownMbps: 2}
	b := InboundConfig{ObfsPassword: "x", MasqueradeURL: "y", BrutalUpMbps: 1, BrutalDownMbps: 2}
	if !inboundEqual(a, b) {
		t.Errorf("equal structs reported different")
	}
	b.ObfsPassword = "z"
	if inboundEqual(a, b) {
		t.Errorf("differing ObfsPassword reported equal")
	}
}

func TestInboundCfgWireUnmarshal(t *testing.T) {
	// Verify the wire matches HysteriaConfigSchema in the panel — this is the
	// contract surface between TS panel and Go agent.
	in := InboundConfig{Port: 1234, ObfsPassword: "p", MasqueradeURL: "u", BrutalUpMbps: 10, BrutalDownMbps: 20}
	w := inboundCfgWire{
		ObfsPassword:   in.ObfsPassword,
		MasqueradeURL:  in.MasqueradeURL,
		BrutalUpMbps:   in.BrutalUpMbps,
		BrutalDownMbps: in.BrutalDownMbps,
	}
	// Port travels via the ApplyInbound function arg (slice 50), not via the
	// wire JSON — toInboundConfig takes it as a second param.
	if got := w.toInboundConfig(in.Port); !inboundEqual(got, in) {
		t.Errorf("wire roundtrip mismatch: got %+v want %+v", got, in)
	}
}
