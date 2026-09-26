package hopguard

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// hyhop is the rule bootstrap-hysteria.sh leaves in nat PREROUTING, as
// `iptables -S` prints it.
const hyhop = "-A PREROUTING -p udp -m udp --dport 20000:50000 -j REDIRECT --to-ports 443"

// host models what the guard touches, with the semantics that matter: nat
// PREROUTING in order, the guard's chain, and conntrack, where a flow keeps
// the translation nat gave its first packet for as long as it has an entry.
// A model, not a kernel: the stand run is where it meets one.
type host struct {
	prerouting []string
	chain      []string
	// conntrack by destination port: true when that flow's entry carries a
	// redirect.
	conntrack map[int]bool
	calls     []string
	missing   map[string]bool
}

func newHost(prerouting ...string) *host {
	return &host{prerouting: prerouting, conntrack: map[int]bool{}, missing: map[string]bool{}}
}

func (h *host) lookPath(bin string) (string, error) {
	if h.missing[bin] {
		return "", errors.New("not found")
	}
	return "/usr/sbin/" + bin, nil
}

func (h *host) run(_ context.Context, stdin, name string, args ...string) ([]byte, error) {
	line := strings.TrimSpace(name + " " + strings.Join(args, " "))
	h.calls = append(h.calls, line)
	jump := "-A PREROUTING " + strings.Join(jumpArgs, " ")
	switch {
	case strings.HasSuffix(name, "-restore"):
		if !strings.HasPrefix(name, "ip6") {
			h.chain = nil
			for _, l := range strings.Split(stdin, "\n") {
				if strings.HasPrefix(l, "-A "+Chain+" ") {
					h.chain = append(h.chain, strings.TrimPrefix(l, "-A "+Chain+" "))
				}
			}
		}
		return nil, nil
	case strings.HasPrefix(line, "ip6tables "):
		return nil, nil
	case line == "iptables -t nat -S PREROUTING":
		return []byte("-P PREROUTING ACCEPT\n" + strings.Join(h.prerouting, "\n") + "\n"), nil
	case line == "iptables -t nat -D PREROUTING "+strings.Join(jumpArgs, " "):
		i := slices.Index(h.prerouting, jump)
		if i < 0 {
			return []byte("Bad rule"), errors.New("exit 1")
		}
		h.prerouting = slices.Delete(h.prerouting, i, i+1)
		return nil, nil
	case line == "iptables -t nat -I PREROUTING 1 "+strings.Join(jumpArgs, " "):
		h.prerouting = append([]string{jump}, h.prerouting...)
		return nil, nil
	case strings.HasPrefix(line, "conntrack -D -p udp --orig-port-dst "):
		p, _ := strconv.Atoi(strings.TrimPrefix(line, "conntrack -D -p udp --orig-port-dst "))
		if _, ok := h.conntrack[p]; !ok {
			return []byte("conntrack v1.4.8 (conntrack-tools): 0 flow entries have been deleted."), errors.New("exit 1")
		}
		delete(h.conntrack, p)
		return nil, nil
	}
	return nil, fmt.Errorf("model does not know %q", line)
}

// packet is what nat PREROUTING does to one UDP packet: "redirect" or "keep".
// A flow with a conntrack entry is not looked at again, which is the point.
func (h *host) packet(iface string, dport int, dstLocal bool) string {
	if redirected, ok := h.conntrack[dport]; ok {
		if redirected {
			return "redirect"
		}
		return "keep"
	}
	verdict := "keep"
	for _, r := range h.prerouting {
		if r == "-A PREROUTING "+strings.Join(jumpArgs, " ") {
			if h.chainAccepts(iface, dport, dstLocal) {
				break
			}
			continue
		}
		if r == hyhop && dport >= 20000 && dport <= 50000 {
			verdict = "redirect"
			break
		}
	}
	h.conntrack[dport] = verdict == "redirect"
	return verdict
}

func (h *host) chainAccepts(iface string, dport int, dstLocal bool) bool {
	for _, r := range h.chain {
		if r == "-i awg+ -m addrtype ! --dst-type LOCAL -j ACCEPT" && strings.HasPrefix(iface, "awg") && !dstLocal {
			return true
		}
		if r == fmt.Sprintf("-p udp --dport %d -j ACCEPT", dport) {
			return true
		}
	}
	return false
}

func guard(h *host) (*Guard, *bytes.Buffer) {
	var log bytes.Buffer
	return &Guard{Logger: slog.New(slog.NewTextHandler(&log, nil)), Run: h.run, LookPath: h.lookPath}, &log
}

