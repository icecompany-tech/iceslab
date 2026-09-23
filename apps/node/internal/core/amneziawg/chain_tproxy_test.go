package amneziawg

import (
	"fmt"
	"strings"
	"testing"
)

var testTProxy = ChainTProxy{Port: 27001, Mark: 0x1a1, Table: 2001}

// invertHook is the test's OWN inversion, independent of chainTProxyHooks: the
// production code writes PostDown out literally, and this is what checks it.
func invertHook(t *testing.T, cmd string) string {
	t.Helper()
	switch {
	case strings.HasPrefix(cmd, "ip rule add "):
		return "ip rule del " + strings.TrimPrefix(cmd, "ip rule add ")
	case strings.HasPrefix(cmd, "ip route add "):
		return "ip route del " + strings.TrimPrefix(cmd, "ip route add ")
	case strings.HasPrefix(cmd, "iptables ") && strings.Count(cmd, " -A ") == 1:
		return strings.Replace(cmd, " -A ", " -D ", 1)
	}
	t.Fatalf("no inverse known for %q: a PostUp line nobody can undo", cmd)
	return ""
}

func TestPostDownIsTheMirrorOfPostUp(t *testing.T) {
	up, down, err := chainTProxyHooks(testTProxy)
	if err != nil {
		t.Fatal(err)
	}
	if len(down) != len(up) {
		t.Fatalf("PostUp has %d lines and PostDown %d: something is added and never taken away", len(up), len(down))
	}
	// Reverse order as well as reverse action: the route goes after the rules
	// that use it, the ip rule last.
	for i := range up {
		want := invertHook(t, up[len(up)-1-i])
		if down[i] != want {
			t.Errorf("PostDown[%d] = %q, want the inverse of PostUp[%d]: %q", i, down[i], len(up)-1-i, want)
		}
	}
}

// host is a model of the state the hooks touch, with the semantics of the real
// tools that matter here: iptables -A and ip rule add accept duplicates, ip
// route add refuses an existing route ("File exists"), and every delete of
// something absent fails. A model, not a measurement: the stand run of Ф7.4
// is where it gets checked against a kernel.
type host map[string]int

func (h host) apply(cmd string) error {
	var key string
	var add, dupOK bool
	switch {
	case strings.HasPrefix(cmd, "ip rule add "), strings.HasPrefix(cmd, "ip rule del "):
		add, dupOK = strings.HasPrefix(cmd, "ip rule add "), true
		key = "rule " + cmd[len("ip rule add "):]
	case strings.HasPrefix(cmd, "ip route add "), strings.HasPrefix(cmd, "ip route del "):
		add = strings.HasPrefix(cmd, "ip route add ")
		key = "route " + cmd[len("ip route add "):]
	case strings.Contains(cmd, " -A "), strings.Contains(cmd, " -D "):
		add, dupOK = strings.Contains(cmd, " -A "), true
		key = strings.NewReplacer(" -A ", " ", " -D ", " ").Replace(cmd)
	default:
		return fmt.Errorf("model does not know %q", cmd)
	}
	switch {
	case add && h[key] > 0 && !dupOK:
		return fmt.Errorf("%q: File exists", cmd)
	case add:
		h[key]++
	case h[key] == 0:
		return fmt.Errorf("%q: nothing to delete", cmd)
	default:
		h[key]--
		if h[key] == 0 {
			delete(h, key)
		}
	}
	return nil
}

func (h host) run(cmds []string) (int, error) {
	for i, c := range cmds {
		if err := h.apply(c); err != nil {
			return i, err
		}
	}
	return len(cmds), nil
}

func TestUpDownUpLeavesExactlyOneOfEverything(t *testing.T) {
	up, down, err := chainTProxyHooks(testTProxy)
	if err != nil {
		t.Fatal(err)
	}
	once := host{}
	if _, err := once.run(up); err != nil {
		t.Fatalf("PostUp on a clean host: %v", err)
	}
	for k, n := range once {
		if n != 1 {
			t.Errorf("one PostUp left %d copies of %s", n, k)
		}
	}

	h := host{}
	for step, cmds := range [][]string{up, down} {
		if _, err := h.run(cmds); err != nil {
			t.Fatalf("step %d: %v", step, err)
		}
	}
	if len(h) != 0 {
		t.Fatalf("PostDown after PostUp left %v behind", h)
	}
	if _, err := h.run(up); err != nil {
		t.Fatalf("the second PostUp: %v", err)
	}
	if fmt.Sprint(h) != fmt.Sprint(once) {
		t.Errorf("up, down, up = %v; want the state of one up, %v", h, once)
	}
}

// TestAnUpOverResidueFailsLoudly records the case the mirror does NOT cover: an
// interface that went away without PostDown (awg-quick's own failure trap
// deletes the interface and skips PostDown). The next up duplicates the ip
// rule and then stops at the route, so awg-quick fails the bring-up rather than
// stacking TPROXY rules in silence. Loud, but not clean: that residue is what a
// sweep before up has to take away, and it is an open decision, not a fix.
func TestAnUpOverResidueFailsLoudly(t *testing.T) {
	up, _, err := chainTProxyHooks(testTProxy)
	if err != nil {
		t.Fatal(err)
	}
	h := host{}
	if _, err := h.run(up); err != nil {
		t.Fatal(err)
	}
	stopped, err := h.run(up)
	if err == nil {
		t.Fatal("a second PostUp over residue went through: the TPROXY rules are now doubled in silence")
	}
	if !strings.HasPrefix(up[stopped], "ip route add ") {
		t.Errorf("expected the stop at the route, stopped at %q", up[stopped])
	}
}

func TestEveryHookPassesTheShellWhitelist(t *testing.T) {
	up, down, err := chainTProxyHooks(testTProxy)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range append(up, down...) {
		if err := validatePostHook(c); err != nil {
			t.Errorf("%q: %v", c, err)
		}
		// Scoped to the interface by awg-quick's own placeholder, never by a
		// name baked in here: a rule without -i would steer the whole host.
		if strings.HasPrefix(c, "iptables ") && !strings.Contains(c, " -i %i ") {
			t.Errorf("%q is not scoped to the awg interface", c)
		}
	}
}

func TestTheTProxyParametersThatWouldTakeTheHostDown(t *testing.T) {
	for name, tp := range map[string]ChainTProxy{
		"port 0":              {Port: 0, Mark: 1, Table: 2001},
		"port above 65535":    {Port: 70000, Mark: 1, Table: 2001},
		"mark 0":              {Port: 27001, Mark: 0, Table: 2001},
		"table 0":             {Port: 27001, Mark: 1, Table: 0},
		"table main (254)":    {Port: 27001, Mark: 1, Table: 254},
		"table local (255)":   {Port: 27001, Mark: 1, Table: 255},
		"table default (253)": {Port: 27001, Mark: 1, Table: 253},
	} {
		if _, _, err := chainTProxyHooks(tp); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
