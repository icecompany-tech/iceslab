package amneziawg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// t07-wire: the adapter takes the push's userCore.tproxy and draws it in the
// interface's hooks. awg-quick is simulated below from the config ON DISK at
// the moment it runs, which is the whole point: PostDown is whatever the file
// says when `down` is called, not what the adapter meant.

// awgHost is a machine with one awg interface: the hook state (the `host`
// model of chain_tproxy_test.go), whether the link exists, and the calls.
type awgHost struct {
	t       *testing.T
	cfgPath string
	iface   string
	state   host
	up      bool
	calls   []string
	// The PostDown lines the last `down` ran, as the file named them.
	lastDown []string
	// failOnce: the first direct add naming this, after failAfter such adds
	// went through, fails instead of applying. Then it is cleared.
	failOnce  string
	failAfter int
}

func (h *awgHost) hooks(key string) []string {
	blob, err := os.ReadFile(h.cfgPath)
	if err != nil {
		return nil
	}
	var out []string
	for _, l := range strings.Split(string(blob), "\n") {
		if v, ok := strings.CutPrefix(l, key+" = "); ok {
			out = append(out, v)
		}
	}
	return out
}

// modelLine lets the `host` model take the interface's own FORWARD rules,
// which insert (`-I FORWARD 1`) where the model knows only append and delete.
// Inserting and appending leave the same one copy, which is all it counts.
func modelLine(line string) string {
	return strings.Replace(line, " -I FORWARD 1 ", " -A FORWARD ", 1)
}

func runModel(h host, iface string, lines []string) error {
	for _, l := range lines {
		if err := h.apply(modelLine(forInterface(l, iface))); err != nil {
			return err
		}
	}
	return nil
}

func (h *awgHost) run(_ context.Context, name string, args ...string) ([]byte, error) {
	line := name + " " + strings.Join(args, " ")
	h.calls = append(h.calls, line)
	switch {
	case strings.HasSuffix(name, "awg-quick") && args[0] == "up":
		if h.up {
			return []byte("already exists"), errors.New("exit 1")
		}
		h.up = true
		if err := runModel(h.state, h.iface, h.hooks("PostUp")); err != nil {
			// awg-quick's failure trap: the link goes, PostDown does not run.
			h.up = false
			return nil, err
		}
		return nil, nil
	case strings.HasSuffix(name, "awg-quick") && args[0] == "down":
		if !h.up {
			return []byte("is not a WireGuard interface"), errors.New("exit 1")
		}
		h.up = false
		h.lastDown = h.hooks("PostDown")
		return nil, runModel(h.state, h.iface, h.lastDown)
	case name == "iptables" && len(args) >= 3 && args[2] == "-S":
		var b strings.Builder
		for k := range h.state {
			if strings.HasPrefix(k, "iptables -t mangle PREROUTING ") {
				fmt.Fprintf(&b, "-A PREROUTING %s\n", strings.TrimPrefix(k, "iptables -t mangle PREROUTING "))
			}
		}
		return []byte(b.String()), nil
	case name == "ip" && len(args) >= 2 && args[1] == "show":
		return nil, nil
	case name == "iptables" || name == "ip":
		isAdd := strings.Contains(line, " add ") || strings.Contains(line, " -A ")
		if h.failOnce != "" && isAdd && strings.Contains(line, h.failOnce) {
			if h.failAfter == 0 {
				h.failOnce = ""
				return []byte("simulated failure"), errors.New("exit 2")
			}
			h.failAfter--
		}
		return nil, h.state.apply(modelLine(line))
	}
	return nil, nil
}

