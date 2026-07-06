// Package firewall manages UFW rules from the agent in lockstep with
// applyInbound. Background: install-iceslab-node.sh opens conventional ports
// (443, 80, 1234) at install time, but the panel UI lets admin pick
// any 1..65535 port for a binding. Without this auto-open, an admin
// picking port 8080 in the UI sees the inbound config applied on the
// agent side (server is listening) yet handshakes drop silently at
// the firewall — exactly the cross-layer class of bug we burned 4 VPS
// on during cycle #6 (subnet collision was its sibling).
//
// Idempotent by design: `ufw allow N/proto` is a no-op when the rule
// already exists. We don't track old ports for cleanup — leftover
// ufw rules from past port changes are harmless (just a few extra
// ALLOW lines). Add `--delete` logic only if a real operator
// complains about firewall noise.
package firewall

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// N11 - cache of (port/proto) specs already ensured this process lifetime.
// Every applyInbound re-calls Allow for the same ports, and `ufw allow` is a
// fork even when the rule already exists; this skips the redundant fork. The
// cache is per-process: an agent restart re-runs ufw once per spec (idempotent),
// which also re-covers any external `ufw reset` between restarts.
var (
	allowedMu    sync.Mutex
	allowedSpecs = make(map[string]struct{})
)

// ufwLockRe matches the transient lock-contention message ufw surfaces when the
// underlying xtables lock is held by another process. ufw shells out to
// iptables, which takes a global lock; when the agent swaps a cascade entry it
// re-applies several rules back-to-back, and a concurrent iptables run (ufw's
// own reload, fail2ban, docker) can hold that lock. A single `ufw allow` then
// exits non-zero and the rule it was adding — e.g. the cascade link-in AllowFrom
// rule — silently never lands, breaking the hop until the next apply.
var ufwLockRe = regexp.MustCompile(`(?i)(xtables lock|could not get lock|temporarily unavailable|resource temporarily)`)

// runUfw runs `ufw <args>` and retries a few times when it fails on transient
// xtables-lock contention. Non-lock failures return immediately, preserving the
// original behavior. Each attempt gets its own 5s timeout derived from ctx; the
// backoff is skipped if ctx is cancelled.
func runUfw(ctx context.Context, args ...string) ([]byte, error) {
	const attempts = 4
	var out []byte
	var err error
	for i := 0; i < attempts; i++ {
		cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		out, err = exec.CommandContext(cctx, "ufw", args...).CombinedOutput()
		cancel()
		if err == nil || !ufwLockRe.Match(out) {
			return out, err
		}
		select {
		case <-ctx.Done():
			return out, err
		case <-time.After(time.Duration(150*(i+1)) * time.Millisecond):
		}
	}
	return out, err
}

// Allow opens an inbound UFW rule for the given (port, proto).
// proto must be "tcp" or "udp". Returns nil on success OR when ufw
// isn't installed — agents on hosts without ufw shouldn't fail
// applyInbound just because of firewall management.
func Allow(ctx context.Context, logger *slog.Logger, port int, proto string) {
	if port <= 0 || port > 65535 {
		logger.Warn("firewall.Allow: invalid port, skipping", "port", port)
		return
	}
	if proto != "tcp" && proto != "udp" {
		logger.Warn("firewall.Allow: invalid proto, skipping", "proto", proto)
		return
	}
	spec := fmt.Sprintf("%d/%s", port, proto)

	allowedMu.Lock()
	_, cached := allowedSpecs[spec]
	allowedMu.Unlock()
	if cached {
		return // N11 - already ensured; skip the redundant ufw fork.
	}

	if _, err := exec.LookPath("ufw"); err != nil {
		// ufw not installed (e.g. dev container, alpine, custom image).
		// Operators on those hosts manage firewall externally; we don't
		// fail. Logged at debug so it doesn't spam normal deployments.
		logger.Debug("firewall.Allow: ufw not installed, skipping", "spec", spec)
		return
	}
	out, err := runUfw(ctx, "allow", spec)
	if err != nil {
		// Non-fatal — agent stays alive, admin can fix UFW manually.
		logger.Warn("firewall.Allow: ufw allow failed",
			"spec", spec, "err", err, "out", string(out))
		return
	}
	allowedMu.Lock()
	allowedSpecs[spec] = struct{}{}
	allowedMu.Unlock()
	logger.Info("firewall.Allow: rule ensured", "spec", spec)
}

// isLiteralSource reports whether s is a bare IP or a CIDR block - something
// `ufw allow from <s>` accepts verbatim (a hostname is not). Pure + unit-tested.
func isLiteralSource(s string) bool {
	if net.ParseIP(s) != nil {
		return true
	}
	_, _, err := net.ParseCIDR(s)
	return err == nil
}

