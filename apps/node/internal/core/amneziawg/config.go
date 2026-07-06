// Package amneziawg implements CoreAdapter for AmneziaWG (DPI-resistant
// WireGuard fork). Slice 19 ships config generation and `awg syncconf`-based
// hot-reload, no kernel-module install or peer management yet (those land in
// the adapter and bootstrap commits).
//
// Obfuscation parameters split into two groups:
//   - Interface-immutable: S1-S4, H1-H4. Changing them requires bouncing every
//     client. Treated as set-once per inbound lifetime.
//   - Currently interface-fixed but client-tunable in upstream: Jc/Jmin/Jmax.
//     Phase 2 keeps them interface-wide for simplicity (matches bivlked's
//     installer); Phase 3 may diverge per-client if there's demand.
//
// Recommended defaults aim at Russian TSPU; admins override per-inbound in
// slice 23's editor (TSPU / Mobile / Custom presets).
package amneziawg

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"strings"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
)

// allowedHookPrefixes is the strict whitelist of commands acceptable in
// PostUp/PostDown. awg-quick treats those fields as a shell command, so
// anything outside this list - pipes, redirects, &&, $(...), backticks,
// arbitrary binaries - is rejected with an error before render.
var allowedHookPrefixes = []string{
	"iptables ",
	"ip6tables ",
	"ip ", // `ip route add ...` etc.
	"sysctl ",
	"echo ", // common in install-time NAT setup snippets
}

// validatePostHook returns an error unless `cmd` either is empty or starts
// with one of `allowedHookPrefixes` AND contains no shell metacharacters.
// Empty string is fine, render emits an unused PostUp/PostDown line in
// that case, awg-quick treats it as a no-op.
func validatePostHook(cmd string) error {
	if cmd == "" {
		return nil
	}
	for _, ch := range []string{";", "&", "|", "$", "`", "\n", ">", "<"} {
		if strings.Contains(cmd, ch) {
			return fmt.Errorf("disallowed shell metacharacter %q in hook", ch)
		}
	}
	for _, p := range allowedHookPrefixes {
		if strings.HasPrefix(cmd, p) {
			return nil
		}
	}
	return fmt.Errorf("hook command must start with one of: %s", strings.Join(allowedHookPrefixes, ", "))
}

// InboundConfig is the static part of the AmneziaWG interface, generated once
// from admin settings (slice 23 will move these into the inbounds table) and
// kept constant across user mutations. Peer set is passed separately to
// renderConfig because it changes per AddUser/RemoveUser.
type InboundConfig struct {
	// Interface is the name of the awg device, e.g. "awg0". Must match what
	// `awg syncconf <iface>` will receive.
	Interface string

	// ListenPort is the public UDP port advertised to clients. Default 51820.
	ListenPort int

	// PrivateKey is the server's WireGuard private key (base64, 32 bytes raw).
	PrivateKey string

	// Address is the server's IP inside the tunnel, in CIDR form
	// (e.g. "10.0.0.1/24"). Must match the subnet the IP allocator
	// (panel-backend amneziawg.service) is handing out from.
	Address string

	// Junk parameters: currently interface-fixed in MVP.
	Jc   int // junk packet count
	Jmin int // junk packet size min
	Jmax int // junk packet size max

	// Magic header sizes: interface-immutable. Bouncing rotates all clients.
	S1, S2, S3, S4 int

	// Magic header values: interface-immutable, must be 32-bit and pairwise
	// distinct from one another and from WireGuard's defaults (1..4).
	H1, H2, H3, H4 uint32

	// I1-I5: optional v2.0 mimicry signature packets (hex strings).
	// When set, the kernel module emits these before the real handshake
	// to disguise the flow as QUIC / DNS / etc. Empty disables that
	// slot. Set via panel UI; flow through wire JSON to here, then
	// rendered into the awg-quick `[Interface]` block.
	I1, I2, I3, I4, I5 string

	// Optional NAT setup. If empty, defaults to the standard MASQUERADE rule
	// over the host's primary egress interface. Operators on tightly-firewalled
	// hosts may want to set these explicitly.
	PostUp   string
	PostDown string
}

// Peer is a single [Peer] block. Generated from a panel `amneziawg_peers` row.
type Peer struct {
	PublicKey string
	// AllowedIP is the peer's IP in CIDR /32 form, e.g. "10.0.0.2/32".
	AllowedIP string
}