func TestTheStandOutageAndItsFix(t *testing.T) {
	// ru-02, 26.09: the leg tunnel on 27000 inside hysteria's hopping range.
	h := newHost(hyhop)
	if got := h.packet("ens3", 27000, true); got != "redirect" {
		t.Fatalf("the model does not reproduce the outage: %s", got)
	}
	// Keepalive and junk keep the flow's entry alive: still redirected.
	if got := h.packet("ens3", 27000, true); got != "redirect" {
		t.Fatalf("an established flow lost its redirect on its own: %s", got)
	}

	g, _ := guard(h)
	g.Sync(context.Background(), []int{27000, 24000})

	// Without the flush this would still say "redirect": the second half of
	// the stand's outage (a RETURN in place, no handshake until conntrack -D).
	if got := h.packet("ens3", 27000, true); got != "keep" {
		t.Errorf("the tunnel port after the guard: %s, want keep", got)
	}
	// Hysteria's own hopping still works for everything else in the range.
	if got := h.packet("ens3", 31337, true); got != "redirect" {
		t.Errorf("a hopping client after the guard: %s, want redirect", got)
	}
	// An AmneziaWG entry's user going to a foreign port in the range is not
	// taken to hysteria either.
	if got := h.packet("awg0", 30000, false); got != "keep" {
		t.Errorf("an awg user's UDP to a foreign host: %s, want keep", got)
	}
	t.Logf("nat PREROUTING:\n  %s\n%s:\n  %s", strings.Join(h.prerouting, "\n  "), Chain, strings.Join(h.chain, "\n  "))
}

func TestTheJumpGoesAheadOfTheRedirectAndStaysOne(t *testing.T) {
	h := newHost(hyhop)
	g, _ := guard(h)
	g.Sync(context.Background(), []int{27000})
	g.Sync(context.Background(), []int{27000, 27001})
	jump := "-A PREROUTING " + strings.Join(jumpArgs, " ")
	if !slices.Equal(h.prerouting, []string{jump, hyhop}) {
		t.Fatalf("PREROUTING = %v", h.prerouting)
	}

	// Somebody inserted their redirect at the top after us: the jump moves.
	h.prerouting = []string{hyhop, jump}
	g.Sync(context.Background(), []int{27000, 27001})
	if !slices.Equal(h.prerouting, []string{jump, hyhop}) {
		t.Fatalf("a jump behind a REDIRECT was left there: %v", h.prerouting)
	}
}

func TestOnlyWhatChangedIsRewrittenAndFlushed(t *testing.T) {
	h := newHost(hyhop)
	g, _ := guard(h)
	g.Sync(context.Background(), []int{27000, 24000})
	flushed := func() []string {
		var out []string
		for _, c := range h.calls {
			if strings.HasPrefix(c, "conntrack ") {
				out = append(out, strings.TrimPrefix(c, "conntrack -D -p udp --orig-port-dst "))
			}
		}
		h.calls = nil
		return out
	}
	// The first sync flushes every port: an agent that just started cannot
	// know what the host redirected before it.
	if got := flushed(); !slices.Equal(got, []string{"24000", "27000"}) {
		t.Errorf("first sync flushed %v", got)
	}

	g.Sync(context.Background(), []int{24000, 27000})
	for _, c := range h.calls {
		if strings.Contains(c, "-restore") {
			t.Errorf("the same set rewrote the chain: %s", c)
		}
	}
	if got := flushed(); len(got) != 0 {
		t.Errorf("the same set flushed %v", got)
	}

	g.Sync(context.Background(), []int{24000, 27001})
	if got := flushed(); !slices.Equal(got, []string{"27000", "27001"}) {
		t.Errorf("a changed set flushed %v, want the port that left and the one that came", got)
	}
}

func TestWithoutConntrackItSaysSoOnce(t *testing.T) {
	h := newHost(hyhop)
	h.missing["conntrack"] = true
	g, log := guard(h)
	g.Sync(context.Background(), []int{27000})
	g.Sync(context.Background(), []int{27001})
	if n := strings.Count(log.String(), "conntrack is not installed"); n != 1 {
		t.Errorf("the missing conntrack was reported %d times, want once:\n%s", n, log.String())
	}
}

func TestAHostWithoutIptablesIsLeftAlone(t *testing.T) {
	h := newHost()
	h.missing["iptables"], h.missing["ip6tables"] = true, true
	g, _ := guard(h)
	g.Sync(context.Background(), []int{27000})
	if len(h.calls) != 0 {
		t.Errorf("ran %v on a host with no iptables", h.calls)
	}
}

func TestTheRulesAsWritten(t *testing.T) {
	want := "*nat\n" +
		":ICESLAB-HOPKEEP - [0:0]\n" +
		"-F ICESLAB-HOPKEEP\n" +
		"-A ICESLAB-HOPKEEP -i awg+ -m addrtype ! --dst-type LOCAL -j ACCEPT\n" +
		"-A ICESLAB-HOPKEEP -p udp --dport 24000 -j ACCEPT\n" +
		"-A ICESLAB-HOPKEEP -p udp --dport 27000 -j ACCEPT\n" +
		"COMMIT\n"
	if got := Rules([]int{27000, 24000, 27000}); got != want {
		t.Errorf("Rules =\n%s\nwant\n%s", got, want)
	}
}
