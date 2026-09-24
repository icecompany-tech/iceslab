package chain

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// Phase 8: the AmneziaWG tunnels a node's cascade legs ride in.
//
// The panel sends each tunnel as an awg-quick config for THIS end; the agent
// writes it beside the chain config, raises it before the chain process starts
// (the process binds the leg to it), and takes it down when the tunnel is no
// longer sent. Every awg-l* interface the block does not name is swept, which
// is what makes a restart, a crash mid-apply or a hand-made interface converge
// on exactly the tunnels the panel asked for.

// tunnelIfaceRe is the only shape of name a leg tunnel may have: the prefix
// and the panel's index. Anything else is refused, so a panel can never point
// awg-quick at an interface that belongs to something else on the machine
// (the users' awg0, eth0).
var tunnelIfaceRe = regexp.MustCompile(`^` + regexp.QuoteMeta(dto.ChainTunnelIfacePrefix) + `[0-9]{1,3}$`)

// tunnelKeys is every key a leg tunnel's config may carry, by section.
//
// ⚠ A WHITELIST, and the reason is awg-quick itself: it runs PreUp, PostUp,
// PreDown and PostDown as shell commands, as root, and DNS through resolvconf.
// The config arrives over the wire, so a key outside this list is a panel (or
// whoever holds one) asking this agent to run something. A leg tunnel needs
// none of them: nothing is forwarded or NATed through it.
var tunnelKeys = map[string]map[string]bool{
	"Interface": {
		"PrivateKey": true, "Address": true, "ListenPort": true, "Table": true, "MTU": true,
		"Jc": true, "Jmin": true, "Jmax": true,
		"S1": true, "S2": true, "S3": true, "S4": true,
		"H1": true, "H2": true, "H3": true, "H4": true,
	},
	"Peer": {
		"PublicKey": true, "PresharedKey": true, "Endpoint": true, "AllowedIPs": true, "PersistentKeepalive": true,
	},
}

// validateTunnel refuses a tunnel whose name or config is not one this agent
// raises. Pure, so the test can hold every refusal without a machine.
func validateTunnel(t dto.ChainTunnel) error {
	if !tunnelIfaceRe.MatchString(t.Iface) {
		return fmt.Errorf("tunnel interface %q is not a leg tunnel name (%s<n>)", t.Iface, dto.ChainTunnelIfacePrefix)
	}
	if t.ListenPort < 0 || t.ListenPort > 65535 {
		return fmt.Errorf("tunnel %s: listen port %d is not a port", t.Iface, t.ListenPort)
	}
	section := ""
	sc := bufio.NewScanner(strings.NewReader(t.Conf))
	seenInterface, seenPeer := false, false
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.TrimSuffix(strings.TrimPrefix(line, "["), "]")
			if _, ok := tunnelKeys[section]; !ok {
				return fmt.Errorf("tunnel %s: section [%s] is not one a leg tunnel has", t.Iface, section)
			}
			if section == "Interface" {
				if seenInterface {
					return fmt.Errorf("tunnel %s: two [Interface] sections", t.Iface)
				}
				seenInterface = true
			} else {
				if seenPeer {
					return fmt.Errorf("tunnel %s: a leg tunnel has one peer", t.Iface)
				}
				seenPeer = true
			}
			continue
		}
		key, _, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !found || section == "" {
			return fmt.Errorf("tunnel %s: line %q is not key = value inside a section", t.Iface, line)
		}
		if !tunnelKeys[section][key] {
			return fmt.Errorf("tunnel %s: key %q is not allowed in [%s] (hooks and DNS are refused)", t.Iface, key, section)
		}
	}
	if !seenInterface || !seenPeer {
		return fmt.Errorf("tunnel %s: needs one [Interface] and one [Peer]", t.Iface)
	}
	return nil
}

// tunnelPath is where one tunnel's config lives: beside the chain config.
func (m *Manager) tunnelPath(iface string) string {
	return filepath.Join(filepath.Dir(m.cfg.ConfigPath), iface+".conf")
}

