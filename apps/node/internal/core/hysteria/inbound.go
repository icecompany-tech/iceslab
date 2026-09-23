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
	Port int
	// Hostname is the public FQDN ACME issues this node's certificate for.
	// Install-time only until now, which meant moving a node to a new address
	// required re-onboarding it. The panel derives this from the node's own
	// address, the name clients dial and validate against, and pushes it so a
	// move is an edit instead of a re-install. Empty falls back to the
	// install-time adapterCfg.Hostname. The address must already resolve here
	// before the change lands, or the ACME challenge fails and hysteria is left
	// without a valid certificate.
	Hostname       string
	ObfsPassword   string
	MasqueradeURL  string
	BrutalUpMbps   int
	BrutalDownMbps int
}

// inboundCfgWire mirrors HysteriaConfigSchema in
// apps/panel-backend/src/modules/inbounds/inbounds.schemas.ts. Field names
// are JSON-camelCase to match what the panel emits over /applyInbounds.
type inboundCfgWire struct {
	Hostname       string `json:"hostname,omitempty"`
	ObfsPassword   string `json:"obfsPassword,omitempty"`
	MasqueradeURL  string `json:"masqueradeUrl,omitempty"`
	BrutalUpMbps   int    `json:"brutalUpMbps,omitempty"`
	BrutalDownMbps int    `json:"brutalDownMbps,omitempty"`
}

func (w inboundCfgWire) toInboundConfig(port int) InboundConfig {
	return InboundConfig{
		Port:           port,
		Hostname:       w.Hostname,
		ObfsPassword:   w.ObfsPassword,
		MasqueradeURL:  w.MasqueradeURL,
		BrutalUpMbps:   w.BrutalUpMbps,
		BrutalDownMbps: w.BrutalDownMbps,
	}
}

// ChainHandoff tells this core to give EVERY user to the chain process, phase 6.
//
// It arrives in the node-level `chain.userCore` block, never on an inbound: it
// is a statement about this node's place in a cascade, not about one profile.
// The panel names the engine, and only the adapter whose engine matches gets
// it, so a standalone hysteria profile on a node whose cascade entry is xray is
// never pulled into the chain by accident.
//
// ⚠ A PORT, not an address. The hand-off always goes to loopback and this
// adapter writes `127.0.0.1` itself: a panel that is broken or compromised can
// point it at a different port on this machine, and at nothing else.
type ChainHandoff struct {
	Port     int
	Username string
	Password string
}

// chainHandoffWire mirrors NodeChain.userCore.socks in shared/transport.ts.
type chainHandoffWire struct {
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func handoffEqual(a, b *ChainHandoff) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func inboundEqual(a, b InboundConfig) bool {
	return a.Port == b.Port &&
		a.Hostname == b.Hostname &&
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
func renderConfig(adapterCfg Config, inbound InboundConfig, handoff *ChainHandoff) ([]byte, error) {
	// Hostname selection mirrors the port priority below: what the panel pushed
	// wins, the install-time value is the fallback for a panel too old to send
	// one. A newline or YAML metacharacter in a pushed hostname would break out
	// of the acme.domains scalar, so it is validated like every other pushed
	// string before it reaches the file.
	hostname := inbound.Hostname
	if hostname != "" {
		if err := validateInboundYAMLSafe("Hostname", hostname); err != nil {
			return nil, err
		}
	} else {
		hostname = adapterCfg.Hostname
	}
	if hostname == "" {
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
	fmt.Fprintf(&b, "    - %s\n", hostname)
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

	if handoff != nil {
		if err := writeChainOutbound(&b, handoff); err != nil {
			return nil, err
		}
	}

	return b.Bytes(), nil
}

// writeChainOutbound appends the hand-off to the chain: ONE socks5 outbound,
// and nothing beside it.
//
// ⚠ MEASURED against hysteria 2.12.3 on 2026-09-23, with a real client and
// real traffic, because the log cannot say where traffic goes:
//
//   - with no `acl`, every user goes out through the FIRST outbound in the
//     array (chain first: the request reached the chain; direct first: the
//     request went straight out);
//   - a second outbound is never used until a rule names it.
//
// So the shape is exactly one outbound and no acl, and the absence of both is
// the point rather than an omission:
//
//   - no `direct` at all, because a `direct` placed first would carry every
//     user straight out of the ENTRY country with no error anywhere and a
//     working connection on the client. A leak past the cascade that looks like
//     everything working is the one outcome this phase exists to prevent;
//   - no `acl`, because the policy is drawn by the chain. Two places deciding
//     where one packet goes is how they come to disagree.
//
// And it stays when the chain process is down: the users of this core then
// have no connection, which is loud, instead of leaving through the entry,
// which is silent. The same fail-closed rule as the xray entry (К4).
func writeChainOutbound(b *bytes.Buffer, h *ChainHandoff) error {
	if h.Port < 1 || h.Port > 65535 {
		return fmt.Errorf("hysteria chain hand-off: port %d is not a port", h.Port)
	}
	if h.Username == "" || h.Password == "" {
		// The chain's socks listeners are authenticated even on loopback (a VPS
		// has other users, and an open proxy on 127.0.0.1 is an open relay for
		// anyone with a shell), so a hand-off without credentials would be
		// refused by the listener on every connection.
		return fmt.Errorf("hysteria chain hand-off: username and password are required")
	}
	if err := validateInboundYAMLSafe("chain username", h.Username); err != nil {
		return err
	}
	if err := validateInboundYAMLSafe("chain password", h.Password); err != nil {
		return err
	}
	b.WriteString("\noutbounds:\n")
	b.WriteString("  - name: chain\n")
	b.WriteString("    type: socks5\n")
	b.WriteString("    socks5:\n")
	fmt.Fprintf(b, "      addr: 127.0.0.1:%d\n", h.Port)
	fmt.Fprintf(b, "      username: %s\n", h.Username)
	fmt.Fprintf(b, "      password: %s\n", h.Password)
	return nil
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
