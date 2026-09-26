package amneziawg

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
)

// Marks as the panel mints them: 0x10000 + the interface's listen port.
var (
	testTProxy  = ChainTProxy{Port: 25000, Mark: 0x10000 + 51820}
	testTProxy3 = ChainTProxy{Port: 25000, Mark: 0x10000 + 51830}
)

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
	case strings.HasPrefix(cmd, "iptables -I INPUT 1 "):
		return "iptables -D INPUT " + strings.TrimPrefix(cmd, "iptables -I INPUT 1 ")
	}
	t.Fatalf("no inverse known for %q: a PostUp line nobody can undo", cmd)
	return ""
}

func hooks(t *testing.T, tp ChainTProxy) (up, down []string) {
	t.Helper()
	up, down, err := chainTProxyHooks(tp)
	if err != nil {
		t.Fatal(err)
	}
	return up, down
}

func TestPostDownIsTheMirrorOfPostUp(t *testing.T) {
	up, down := hooks(t, testTProxy)
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

func TestTheMarkIsAlsoTheTable(t *testing.T) {
	// One number, decision of 23.09: a second one would be a second place to
	// keep apart from everything else on the host.
	up, _ := hooks(t, testTProxy)
	want := fmt.Sprintf("ip rule add fwmark 0x%x lookup %d", testTProxy.Mark, testTProxy.Mark)
	if up[0] != want {
		t.Errorf("ip rule = %q, want %q", up[0], want)
	}
	if !strings.HasSuffix(up[1], fmt.Sprintf("table %d", testTProxy.Mark)) {
		t.Errorf("the local route does not go into the table named by the mark: %q", up[1])
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
	case strings.Contains(cmd, " -A "), strings.Contains(cmd, " -D "), strings.Contains(cmd, " -I "):
		// -I at a position adds like -A: iptables takes duplicates either way.
		add, dupOK = !strings.Contains(cmd, " -D "), true
		key = strings.NewReplacer(" -A ", " ", " -D ", " ", " -I INPUT 1 ", " INPUT ").Replace(cmd)
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

// run plays hook lines the way awg-quick does: %i substituted, stop at the
// first failure. Returns how many ran.
func (h host) run(iface string, cmds []string) (int, error) {
	for i, c := range cmds {
		if err := h.apply(forInterface(c, iface)); err != nil {
			return i, err
		}
	}
	return len(cmds), nil
}

func (h host) argv(argv []string) error { return h.apply(strings.Join(argv, " ")) }

func (h host) clone() host { return maps.Clone(h) }

func TestUpDownUpLeavesExactlyOneOfEverything(t *testing.T) {
	up, down := hooks(t, testTProxy)
	once := host{}
	if _, err := once.run("awg1", up); err != nil {
		t.Fatalf("PostUp on a clean host: %v", err)
	}
	for k, n := range once {
		if n != 1 {
			t.Errorf("one PostUp left %d copies of %s", n, k)
		}
	}

	h := host{}
	for step, cmds := range [][]string{up, down} {
		if _, err := h.run("awg1", cmds); err != nil {
			t.Fatalf("step %d: %v", step, err)
		}
	}
	if len(h) != 0 {
		t.Fatalf("PostDown after PostUp left %v behind", h)
	}
	if _, err := h.run("awg1", up); err != nil {
		t.Fatalf("the second PostUp: %v", err)
	}
	if !maps.Equal(h, once) {
		t.Errorf("up, down, up = %v; want the state of one up, %v", h, once)
	}
}

// dirtyHost is the residue the sweep exists for: an up that went through, the
// interface lost WITHOUT PostDown (awg-quick's failure trap deletes it and runs
// no PostDown), and a second up that duplicated the ip rule and stopped at the
// route.
func dirtyHost(t *testing.T, iface string, up []string) host {
	t.Helper()
	h := host{}
	if _, err := h.run(iface, up); err != nil {
		t.Fatal(err)
	}
	stopped, err := h.run(iface, up)
	if err == nil {
		t.Fatal("a second PostUp over residue went through: the TPROXY rules are now doubled in silence")
	}
	if !strings.HasPrefix(up[stopped], "ip route add ") {
		t.Fatalf("expected the second up to stop at the route, stopped at %q", up[stopped])
	}
	return h
}

func TestTheSweepMakesADirtyHostCleanForTheNextUp(t *testing.T) {
	// The test asked for on 23.09: a dirty host after a failed up, then sweep,
	// then up, equals the state of one up.
	up, down := hooks(t, testTProxy)
	once := host{}
	if _, err := once.run("awg1", up); err != nil {
		t.Fatal(err)
	}

	h := dirtyHost(t, "awg1", up)
	if err := sweepChainTProxy("awg1", down, h.argv); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(h) != 0 {
		t.Fatalf("the sweep left %v behind", h)
	}
	if _, err := h.run("awg1", up); err != nil {
		t.Fatalf("up after the sweep: %v", err)
	}
	if !maps.Equal(h, once) {
		t.Errorf("sweep then up = %v; want the state of one up, %v", h, once)
	}
}

func TestTheSweepOfACleanHostIsQuiet(t *testing.T) {
	// Every line fails at once, and that is the normal case, not an error.
	_, down := hooks(t, testTProxy)
	h := host{}
	if err := sweepChainTProxy("awg1", down, h.argv); err != nil {
		t.Fatalf("sweep of a clean host: %v", err)
	}
	if len(h) != 0 {
		t.Fatalf("the sweep of a clean host changed it: %v", h)
	}
}

func TestTheSweepDoesNotLoopOnALineThatNeverRunsOut(t *testing.T) {
	_, down := hooks(t, testTProxy)
	always := func([]string) error { return nil }
	if err := sweepChainTProxy("awg1", down, always); err == nil {
		t.Fatal("a line that keeps succeeding was swept forever, or reported as swept")
	}
}

func TestTwoInterfacesOnOneHostDoNotTouchEachOther(t *testing.T) {
	// Decision of 23.09: mark per interface. Protocol 1 and protocol 3 side by
	// side, each with its own listen port and so its own mark; taking one down,
	// or sweeping it, must leave every line of the other where it was, or that
	// interface's users leave the chain without a word.
	up1, down1 := hooks(t, testTProxy)
	up3, _ := hooks(t, testTProxy3)

	both := host{}
	if _, err := both.run("awg1", up1); err != nil {
		t.Fatal(err)
	}
	if _, err := both.run("awg3", up3); err != nil {
		t.Fatalf("the second interface could not come up beside the first: %v", err)
	}
	only3 := host{}
	if _, err := only3.run("awg3", up3); err != nil {
		t.Fatal(err)
	}

	afterDown := both.clone()
	if _, err := afterDown.run("awg1", down1); err != nil {
		t.Fatalf("PostDown of awg1: %v", err)
	}
	if !maps.Equal(afterDown, only3) {
		t.Errorf("PostDown of awg1 changed awg3: left %v, want %v", afterDown, only3)
	}

	afterSweep := both.clone()
	if err := sweepChainTProxy("awg1", down1, afterSweep.argv); err != nil {
		t.Fatalf("sweep of awg1: %v", err)
	}
	if !maps.Equal(afterSweep, only3) {
		t.Errorf("the sweep of awg1 changed awg3: left %v, want %v", afterSweep, only3)
	}
}

func TestASteeredPacketIsAcceptedAheadOfTheHostFirewall(t *testing.T) {
	// E50, ru-01 26.09: ufw's default-deny dropped every steered packet in
	// filter INPUT ("[UFW BLOCK] IN=awg0 DST=1.1.1.1 DPT=53 MARK=0x11194"),
	// because it arrives there with its foreign destination. The accept has to
	// be at the TOP of INPUT (ahead of ufw's jumps), carry this interface and
	// this mark and nothing wider, and be in place before any packet is
	// steered.
	up, down := hooks(t, testTProxy)
	mark := fmt.Sprintf("0x%x", testTProxy.Mark)
	want := "iptables -I INPUT 1 -i %i -m mark --mark " + mark + " -j ACCEPT"
	at, firstSteer := -1, -1
	for i, l := range up {
		if l == want {
			at = i
		}
		if firstSteer < 0 && strings.Contains(l, " -j TPROXY ") {
			firstSteer = i
		}
	}
	if at < 0 {
		t.Fatalf("no INPUT accept for the mark in PostUp:\n%s", strings.Join(up, "\n"))
	}
	if at > firstSteer {
		t.Errorf("the INPUT accept (line %d) comes after the first TPROXY line (%d): packets steered in between are dropped", at, firstSteer)
	}
	if !slices.Contains(down, "iptables -D INPUT -i %i -m mark --mark "+mark+" -j ACCEPT") {
		t.Errorf("PostDown does not take the INPUT accept away:\n%s", strings.Join(down, "\n"))
	}
	// The lines as the entry's interface carries them, for the stand report.
	t.Logf("PostUp:\n  %s", strings.Join(up, "\n  "))
	t.Logf("PostDown:\n  %s", strings.Join(down, "\n  "))
}

func TestEveryHookPassesTheShellWhitelist(t *testing.T) {
	up, down := hooks(t, testTProxy)
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
		"port 0":                     {Port: 0, Mark: 0x10000 + 1},
		"port above 65535":           {Port: 70000, Mark: 0x10000 + 1},
		"mark 0 (table unspecified)": {Port: 25000, Mark: 0},
		"mark 253 (table default)":   {Port: 25000, Mark: 253},
		"mark 254 (table main)":      {Port: 25000, Mark: 254},
		"mark 255 (table local)":     {Port: 25000, Mark: 255},
		"mark at 2^31":               {Port: 25000, Mark: 1 << 31},
	} {
		if _, _, err := chainTProxyHooks(tp); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