// applyTunnels raises every tunnel in the block and sweeps the rest. Called
// with the block validated.
//
// Idempotent: a tunnel whose config on disk is already this one and whose
// interface is up is left alone, so a push that changes nothing does not
// bounce the legs riding it.
func (m *Manager) applyTunnels(ctx context.Context, tunnels []dto.ChainTunnel) error {
	wanted := make(map[string]bool, len(tunnels))
	for _, t := range tunnels {
		wanted[t.Iface] = true
	}
	if err := m.sweepTunnels(ctx, wanted); err != nil {
		return err
	}
	for _, t := range tunnels {
		path := m.tunnelPath(t.Iface)
		old, _ := os.ReadFile(path)
		up := m.cfg.LinkExists(t.Iface)
		if up && string(old) == t.Conf {
			m.openTunnel(ctx, t)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return fmt.Errorf("tunnel %s: mkdir: %w", t.Iface, err)
		}
		if err := atomicfile.Write(path, []byte(t.Conf), 0o600); err != nil {
			return fmt.Errorf("tunnel %s: write config: %w", t.Iface, err)
		}
		if up {
			// A changed config: down and up, the only way awg-quick takes a new
			// address or key.
			if out, err := m.cfg.Run(ctx, m.cfg.AwgQuickBin, "down", path); err != nil {
				m.cfg.Logger.Warn("tunnel down before re-raise returned non-zero", "iface", t.Iface,
					"err", err, "out", strings.TrimSpace(string(out)))
			}
		}
		if out, err := m.cfg.Run(ctx, m.cfg.AwgQuickBin, "up", path); err != nil {
			return fmt.Errorf("tunnel %s: awg-quick up: %w (%s)", t.Iface, err, strings.TrimSpace(string(out)))
		}
		m.cfg.Logger.Info("leg tunnel raised", "iface", t.Iface, "listenPort", t.ListenPort)
		m.openTunnel(ctx, t)
	}
	return nil
}

// openTunnel opens the firewall for a tunnel: its UDP port on the receiving
// end, and what arrives on the interface (the leg's link-in on the inner
// address), both ways, since a node can be the receiving end of one tunnel and
// the dialling end of another.
func (m *Manager) openTunnel(ctx context.Context, t dto.ChainTunnel) {
	if m.cfg.OpenTunnel != nil {
		m.cfg.OpenTunnel(ctx, t.Iface, t.ListenPort)
	}
}

// sweepTunnels takes down every leg tunnel on the machine that `wanted` does
// not name, and removes its config. By the interfaces that EXIST, not by the
// files: a tunnel raised by hand, or left by a config whose file was lost, is
// swept too.
func (m *Manager) sweepTunnels(ctx context.Context, wanted map[string]bool) error {
	present, err := m.cfg.ListLinks()
	if err != nil {
		return fmt.Errorf("list interfaces for the tunnel sweep: %w", err)
	}
	var errs []error
	for _, iface := range present {
		if !tunnelIfaceRe.MatchString(iface) || wanted[iface] {
			continue
		}
		path := m.tunnelPath(iface)
		var out []byte
		if _, statErr := os.Stat(path); statErr == nil {
			out, err = m.cfg.Run(ctx, m.cfg.AwgQuickBin, "down", path)
		} else {
			out, err = m.cfg.Run(ctx, m.cfg.IPBin, "link", "del", iface)
		}
		if err != nil {
			errs = append(errs, fmt.Errorf("take down %s: %w (%s)", iface, err, strings.TrimSpace(string(out))))
			continue
		}
		_ = os.Remove(path)
		m.cfg.Logger.Info("leg tunnel taken down", "iface", iface)
	}
	// Configs of tunnels that are neither wanted nor up: nothing to take down,
	// and the key inside should not stay on disk.
	if entries, err := os.ReadDir(filepath.Dir(m.cfg.ConfigPath)); err == nil {
		for _, e := range entries {
			name := strings.TrimSuffix(e.Name(), ".conf")
			if name != e.Name() && tunnelIfaceRe.MatchString(name) && !wanted[name] {
				_ = os.Remove(filepath.Join(filepath.Dir(m.cfg.ConfigPath), e.Name()))
			}
		}
	}
	return errors.Join(errs...)
}

// defaultListLinks names the network interfaces of this machine.
func defaultListLinks() ([]string, error) {
	entries, err := os.ReadDir("/sys/class/net")
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names, nil
}

func defaultLinkExists(iface string) bool {
	_, err := os.Stat(filepath.Join("/sys/class/net", iface))
	return err == nil
}
