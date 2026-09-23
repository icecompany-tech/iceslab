package hysteria

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// goldenCfg exercises every section renderConfig can emit, so a golden taken
// from it pins all of them and not only the minimal shape.
var goldenCfg = Config{
	Hostname:           "hy2.example.com",
	ACMEEmail:          "admin@example.com",
	AuthCallbackHost:   "127.0.0.1",
	AuthCallbackPort:   9000,
	AuthCallbackPath:   "/auth/fixture-path-not-a-secret",
	ListenPort:         443,
	TrafficStatsListen: "127.0.0.1:9999",
	TrafficStatsSecret: "fixture-stats-secret-not-a-secret",
}

var goldenInbound = InboundConfig{
	Port:           8443,
	ObfsPassword:   "fixture-salt-not-a-secret",
	MasqueradeURL:  "https://www.bing.com",
	BrutalUpMbps:   100,
	BrutalDownMbps: 200,
}

// checkGolden compares got with testdata/<name>, or writes it when
// UPDATE_GOLDEN is set. Retaking a golden is a deliberate act with a flag on it,
// and the diff is read by a human before it is committed.
func checkGolden(t *testing.T, name string, got []byte) {
	t.Helper()
	path := filepath.Join("testdata", name)
	if os.Getenv("UPDATE_GOLDEN") != "" {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("no golden at %s: take it on a green run with UPDATE_GOLDEN=1 and read it before committing", path)
	}
	if string(got) != string(want) {
		t.Errorf("render differs from %s\n--- got ---\n%s--- want ---\n%s", path, got, want)
	}
}

// TestRenderWithoutChainIsUnchanged pins the node that is NOT a hysteria entry.
//
// ⚠ The golden was taken from the renderer BEFORE phase 6 touched it, on
// 2026-09-23. Every hysteria node in the field today renders this shape, and a
// hand-off to the chain must not move a single byte of it for a node that has
// none: an unrelated node restarting its core on deploy is the least of it, a
// changed default route would be the worst.
func TestRenderWithoutChainIsUnchanged(t *testing.T) {
	blob, err := renderConfig(goldenCfg, goldenInbound, nil)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	checkGolden(t, "config-no-chain.yaml", blob)
}

// The hand-off the panel sends a hysteria entry: the chain's "Auto" listener
// (tag 0 is always rendered for a hysteria entry), the chain's fixed user, and
// a password.
//
// ⚠ The fixture password is the chain's existing one, already allowed BY VALUE
// in .gitleaks.toml since phase 4. A base64 look-alike of a real chain secret
// tripped the generic-api-key rule inside this golden, and a golden is exactly
// where somebody will one day paste a real key, so the answer is a value that
// says what it is, not a wider allowlist.
var goldenHandoff = &ChainHandoff{
	Port:     26000,
	Username: "chain",
	Password: "chain-socks-fixture-password-0000",
}

func TestRenderWithChainMatchesTheGolden(t *testing.T) {
	blob, err := renderConfig(goldenCfg, goldenInbound, goldenHandoff)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	checkGolden(t, "config-chain.yaml", blob)
}

// TestChainAddsOneBlockAndMovesNothingElse is the golden read as a diff.
//
// Every byte before the hand-off must be the byte a node without a chain
// renders. A hand-off that reordered a key or rewrote the auth block would
// still pass a golden taken from itself, which is why this compares the two
// renders against each other rather than each against its own file.
func TestChainAddsOneBlockAndMovesNothingElse(t *testing.T) {
	without, err := renderConfig(goldenCfg, goldenInbound, nil)
	if err != nil {
		t.Fatal(err)
	}
	with, err := renderConfig(goldenCfg, goldenInbound, goldenHandoff)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(with), string(without)) {
		t.Fatal("the hand-off changed something other than appending its own block")
	}
	added := strings.TrimPrefix(string(with), string(without))
	want := "\noutbounds:\n" +
		"  - name: chain\n" +
		"    type: socks5\n" +
		"    socks5:\n" +
		"      addr: 127.0.0.1:26000\n" +
		"      username: chain\n" +
		"      password: chain-socks-fixture-password-0000\n"
	if added != want {
		t.Errorf("the hand-off block is not the measured shape\n--- got ---\n%s--- want ---\n%s", added, want)
	}
}

// TestChainIsTheOnlyWayOut pins the three absences the measurement demands.
//
// Measured against 2.12.3 on 2026-09-23: with no acl the FIRST outbound takes
// every user, and a second one is never used. So the render must have exactly
// one outbound, it must be the chain, and there must be no `direct` and no
// `acl` anywhere. A `direct` placed first would send every user straight out
// of the entry country with a working connection and no error, which is a leak
// past the cascade that looks like everything working.
func TestChainIsTheOnlyWayOut(t *testing.T) {
	blob, err := renderConfig(goldenCfg, goldenInbound, goldenHandoff)
	if err != nil {
		t.Fatal(err)
	}
	got := string(blob)
	if strings.Count(got, "  - name: ") != 1 {
		t.Errorf("expected exactly one outbound, render:\n%s", got)
	}
	if !strings.Contains(got, "outbounds:\n  - name: chain\n    type: socks5\n") {
		t.Errorf("the first outbound is not the chain's socks5:\n%s", got)
	}
	for _, forbidden := range []string{"type: direct", "\nacl:"} {
		if strings.Contains(got, forbidden) {
			t.Errorf("render contains %q, which would decide routing beside the chain:\n%s", forbidden, got)
		}
	}
}