func (c *InboundConfig) withDefaults() InboundConfig {
	out := *c
	if out.Interface == "" {
		out.Interface = "awg0"
	}
	if out.ListenPort == 0 {
		out.ListenPort = 51820
	}
	// Address / Jc / Jmin / Jmax / S1-S4 used to have hardcoded defaults
	// here (10.0.0.1/24, 4, 40, 70, 72, 56, 32, 16), the TSPU-preset
	// values. That was wrong: zero is a legitimate value (operator wants
	// junk-obfuscation disabled), and the old subnet default collided
	// with some hosts' internal gateway. The panel UI now always sends explicit
	// values (per AmneziawgConfigSchema), so zero on the wire means
	// zero, not "use the default". Caught live cycle #6 2026-05-12:
	// admin set Jc=0 in UI to debug, server kept rendering Jc=4 because
	// of these defaults, handshake silently failed.
	if out.PostUp == "" {
		// `! -o %i` matches packets exiting on ANY interface OTHER than the wg
		// interface itself, i.e. real WAN egress. The earlier default used
		// `-o %i` which MASQUERADE'd traffic going TO peers and never NAT'd
		// the actual internet-bound traffic, so VPN clients reached "Connected"
		// but RX/TX was massively asymmetric (server received decrypted
		// requests, forwarded them with private src 10.x, responses never
		// routed back). Caught live 2026-05-13 on a production node, fixed inline
		// with `iptables -t nat -A POSTROUTING -s 10.66.66.0/24 -o net0 -j MASQUERADE`;
		// this default uses `! -o %i` so it works regardless of WAN iface name.
		out.PostUp = "iptables -t nat -A POSTROUTING ! -o %i -j MASQUERADE"
	}
	if out.PostDown == "" {
		out.PostDown = "iptables -t nat -D POSTROUTING ! -o %i -j MASQUERADE"
	}
	return out
}

// validateWGKey enforces "looks like a WireGuard key": exactly 44 chars
// from the standard base64 alphabet, decodes to 32 bytes. Anything else
// (notably newlines, '[', '=' in wrong place, shell metacharacters) is
// rejected. Wave-14 #1: pre-wave panel-pushed PublicKey was written into
// awg-quick INI via fmt.Fprintf with no validation, so a '\n' in the value
// could close [Peer] and inject [Interface]/PostUp=sh -c ... → root RCE on
// every interface bring-up. Whitelist input format here defeats it.
func validateWGKey(s string) error {
	if len(s) != 44 {
		return fmt.Errorf("wg key must be 44 base64 chars (got %d)", len(s))
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return fmt.Errorf("wg key not valid base64: %w", err)
	}
	if len(raw) != 32 {
		return fmt.Errorf("wg key must decode to 32 bytes (got %d)", len(raw))
	}
	return nil
}

// validateAllowedIP enforces CIDR notation (e.g. "10.66.66.5/32"). Rejects
// anything net/netip can't parse, same wave-14 #1 RCE class as validateWGKey.
func validateAllowedIP(s string) error {
	if _, err := netip.ParsePrefix(s); err != nil {
		return fmt.Errorf("AllowedIP not a valid CIDR: %w", err)
	}
	return nil
}

// validateIField enforces "looks like an AmneziaWG I-signature": a hex string
// only (the panel validates the same shape with /^[0-9a-fA-F]*$/). Empty is
// allowed and means "slot disabled". This is the same RCE class the WG-key and
// AllowedIP validators guard against: I1-I5 arrive over the panel→node wire and
// are written verbatim into the awg-quick INI's [Interface] block via
// fmt.Fprintf. A value containing a newline (e.g. "aabb\nPostUp = curl … | sh")
// closes the I-line and injects a PostUp directive that awg-quick evaluates as
// a root shell command on interface bring-up. Restricting to hex kills the
// newline and every shell metacharacter.
func validateIField(name, s string) error {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return fmt.Errorf("%s must be a hex string (offending byte at index %d)", name, i)
		}
	}
	return nil
}

func (c *InboundConfig) validate() error {
	if c.PrivateKey == "" {
		return errors.New("PrivateKey is required")
	}
	if err := validateWGKey(c.PrivateKey); err != nil {
		return fmt.Errorf("PrivateKey: %w", err)
	}
	for _, h := range []struct {
		name string
		val  uint32
	}{{"H1", c.H1}, {"H2", c.H2}, {"H3", c.H3}, {"H4", c.H4}} {
		if h.val == 0 {
			return fmt.Errorf("%s is required (must be a 32-bit value, non-zero, distinct from 1..4)", h.name)
		}
		if h.val <= 4 {
			return fmt.Errorf("%s=%d collides with WireGuard's default header values (1..4)", h.name, h.val)
		}
	}
	uniq := map[uint32]string{
		c.H1: "H1", c.H2: "H2", c.H3: "H3", c.H4: "H4",
	}
	if len(uniq) != 4 {
		return errors.New("H1-H4 must be pairwise distinct")
	}
	if c.Jmin > c.Jmax {
		return fmt.Errorf("Jmin (%d) must be <= Jmax (%d)", c.Jmin, c.Jmax)
	}
	for _, f := range []struct {
		name string
		val  string
	}{{"I1", c.I1}, {"I2", c.I2}, {"I3", c.I3}, {"I4", c.I4}, {"I5", c.I5}} {
		if err := validateIField(f.name, f.val); err != nil {
			return err
		}
	}
	return nil
}

