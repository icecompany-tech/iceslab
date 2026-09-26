// Package hopguard keeps a UDP port-hopping redirect off the ports this node
// listens on itself, E49.
//
// Hysteria's port hopping is one nat PREROUTING rule, `-p udp --dport
// 20000:50000 -j REDIRECT --to-ports 443` (bootstrap-hysteria.sh). It knows
// nothing of what else the node serves, and the cascade puts its own UDP
// listeners squarely inside that range: the leg tunnels on 27000+, a hy2 or
// tuic leg on 24000+, an AmneziaWG interface an operator put at 30000. On the
// stand (ru-02, nl-01, 26.09) every packet of the tunnel under a leg was taken
// to hysteria: keys and junk parameters matched on both ends, tcpdump saw the
// packets arrive on ens3, the awg socket saw none.
//
// And a second, quieter case of the same rule: a user of an AmneziaWG entry
// whose UDP goes to some foreign host on a port in the range is steered by
// TPROXY and then REDIRECTED by the nat table to hysteria, because the rule
// names no interface.
//
// The guard is one nat chain, jumped to from the TOP of PREROUTING, ahead of any
// REDIRECT: it ACCEPTs (which in nat means "no translation here") the node's own
// UDP ports and whatever an awg interface carries to a foreign address. It is
// rewritten whenever the set changes, and every port that entered or left it
// has its conntrack entries dropped: nat decides once per flow, and a flow
// already redirected keeps its translation for as long as packets keep it
// alive. A WireGuard tunnel never goes idle (keepalive, junk), so without the
// flush the redirect outlives the rule that made it; that was the second half
// of the stand's outage.
package hopguard

import (
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"sync"
)

// Chain is the nat chain the guard owns. Nothing else writes to it.
const Chain = "ICESLAB-HOPKEEP"

// Runner runs one command, with stdin when it is not empty, and returns its
// combined output. A variable in Guard so the tests can see every call.
type Runner func(ctx context.Context, stdin, name string, args ...string) ([]byte, error)

// Guard is safe for concurrent use; a push and a restore do not overlap, but
// the lock costs nothing.
type Guard struct {
	Logger   *slog.Logger
	Run      Runner
	LookPath func(string) (string, error)

	mu            sync.Mutex
	last          map[int]bool
	synced        bool
	warnedNoTrack bool
}

// New is a guard on the host's own tools.
func New(logger *slog.Logger) *Guard {
	return &Guard{Logger: logger, Run: execRun, LookPath: exec.LookPath}
}

func execRun(ctx context.Context, stdin, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	return cmd.CombinedOutput()
}

// Rules is the chain's whole content for a set of ports, in iptables-restore
// form, for --noflush: only this chain is declared, so only it is replaced,
// and atomically.
func Rules(ports []int) string {
	var b strings.Builder
	b.WriteString("*nat\n")
	fmt.Fprintf(&b, ":%s - [0:0]\n", Chain)
	fmt.Fprintf(&b, "-F %s\n", Chain)
	// What an awg interface carries to someone else's address: the TPROXY'd
	// traffic of an AmneziaWG entry's users, and anything a leg tunnel routes.
	// Never a hysteria client. Local destinations stay subject to the rest of
	// PREROUTING, so a published container port still gets its DNAT.
	fmt.Fprintf(&b, "-A %s -i awg+ -m addrtype ! --dst-type LOCAL -j ACCEPT\n", Chain)
	for _, p := range sortedUnique(ports) {
		fmt.Fprintf(&b, "-A %s -p udp --dport %d -j ACCEPT\n", Chain, p)
	}
	b.WriteString("COMMIT\n")
	return b.String()
}

// jumpArgs is the PREROUTING rule that sends UDP through the chain.
var jumpArgs = []string{"-p", "udp", "-j", Chain}

// Sync makes the host's guard say exactly `ports`. Best-effort: a host without
// iptables has no redirect to guard against, and a failure is logged, never
// fatal to the push that carries the ports.
func (g *Guard) Sync(ctx context.Context, ports []int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	want := make(map[int]bool, len(ports))
	for _, p := range ports {
		if p > 0 && p <= 65535 {
			want[p] = true
		}
	}
	families := g.families()
	if len(families) == 0 {
		g.Logger.Debug("hopguard: no iptables on this host, nothing to guard")
		return
	}
	changed := !g.synced || !mapsEqual(want, g.last)
	ok := true
	for _, f := range families {
		if changed {
			if out, err := g.Run(ctx, Rules(keys(want)), f.restore, "--noflush"); err != nil {
				g.Logger.Error("hopguard: writing the chain failed", "tool", f.restore, "err", err, "out", strings.TrimSpace(string(out)))
				ok = false
				continue
			}
		}
		if err := g.ensureJump(ctx, f.bin); err != nil {
			g.Logger.Error("hopguard: placing the jump failed", "tool", f.bin, "err", err)
			ok = false
		}
	}
	if !changed {
		return
	}
	g.flush(ctx, symmetricDiff(g.last, want, !g.synced))
	if ok {
		g.last, g.synced = want, true
		g.Logger.Info("hopguard: own UDP ports kept off any port-hopping redirect", "ports", keys(want))
	}
}