func TestChainGoesToLoopbackOnly(t *testing.T) {
	// The panel sends a port; the address is written here. A broken or
	// compromised panel can point the hand-off at another port on this machine
	// and at nothing else.
	blob, err := renderConfig(goldenCfg, goldenInbound, &ChainHandoff{Port: 26003, Username: "chain", Password: "pw"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(blob), "      addr: 127.0.0.1:26003\n") {
		t.Errorf("the hand-off is not on loopback:\n%s", blob)
	}
}

func TestChainHandoffIsRefusedWhenMalformed(t *testing.T) {
	cases := map[string]*ChainHandoff{
		"port zero":        {Port: 0, Username: "chain", Password: "pw"},
		"port too high":    {Port: 70000, Username: "chain", Password: "pw"},
		"no username":      {Port: 26000, Password: "pw"},
		"no password":      {Port: 26000, Username: "chain"},
		"yaml in password": {Port: 26000, Username: "chain", Password: "pw\nacl:"},
		"colon in user":    {Port: 26000, Username: "ch:ain", Password: "pw"},
	}
	for name, h := range cases {
		t.Run(name, func(t *testing.T) {
			// Refused, not rendered: a password that could close its scalar would
			// let a hostile push add its own `acl` or `direct` after it.
			if _, err := renderConfig(goldenCfg, goldenInbound, h); err == nil {
				t.Errorf("rendered a malformed hand-off %+v", *h)
			}
		})
	}
}

// ApplyCascade, the node-level half. These write through atomicfile, so run
// the package in WSL locally (fsync on a directory is refused on Windows).

func handoffJSON(t *testing.T, h *ChainHandoff) json.RawMessage {
	t.Helper()
	if h == nil {
		return nil
	}
	blob, err := json.Marshal(chainHandoffWire{Port: h.Port, Username: h.Username, Password: h.Password})
	if err != nil {
		t.Fatal(err)
	}
	return blob
}

func TestApplyCascade_HandsOffAndRestartsOnce(t *testing.T) {
	runner := &recordingRunner{}
	a, cfgPath := newApplyInboundAdapter(t, runner)
	if err := a.ApplyInbound(443, json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	before := len(runner.snapshot())

	if err := a.ApplyCascade(handoffJSON(t, goldenHandoff)); err != nil {
		t.Fatal(err)
	}
	// The same hand-off again is a no-op: a push that repeats itself must not
	// drop every live connection on the node.
	if err := a.ApplyCascade(handoffJSON(t, goldenHandoff)); err != nil {
		t.Fatal(err)
	}
	if got := len(runner.snapshot()) - before; got != 1 {
		t.Errorf("expected one restart for the hand-off, got %d", got)
	}
	blob, _ := os.ReadFile(cfgPath)
	if !strings.Contains(string(blob), "addr: 127.0.0.1:26000") {
		t.Errorf("written config has no hand-off:\n%s", blob)
	}
}

func TestApplyCascade_NilTakesTheHandoffAway(t *testing.T) {
	// The cascade was disabled, or its entry moved to another core: this node is
	// no longer a hysteria entry and renders exactly what it did before phase 6.
	runner := &recordingRunner{}
	a, cfgPath := newApplyInboundAdapter(t, runner)
	if err := a.ApplyInbound(443, json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyCascade(handoffJSON(t, goldenHandoff)); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyCascade(nil); err != nil {
		t.Fatal(err)
	}
	blob, _ := os.ReadFile(cfgPath)
	if strings.Contains(string(blob), "outbounds:") {
		t.Errorf("the hand-off survived its removal:\n%s", blob)
	}
}

func TestApplyCascade_BeforeAnyInboundIsRememberedNotWritten(t *testing.T) {
	// ApplyCascade runs BEFORE the inbounds of the same push. On a fresh node
	// there is nothing on disk yet, so it is remembered, and the ApplyInbound of
	// that same push renders it.
	runner := &recordingRunner{}
	a, cfgPath := newApplyInboundAdapter(t, runner)
	if err := a.ApplyCascade(handoffJSON(t, goldenHandoff)); err != nil {
		t.Fatal(err)
	}
	if len(runner.snapshot()) != 0 {
		t.Errorf("restarted a core that has no config yet: %v", runner.snapshot())
	}
	if _, err := os.Stat(cfgPath); err == nil {
		t.Error("wrote a config before any inbound arrived")
	}
	if err := a.ApplyInbound(443, json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	blob, _ := os.ReadFile(cfgPath)
	if !strings.Contains(string(blob), "addr: 127.0.0.1:26000") {
		t.Errorf("the remembered hand-off did not reach the first render:\n%s", blob)
	}
}

func TestApplyCascade_RefusedHandoffIsNotKept(t *testing.T) {
	// A hand-off the renderer refuses must not become the state the next
	// ApplyInbound renders against, or the refusal would come back as a config
	// on the following push.
	runner := &recordingRunner{}
	a, cfgPath := newApplyInboundAdapter(t, runner)
	if err := a.ApplyInbound(443, json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyCascade(handoffJSON(t, &ChainHandoff{Port: 26000, Username: "chain", Password: "pw\nacl:"})); err == nil {
		t.Fatal("accepted a hand-off with YAML in its password")
	}
	if err := a.ApplyInbound(8443, json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	blob, _ := os.ReadFile(cfgPath)
	if strings.Contains(string(blob), "outbounds:") {
		t.Errorf("the refused hand-off was rendered by the next push:\n%s", blob)
	}
}