func newHandoffAdapter(t *testing.T) (*Adapter, *awgHost) {
	t.Helper()
	cfgPath := filepath.Join(t.TempDir(), "awg0.conf")
	h := &awgHost{t: t, cfgPath: cfgPath, iface: "awg0", state: host{}}
	a := New(Config{
		Inbound:     validInbound(),
		ConfigPath:  cfgPath,
		AwgBin:      "/usr/bin/awg",
		AwgQuickBin: "/usr/bin/awg-quick",
		runCmd:      h.run,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.cfg.Inbound.Interface = "awg0"
	prev := interfaceExists
	interfaceExists = func(string) bool { return h.up }
	t.Cleanup(func() { interfaceExists = prev })
	return a, h
}

func handoffJSON(t *testing.T, tp ChainTProxy) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(map[string]any{"port": tp.Port, "mark": tp.Mark})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// What one up of the interface leaves with this hand-off, from a clean host.
func stateOfOneUp(t *testing.T, tp *ChainTProxy) host {
	t.Helper()
	in := validInbound()
	in.Interface = "awg0"
	in.Chain = tp
	cfg := in.withDefaults()
	lines := cfg.PostUp
	if tp != nil {
		up, _ := hooks(t, *tp)
		lines = append(append([]string{}, lines...), up...)
	}
	h := host{}
	if err := runModel(h, "awg0", lines); err != nil {
		t.Fatal(err)
	}
	return h
}

func TestTheHandOffIsDrawnAfterPostUpAndTakenBeforePostDown(t *testing.T) {
	in := validInbound()
	in.Chain = &testTProxy
	blob, err := renderConfig(in, nil)
	if err != nil {
		t.Fatal(err)
	}
	up, down := hooks(t, testTProxy)
	def := in.withDefaults()
	var gotUp, gotDown []string
	for _, l := range strings.Split(blob, "\n") {
		if v, ok := strings.CutPrefix(l, "PostUp = "); ok {
			gotUp = append(gotUp, v)
		}
		if v, ok := strings.CutPrefix(l, "PostDown = "); ok {
			gotDown = append(gotDown, v)
		}
	}
	wantUp := append(append([]string{}, def.PostUp...), up...)
	wantDown := append(append([]string{}, down...), def.PostDown...)
	if strings.Join(gotUp, "\n") != strings.Join(wantUp, "\n") {
		t.Errorf("PostUp:\n%s\nwant:\n%s", strings.Join(gotUp, "\n"), strings.Join(wantUp, "\n"))
	}
	if strings.Join(gotDown, "\n") != strings.Join(wantDown, "\n") {
		t.Errorf("PostDown:\n%s\nwant:\n%s", strings.Join(gotDown, "\n"), strings.Join(wantDown, "\n"))
	}

	// No hand-off, no line of it: a node that is no entry renders as before.
	in.Chain = nil
	plain, err := renderConfig(in, nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(plain, "TPROXY") || strings.Contains(plain, "fwmark") {
		t.Errorf("a config with no hand-off carries its lines:\n%s", plain)
	}
}

// bounced: whether awg-quick took the interface down or up since call n.
func (h *awgHost) bounced(n int) []string {
	var out []string
	for _, c := range h.calls[n:] {
		if strings.Contains(c, "awg-quick down") || strings.Contains(c, "awg-quick up") {
			out = append(out, c)
		}
	}
	return out
}

func TestAHandOffOnARunningInterfaceIsSwappedInPlaceWithoutABounce(t *testing.T) {
	// Stand run on se-02, 26.09: a bounce left clients without traffic for the
	// ~15 s WireGuard takes to notice and handshake again.
	a, h := newHandoffAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !maps.Equal(h.state, stateOfOneUp(t, nil)) {
		t.Fatalf("after Start: %v", h.state)
	}

	n := len(h.calls)
	if err := a.ApplyCascade(handoffJSON(t, testTProxy)); err != nil {
		t.Fatalf("ApplyCascade: %v", err)
	}
	if b := h.bounced(n); len(b) != 0 {
		t.Errorf("the hand-off bounced a running interface: %v", b)
	}
	if !maps.Equal(h.state, stateOfOneUp(t, &testTProxy)) {
		t.Errorf("after the hand-off the host holds %v, want one up with it, %v", h.state, stateOfOneUp(t, &testTProxy))
	}
	// And the file carries the hooks, so the next bounce draws them and its
	// down takes them away.
	up, down := hooks(t, testTProxy)
	if got := strings.Join(h.hooks("PostUp"), "\n"); !strings.Contains(got, up[len(up)-1]) {
		t.Errorf("the config on disk lacks the hand-off's PostUp:\n%s", got)
	}
	if got := h.hooks("PostDown"); len(got) == 0 || got[0] != down[0] {
		t.Errorf("the config on disk does not take the hand-off down first: %v", got)
	}
	// A bounce from here (a key change) ends in the same state.
	if _, err := h.run(context.Background(), "/usr/bin/awg-quick", "down", "awg0"); err != nil {
		t.Fatal(err)
	}
	if _, err := h.run(context.Background(), "/usr/bin/awg-quick", "up", "awg0"); err != nil {
		t.Fatal(err)
	}
	if !maps.Equal(h.state, stateOfOneUp(t, &testTProxy)) {
		t.Errorf("down and up from the file left %v", h.state)
	}

	// The same hand-off again runs nothing at all.
	n = len(h.calls)
	if err := a.ApplyCascade(handoffJSON(t, testTProxy)); err != nil {
		t.Fatal(err)
	}
	if len(h.calls) != n {
		t.Errorf("a repeated hand-off ran %v", h.calls[n:])
	}

	// Another mark (the interface's port moved): the old rules go, the new come.
	moved := ChainTProxy{Port: 25000, Mark: 0x10000 + 51830}
	if err := a.ApplyCascade(handoffJSON(t, moved)); err != nil {
		t.Fatal(err)
	}
	if !maps.Equal(h.state, stateOfOneUp(t, &moved)) {
		t.Errorf("after moving the mark: %v", h.state)
	}

	// Another tproxy port on the same mark: the ip rule and route are shared
	// and must stay, only the TPROXY lines move.
	samemark := ChainTProxy{Port: 25001, Mark: moved.Mark}
	if err := a.ApplyCascade(handoffJSON(t, samemark)); err != nil {
		t.Fatal(err)
	}
	if !maps.Equal(h.state, stateOfOneUp(t, &samemark)) {
		t.Errorf("after moving the port on one mark: %v, want %v", h.state, stateOfOneUp(t, &samemark))
	}

	// nil: the node is no entry any more, every line of the hand-off is gone.
	if err := a.ApplyCascade(nil); err != nil {
		t.Fatal(err)
	}
	if !maps.Equal(h.state, stateOfOneUp(t, nil)) {
		t.Errorf("after the hand-off was withdrawn: %v", h.state)
	}
	if b := h.bounced(n); len(b) != 0 {
		t.Errorf("changing the hand-off bounced the interface: %v", b)
	}
}

func TestASwapThatFailsHalfWayIsUndoneAndReported(t *testing.T) {
	for name, prev := range map[string]*ChainTProxy{"from none": nil, "from another mark": &testTProxy3} {
		t.Run(name, func(t *testing.T) {
			a, h := newHandoffAdapter(t)
			a.cfg.Inbound.Chain = prev
			if err := a.Start(context.Background()); err != nil {
				t.Fatal(err)
			}
			before := h.state.clone()
			disk, _ := os.ReadFile(h.cfgPath)
			// A TPROXY line of the new hand-off fails: its ip rule, route and
			// the tcp rule are in, the udp rule is not.
			h.failOnce = "0x1ca6c"
			h.failAfter = 2
			n := len(h.calls)
			if err := a.ApplyCascade(handoffJSON(t, testTProxy)); err == nil {
				t.Fatal("a swap that failed half way was reported as done")
			}
			if b := h.bounced(n); len(b) != 0 {
				t.Errorf("the failed swap bounced the interface: %v", b)
			}
			if !maps.Equal(h.state, before) {
				t.Errorf("the failed swap left %v, want the interface as it ran, %v", h.state, before)
			}
			if after, _ := os.ReadFile(h.cfgPath); string(after) != string(disk) {
				t.Error("the failed swap rewrote the config on disk")
			}
			if !chainEqual(a.cfg.Inbound.Chain, prev) {
				t.Errorf("the adapter holds %v, want the hand-off it had", a.cfg.Inbound.Chain)
			}
			// The next push tries again and goes through.
			if err := a.ApplyCascade(handoffJSON(t, testTProxy)); err != nil {
				t.Fatalf("the retry: %v", err)
			}
			if !maps.Equal(h.state, stateOfOneUp(t, &testTProxy)) {
				t.Errorf("after the retry: %v", h.state)
			}
		})
	}
}

func TestAHandOffBeforeTheInboundComesUpWithIt(t *testing.T) {
	// A fresh node: the push's ApplyCascade comes before its ApplyInbound.
	a, h := newHandoffAdapter(t)
	a.cfg.Inbound.PrivateKey = ""
	if err := a.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyCascade(handoffJSON(t, testTProxy)); err != nil {
		t.Fatal(err)
	}
	if len(h.calls) != 0 {
		t.Fatalf("a hand-off with no interface ran %v", h.calls)
	}
	if err := a.ApplyInbound(51820, wireFor(t, validInbound())); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if !maps.Equal(h.state, stateOfOneUp(t, &testTProxy)) {
		t.Errorf("the first up did not carry the hand-off: %v", h.state)
	}
}

func TestTheUpAfterAFailedOneStartsFromASweptHost(t *testing.T) {
	// The residue: an up with the hand-off went through, the interface was lost
	// with no PostDown, and a second up stopped at the route (dirtyHost).
	a, h := newHandoffAdapter(t)
	a.cfg.Inbound.Chain = &testTProxy
	up, _ := hooks(t, testTProxy)
	h.state = dirtyHost(t, "awg0", up)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start over residue: %v", err)
	}
	if !maps.Equal(h.state, stateOfOneUp(t, &testTProxy)) {
		t.Errorf("Start over residue left %v, want one up, %v", h.state, stateOfOneUp(t, &testTProxy))
	}
}

func TestAnInterfaceStillUpIsNotSweptUnderItself(t *testing.T) {
	// An agent restart: the interface is up with its rules, awg-quick up says
	// "already exists" and runs no PostUp. A sweep here would leave it bare.
	a, h := newHandoffAdapter(t)
	a.cfg.Inbound.Chain = &testTProxy
	if err := a.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	a2 := New(a.cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := a2.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !maps.Equal(h.state, stateOfOneUp(t, &testTProxy)) {
		t.Errorf("a second Start over a live interface left %v", h.state)
	}
}

func TestAHandOffThatWouldTakeTheHostDownIsRefusedAndChangesNothing(t *testing.T) {
	a, h := newHandoffAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	n := len(h.calls)
	if err := a.ApplyCascade(handoffJSON(t, ChainTProxy{Port: 25000, Mark: 254})); err == nil {
		t.Fatal("a hand-off onto the main table was accepted")
	}
	if len(h.calls) != n || a.cfg.Inbound.Chain != nil {
		t.Errorf("a refused hand-off touched the node: %v", h.calls[n:])
	}
}

func TestEachInterfaceTakesItsOwnHandOff(t *testing.T) {
	// t07-6b: the 1.x hand-off at the top of the payload, the 3.1 one under
	// tproxy3, each into its own interface's hooks.
	a, _ := twoInterfaceAdapter(t)
	if err := a.ApplyInbound(51820, inboundJSON(t, "b1", 1, nil)); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(51830, inboundJSON(t, "b3", 3, fixtureWire(t))); err != nil {
		t.Fatal(err)
	}
	both := json.RawMessage(`{"port":25000,"mark":117356,"tproxy3":{"port":25000,"mark":117366}}`)
	if err := a.ApplyCascade(both); err != nil {
		t.Fatalf("ApplyCascade: %v", err)
	}
	if a.cfg.Inbound.Chain == nil || a.cfg.Inbound.Chain.Mark != 117356 {
		t.Errorf("1.x interface holds %v", a.cfg.Inbound.Chain)
	}
	if a.v3.cfg.Inbound.Chain == nil || a.v3.cfg.Inbound.Chain.Mark != 117366 {
		t.Errorf("3.1 interface holds %v", a.v3.cfg.Inbound.Chain)
	}
	blob3, _ := os.ReadFile(a.v3.cfg.ConfigPath)
	if !strings.Contains(string(blob3), "--tproxy-mark 0x1ca76") || strings.Contains(string(blob3), "0x1ca6c") {
		t.Errorf("awg3.conf does not carry its own mark alone:\n%s", blob3)
	}

	// 3.1 alone: the 1.x interface lets go of the chain, the 3.1 one keeps it.
	if err := a.ApplyCascade(json.RawMessage(`{"tproxy3":{"port":25000,"mark":117366}}`)); err != nil {
		t.Fatal(err)
	}
	if a.cfg.Inbound.Chain != nil || a.v3.cfg.Inbound.Chain == nil {
		t.Errorf("3.1 alone: 1.x %v, 3.1 %v", a.cfg.Inbound.Chain, a.v3.cfg.Inbound.Chain)
	}
	// nil: neither.
	if err := a.ApplyCascade(nil); err != nil {
		t.Fatal(err)
	}
	if a.cfg.Inbound.Chain != nil || a.v3.cfg.Inbound.Chain != nil {
		t.Error("a push with no cascade left a hand-off")
	}
}

func TestAHandOffThatWouldSetOneInterfaceAgainstTheOtherIsRefused(t *testing.T) {
	a, _ := twoInterfaceAdapter(t)
	for name, raw := range map[string]string{
		"one mark for both": `{"port":25000,"mark":117356,"tproxy3":{"port":25000,"mark":117356}}`,
		"neither":           `{}`,
		"a bad 3.1 mark":    `{"port":25000,"mark":117356,"tproxy3":{"port":25000,"mark":254}}`,
	} {
		if err := a.ApplyCascade(json.RawMessage(raw)); err == nil {
			t.Errorf("%s: accepted", name)
		}
		if a.cfg.Inbound.Chain != nil || a.v3.cfg.Inbound.Chain != nil {
			t.Errorf("%s: a refused hand-off was applied in part", name)
		}
	}
}

// wireFor is the inbound as the panel sends it, for ApplyInbound.
func wireFor(t *testing.T, in InboundConfig) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		"serverPrivateKey": in.PrivateKey,
		"subnet":           peerNetwork(in.Address),
		"obfuscation": map[string]any{
			"jc": in.Jc, "jmin": in.Jmin, "jmax": in.Jmax,
			"s1": in.S1, "s2": in.S2, "s3": in.S3, "s4": in.S4,
			"h1": in.H1, "h2": in.H2, "h3": in.H3, "h4": in.H4,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return b
}