type family struct{ bin, restore string }

func (g *Guard) families() []family {
	var out []family
	for _, f := range []family{{"iptables", "iptables-restore"}, {"ip6tables", "ip6tables-restore"}} {
		if _, err := g.LookPath(f.bin); err != nil {
			continue
		}
		if _, err := g.LookPath(f.restore); err != nil {
			continue
		}
		out = append(out, f)
	}
	return out
}

// ensureJump puts the jump at the top of nat PREROUTING, or keeps it where it
// is when nothing that redirects stands above it. A jump found BELOW a
// REDIRECT (someone inserted theirs at the top after us) is moved: the guard
// is worth nothing behind the rule it guards against.
func (g *Guard) ensureJump(ctx context.Context, bin string) error {
	out, err := g.Run(ctx, "", bin, "-t", "nat", "-S", "PREROUTING")
	if err != nil {
		return fmt.Errorf("list nat PREROUTING: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	jump := "-A PREROUTING " + strings.Join(jumpArgs, " ")
	firstJump, firstRedirect, jumps := -1, -1, 0
	for i, l := range strings.Split(string(out), "\n") {
		l = strings.TrimSpace(l)
		switch {
		case l == jump:
			jumps++
			if firstJump < 0 {
				firstJump = i
			}
		case strings.HasPrefix(l, "-A PREROUTING ") && strings.Contains(l, " -j REDIRECT") && firstRedirect < 0:
			firstRedirect = i
		}
	}
	if jumps == 1 && (firstRedirect < 0 || firstJump < firstRedirect) {
		return nil
	}
	for i := 0; i < jumps; i++ {
		if out, err := g.Run(ctx, "", bin, append([]string{"-t", "nat", "-D", "PREROUTING"}, jumpArgs...)...); err != nil {
			return fmt.Errorf("drop a misplaced jump: %w (%s)", err, strings.TrimSpace(string(out)))
		}
	}
	if out, err := g.Run(ctx, "", bin, append([]string{"-t", "nat", "-I", "PREROUTING", "1"}, jumpArgs...)...); err != nil {
		return fmt.Errorf("insert the jump: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// flush drops the conntrack entries of every port whose treatment changed. A
// port with no entries makes conntrack exit 1 ("0 flow entries have been
// deleted"), which is the normal case and not an error. Dropping the entry of
// a flow that was fine costs nothing: its next packet makes the same entry.
func (g *Guard) flush(ctx context.Context, ports []int) {
	if len(ports) == 0 {
		return
	}
	if _, err := g.LookPath("conntrack"); err != nil {
		if !g.warnedNoTrack {
			g.Logger.Warn("hopguard: conntrack is not installed, so a flow redirected before this change keeps "+
				"its redirect until it goes idle, which a WireGuard tunnel never does; install conntrack "+
				"(bootstrap-hysteria.sh does)", "ports", ports)
			g.warnedNoTrack = true
		}
		return
	}
	for _, p := range ports {
		out, err := g.Run(ctx, "", "conntrack", "-D", "-p", "udp", "--orig-port-dst", strconv.Itoa(p))
		if err != nil && !strings.Contains(string(out), "0 flow entries") {
			g.Logger.Warn("hopguard: conntrack flush failed", "port", p, "err", err, "out", strings.TrimSpace(string(out)))
		}
	}
}

func symmetricDiff(a, b map[int]bool, all bool) []int {
	var out []int
	for p := range b {
		if all || !a[p] {
			out = append(out, p)
		}
	}
	for p := range a {
		if !b[p] {
			out = append(out, p)
		}
	}
	return sortedUnique(out)
}

func keys(m map[int]bool) []int {
	out := make([]int, 0, len(m))
	for p := range m {
		out = append(out, p)
	}
	slices.Sort(out)
	return out
}

func sortedUnique(ports []int) []int {
	out := slices.Clone(ports)
	slices.Sort(out)
	return slices.Compact(out)
}

func mapsEqual(a, b map[int]bool) bool {
	if len(a) != len(b) {
		return false
	}
	for k := range a {
		if !b[k] {
			return false
		}
	}
	return true
}
