package hysteria

import (
	"bytes"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
)

// validateInboundYAMLSafe enforces "no character that could break out of a
// single-line YAML scalar value" on the two panel-pushed strings that get
// fmt.Fprintf'd into the hysteria YAML. Wave-14 #2: pre-wave a '\n' in
// ObfsPassword closed the salamander: block and let a hostile/compromised
// panel push smuggle top-level YAML (e.g. swap `acme:` to disable cert
// validation, swap `auth:` source to local-file, etc).
//
// Rejected chars: \n \r (line break = scalar exit), ':' (would silently
// become a new key in flow style), '{' '[' '#' (YAML metacharacters that
// change parsing mode). Real obfs passwords and proxy URLs don't contain
// any of these.
func validateInboundYAMLSafe(field, value string) error {
	for _, ch := range []string{"\n", "\r", ":", "{", "[", "#"} {
		if strings.Contains(value, ch) {
			return fmt.Errorf("hysteria %s: disallowed YAML-syntax char %q", field, ch)
		}
	}
	return nil
}

// validateMasqueradeURL enforces URL-format validation. URLs legitimately
// contain ':' so we can't apply validateInboundYAMLSafe wholesale, instead
// we explicitly reject the YAML-scalar exit chars (\n \r) and then enforce
// that what's left is actually a parsable http/https URL with a host.
func validateMasqueradeURL(s string) error {
	if strings.ContainsAny(s, "\n\r") {
		return fmt.Errorf("hysteria MasqueradeURL: contains newline (would break YAML scalar)")
	}
	u, err := url.Parse(s)
	if err != nil {
		return fmt.Errorf("hysteria MasqueradeURL: not a valid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("hysteria MasqueradeURL: scheme must be http or https, got %q", u.Scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("hysteria MasqueradeURL: host is required")
	}
	return nil
}

// InboundConfig holds the panel-pushed runtime config that lands in
// /etc/hysteria/config.yaml. Install-time settings (ACME domain/email,
// auth callback URL) live on adapter.Config, those don't flow over the
// wire because they're identity for the node, not per-inbound.
//
// Port was install-time only until 2026-05-20: admin couldn't change the
// listen port through the panel UI because the wire didn't carry it and
// renderConfig fell back to adapterCfg.ListenPort. Now Port is per-
// inbound and the install-time ListenPort acts only as a fallback.
type InboundConfig struct {
	Port           int
	ObfsPassword   string
	MasqueradeURL  string
	BrutalUpMbps   int
	BrutalDownMbps int
}

// inboundCfgWire mirrors HysteriaConfigSchema in
// apps/panel-backend/src/modules/inbounds/inbounds.schemas.ts. Field names
// are JSON-camelCase to match what the panel emits over /applyInbounds.
type inboundCfgWire struct {
	ObfsPassword   string `json:"obfsPassword,omitempty"`
	MasqueradeURL  string `json:"masqueradeUrl,omitempty"`
	BrutalUpMbps   int    `json:"brutalUpMbps,omitempty"`
	BrutalDownMbps int    `json:"brutalDownMbps,omitempty"`
}

func (w inboundCfgWire) toInboundConfig(port int) InboundConfig {
	return InboundConfig{
		Port:           port,
		ObfsPassword:   w.ObfsPassword,
		MasqueradeURL:  w.MasqueradeURL,
		BrutalUpMbps:   w.BrutalUpMbps,
		BrutalDownMbps: w.BrutalDownMbps,
	}
}

func inboundEqual(a, b InboundConfig) bool {
	return a.Port == b.Port &&
		a.ObfsPassword == b.ObfsPassword &&
		a.MasqueradeURL == b.MasqueradeURL &&
		a.BrutalUpMbps == b.BrutalUpMbps &&
		a.BrutalDownMbps == b.BrutalDownMbps
}

// renderConfig produces a deterministic YAML body for hysteria server. The
// shape matches what we manually wrote during the 2026-05-07 VPS test:
// listen + acme + auth + (obfs?) + (masquerade?) + (bandwidth?). No keys are
// emitted in random order, no time-stamps, so byte-identical inputs produce
// byte-identical output (golden-test friendly).
//
// We hand-roll YAML rather than pulling in gopkg.in/yaml.v3 because the
// surface is tiny and the layout is fixed; a 60-line writer is cheaper than
// a transitive dep.
func renderConfig(adapterCfg Config, inbound InboundConfig) ([]byte, error) {
	if adapterCfg.Hostname == "" {
		return nil, fmt.Errorf("hysteria render: Hostname is required")
	}
	if adapterCfg.ACMEEmail == "" {
		return nil, fmt.Errorf("hysteria render: ACMEEmail is required")
	}
	// Port selection priority (slice 50, 2026-05-20):
	//   1. inbound.Port: what the panel actually pushed, the source of truth
	//      now that admin can change ports via the UI
	//   2. adapterCfg.ListenPort: install-time fallback (legacy, kept so a
	//      pre-slice-50 panel that doesn't include port falls through)
	//   3. 443: last-resort default (matches install-iceslab-node.sh)
	listenPort := inbound.Port
	if listenPort == 0 {
		listenPort = adapterCfg.ListenPort
	}
	if listenPort == 0 {
		listenPort = 443
	}
	authHost := adapterCfg.AuthCallbackHost
	if authHost == "" {
		authHost = "127.0.0.1"
	}
	authPort := adapterCfg.AuthCallbackPort
	if authPort == 0 {
		authPort = 9000
	}
	authPath := adapterCfg.AuthCallbackPath
	if authPath == "" {
		authPath = "/auth"
	}

	var b bytes.Buffer
	fmt.Fprintf(&b, "listen: :%d\n", listenPort)
	b.WriteString("\n")
	b.WriteString("acme:\n")
	b.WriteString("  domains:\n")
	fmt.Fprintf(&b, "    - %s\n", adapterCfg.Hostname)
	fmt.Fprintf(&b, "  email: %s\n", adapterCfg.ACMEEmail)
	b.WriteString("\n")
	b.WriteString("auth:\n")
	b.WriteString("  type: http\n")
	b.WriteString("  http:\n")
	fmt.Fprintf(&b, "    url: http://%s:%d%s\n", authHost, authPort, authPath)

	if inbound.ObfsPassword != "" {
		if err := validateInboundYAMLSafe("ObfsPassword", inbound.ObfsPassword); err != nil {
			return nil, err
		}
		b.WriteString("\n")
		b.WriteString("obfs:\n")
		b.WriteString("  type: salamander\n")
		b.WriteString("  salamander:\n")
		fmt.Fprintf(&b, "    password: %s\n", inbound.ObfsPassword)
	}

	if inbound.MasqueradeURL != "" {
		if err := validateMasqueradeURL(inbound.MasqueradeURL); err != nil {
			return nil, err
		}
		b.WriteString("\n")
		b.WriteString("masquerade:\n")
		b.WriteString("  type: proxy\n")
		b.WriteString("  proxy:\n")
		fmt.Fprintf(&b, "    url: %s\n", inbound.MasqueradeURL)
		b.WriteString("    rewriteHost: true\n")
	}

	if inbound.BrutalUpMbps > 0 || inbound.BrutalDownMbps > 0 {
		b.WriteString("\n")
		b.WriteString("bandwidth:\n")
		if inbound.BrutalUpMbps > 0 {
			fmt.Fprintf(&b, "  up: %d mbps\n", inbound.BrutalUpMbps)
		}
		if inbound.BrutalDownMbps > 0 {
			fmt.Fprintf(&b, "  down: %d mbps\n", inbound.BrutalDownMbps)
		}
	}

	// Cycle #5 ground truth: Hysteria 2 + Brutal CC requires the client to
	// declare its own bandwidth at session start. Hiddify iOS / NekoBox /
	// Streisand frequently negotiate `up=0` and the tunnel handshake then
	// completes successfully but every proxied request times out at tx=0.
	// Setting `ignoreClientBandwidth: true` forces BBR (CUBIC-class
	// congestion control) and removes the client-bandwidth dependency
	// entirely, at the cost of not using Brutal's aggressive scheduling.
	// For real-world residential broadband this is invisible; for clients
	// that DO declare valid bandwidth values via our subscription URI
	// (`upmbps=`/`downmbps=`) Brutal still kicks in. Net: defaults that
	// "just work" without sacrificing power-user tunability.
	b.WriteString("\nignoreClientBandwidth: true\n")

	// Cycle #6 reality-check 2026-05-12: Hysteria 2's per-user uplink/downlink
	// counters are exposed via a separate HTTP API (`trafficStats:` block).
	// Without this, our adapter's GetStats only returned a userId list with
	// zero bytes, UI showed `0 B today` for every Hysteria node even with
	// active traffic. The endpoint binds loopback-only; secret is shared
	// between adapter (poller) and hysteria-server (validator) via
	// /etc/iceslab-node/env. The block is only emitted when both fields
	// are present, so a misconfigured node falls back to the zero-counter
	// behaviour rather than crashing on hysteria-config parse.
	if adapterCfg.TrafficStatsListen != "" && adapterCfg.TrafficStatsSecret != "" {
		b.WriteString("\ntrafficStats:\n")
		fmt.Fprintf(&b, "  listen: %s\n", adapterCfg.TrafficStatsListen)
		fmt.Fprintf(&b, "  secret: %s\n", adapterCfg.TrafficStatsSecret)
	}

	return b.Bytes(), nil
}

// writeConfig atomically writes the rendered YAML via the shared
// atomicfile helper. fsync(file)+fsync(dir) so a hysteria reload racing
// the writer (or a power-loss after rename) never sees a half-formed file.
func writeConfig(path string, blob []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	return atomicfile.Write(path, blob, 0o600)
}