// AllowFrom opens an inbound UFW rule for (port, proto) restricted to the given
// source IPs/CIDRs: `ufw allow from <src> to any port <port> proto <proto>`.
// Used for the cascade inter-hop link port, which only the previous hop should
// reach (not the world). Hostname sources (a node address is often an FQDN) are
// resolved to IPs best-effort. If NO usable source remains the rule falls open
// to anywhere - a closed link port silently breaks the cascade, and the link is
// still UUID/PSK-gated, so fail-open is the safer default.
func AllowFrom(ctx context.Context, logger *slog.Logger, port int, proto string, sources []string) {
	if port <= 0 || port > 65535 {
		logger.Warn("firewall.AllowFrom: invalid port, skipping", "port", port)
		return
	}
	if proto != "tcp" && proto != "udp" {
		logger.Warn("firewall.AllowFrom: invalid proto, skipping", "proto", proto)
		return
	}

	seen := map[string]struct{}{}
	valid := make([]string, 0, len(sources))
	add := func(s string) {
		if _, dup := seen[s]; dup {
			return
		}
		seen[s] = struct{}{}
		valid = append(valid, s)
	}
	for _, raw := range sources {
		s := strings.TrimSpace(raw)
		if s == "" {
			continue
		}
		if isLiteralSource(s) {
			add(s)
			continue
		}
		// Hostname -> resolve best-effort so we can still pin the rule to an IP.
		rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		ips, err := net.DefaultResolver.LookupHost(rctx, s)
		cancel()
		if err != nil {
			logger.Debug("firewall.AllowFrom: cannot resolve source host", "host", s, "err", err)
			continue
		}
		for _, ip := range ips {
			if net.ParseIP(ip) != nil {
				add(ip)
			}
		}
	}

	if len(valid) == 0 {
		logger.Info("firewall.AllowFrom: no usable source, opening port to anywhere",
			"port", port, "proto", proto)
		Allow(ctx, logger, port, proto)
		return
	}
	if _, err := exec.LookPath("ufw"); err != nil {
		logger.Debug("firewall.AllowFrom: ufw not installed, skipping", "port", port)
		return
	}
	for _, src := range valid {
		spec := fmt.Sprintf("from-%s-%d/%s", src, port, proto)
		allowedMu.Lock()
		_, cached := allowedSpecs[spec]
		allowedMu.Unlock()
		if cached {
			continue
		}
		out, err := runUfw(ctx, "allow", "from", src,
			"to", "any", "port", strconv.Itoa(port), "proto", proto)
		if err != nil {
			logger.Warn("firewall.AllowFrom: ufw allow failed",
				"src", src, "port", port, "proto", proto, "err", err, "out", string(out))
			continue
		}
		allowedMu.Lock()
		allowedSpecs[spec] = struct{}{}
		allowedMu.Unlock()
		logger.Info("firewall.AllowFrom: rule ensured", "src", src, "port", port, "proto", proto)
	}
}

// AllowedPort is a single ufw-allowed inbound rule (G4 probe-exposure).
type AllowedPort struct {
	Port  int
	Proto string // "tcp" | "udp"
}

// ufwRuleRe matches a `ufw status` line that allows a single port, e.g.
// "443/tcp                    ALLOW       Anywhere" or
// "1337/tcp                   ALLOW       203.0.113.5". The v6 dupes ufw prints
// ("443/tcp (v6) ALLOW ...") DON'T match (the " (v6)" breaks the proto->ALLOW
// adjacency), which conveniently de-duplicates v4/v6. Port ranges
// ("20000:50000/udp") and bare-port rules (no proto) are intentionally skipped.
var ufwRuleRe = regexp.MustCompile(`^(\d{1,5})/(tcp|udp)\s+ALLOW`)

// parseUfwStatus extracts the distinct (port, proto) allows from `ufw status`
// output. Pure + unit-tested; ListAllowed wraps it around the actual command.
func parseUfwStatus(out string) []AllowedPort {
	seen := make(map[string]struct{})
	ports := []AllowedPort{}
	for _, line := range strings.Split(out, "\n") {
		m := ufwRuleRe.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		port, err := strconv.Atoi(m[1])
		if err != nil || port <= 0 || port > 65535 {
			continue
		}
		key := m[1] + "/" + m[2]
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		ports = append(ports, AllowedPort{Port: port, Proto: m[2]})
	}
	return ports
}

// ListAllowed returns the (port, proto) rules ufw currently allows IN.
// Best-effort, mirroring Allow's contract: returns (nil, nil) when ufw isn't
// installed so the panel treats the node as "unmanaged" (skip the exposure
// check) rather than erroring. When ufw IS present it returns a non-nil slice
// (possibly empty), so callers can distinguish "no ufw" from "ufw, no rules".
func ListAllowed(ctx context.Context, logger *slog.Logger) ([]AllowedPort, error) {
	if _, err := exec.LookPath("ufw"); err != nil {
		logger.Debug("firewall.ListAllowed: ufw not installed, skipping")
		return nil, nil
	}
	out, err := runUfw(ctx, "status")
	if err != nil {
		return nil, fmt.Errorf("ufw status: %w (%s)", err, string(out))
	}
	return parseUfwStatus(string(out)), nil
}