// renderConfig produces a complete awg-quick config string for the given peers.
// Output is plain text (not JSON) because that's what `awg syncconf` and
// `awg-quick` consume. Peers are written in the order received, caller is
// expected to sort by IP if it wants stable diffs.
func renderConfig(inbound InboundConfig, peers []Peer) (string, error) {
	if err := inbound.validate(); err != nil {
		return "", err
	}
	cfg := inbound.withDefaults()

	var b strings.Builder
	fmt.Fprintln(&b, "[Interface]")
	fmt.Fprintf(&b, "PrivateKey = %s\n", cfg.PrivateKey)
	fmt.Fprintf(&b, "ListenPort = %d\n", cfg.ListenPort)
	fmt.Fprintf(&b, "Address = %s\n", cfg.Address)
	fmt.Fprintf(&b, "Jc = %d\n", cfg.Jc)
	fmt.Fprintf(&b, "Jmin = %d\n", cfg.Jmin)
	fmt.Fprintf(&b, "Jmax = %d\n", cfg.Jmax)
	fmt.Fprintf(&b, "S1 = %d\n", cfg.S1)
	fmt.Fprintf(&b, "S2 = %d\n", cfg.S2)
	fmt.Fprintf(&b, "S3 = %d\n", cfg.S3)
	fmt.Fprintf(&b, "S4 = %d\n", cfg.S4)
	fmt.Fprintf(&b, "H1 = %d\n", cfg.H1)
	fmt.Fprintf(&b, "H2 = %d\n", cfg.H2)
	fmt.Fprintf(&b, "H3 = %d\n", cfg.H3)
	fmt.Fprintf(&b, "H4 = %d\n", cfg.H4)
	// I1-I5 are emitted only when non-empty, empty strings mean "no
	// mimicry packet for this slot", and awg-quick rejects empty hex.
	for i, val := range []string{cfg.I1, cfg.I2, cfg.I3, cfg.I4, cfg.I5} {
		if val != "" {
			fmt.Fprintf(&b, "I%d = %s\n", i+1, val)
		}
	}
	// awg-quick evaluates PostUp/PostDown as a shell command, so anything
	// we render here runs as root on every interface bounce. PostUp/Down
	// are NOT accepted on the panel→node wire (see adapter.go ApplyInbound),
	// they only reach this point from install-time env on the VPS, which
	// is admin-controlled. We still hard-whitelist allowed command prefixes
	// here as defence-in-depth so a future maintainer who plumbs them
	// through the wire by accident can't accidentally introduce RCE.
	if err := validatePostHook(cfg.PostUp); err != nil {
		return "", fmt.Errorf("PostUp: %w", err)
	}
	if err := validatePostHook(cfg.PostDown); err != nil {
		return "", fmt.Errorf("PostDown: %w", err)
	}
	fmt.Fprintf(&b, "PostUp = %s\n", cfg.PostUp)
	fmt.Fprintf(&b, "PostDown = %s\n", cfg.PostDown)

	for _, p := range peers {
		if p.PublicKey == "" || p.AllowedIP == "" {
			return "", fmt.Errorf("peer with empty PublicKey or AllowedIP: %+v", p)
		}
		if err := validateWGKey(p.PublicKey); err != nil {
			return "", fmt.Errorf("peer PublicKey: %w", err)
		}
		if err := validateAllowedIP(p.AllowedIP); err != nil {
			return "", fmt.Errorf("peer AllowedIP: %w", err)
		}
		fmt.Fprintln(&b)
		fmt.Fprintln(&b, "[Peer]")
		fmt.Fprintf(&b, "PublicKey = %s\n", p.PublicKey)
		fmt.Fprintf(&b, "AllowedIPs = %s\n", p.AllowedIP)
	}

	return b.String(), nil
}

// writeConfig atomically writes the awg config to disk via the shared
// atomicfile helper (fsync(file) + fsync(dir) for power-loss durability).
// Mode 0o600, file contains the server's private key.
func writeConfig(path string, blob string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	return atomicfile.Write(path, []byte(blob), 0o600)
}
