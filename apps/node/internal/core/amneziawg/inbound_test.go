package amneziawg

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

func TestServerAddressFromSubnet(t *testing.T) {
	cases := []struct {
		in, out string
		err     bool
	}{
		{"10.0.0.0/24", "10.0.0.1/24", false},
		{"172.16.0.0/16", "172.16.0.1/16", false},
		{"192.168.99.0/28", "192.168.99.1/28", false},
		{"not-a-cidr", "", true},
		{"::1/128", "", true}, // IPv6 explicitly rejected
	}
	for _, c := range cases {
		got, err := serverAddressFromSubnet(c.in)
		if c.err {
			if err == nil {
				t.Errorf("serverAddressFromSubnet(%q) expected error, got %q", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("serverAddressFromSubnet(%q) unexpected error: %v", c.in, err)
		}
		if got != c.out {
			t.Errorf("serverAddressFromSubnet(%q): got %q want %q", c.in, got, c.out)
		}
	}
}

func TestClassifyDiff(t *testing.T) {
	base := InboundConfig{
		Interface: "awg0", ListenPort: 51820, Address: "10.0.0.1/24",
		PrivateKey: "k", H1: 100, H2: 200, H3: 300, H4: 400,
		S1: 72, S2: 56, S3: 32, S4: 16,
		Jc: 4, Jmin: 40, Jmax: 70,
	}

	cases := []struct {
		name string
		mut  func(c *InboundConfig)
		want diffKind
	}{
		{"identical", func(c *InboundConfig) {}, diffNone},
		{"subnet change", func(c *InboundConfig) { c.Address = "10.0.0.1/16" }, diffSubnet},
		{"private key change", func(c *InboundConfig) { c.PrivateKey = "k2" }, diffRestart},
		{"port change", func(c *InboundConfig) { c.ListenPort = 51821 }, diffRestart},
		{"H1 change", func(c *InboundConfig) { c.H1 = 999 }, diffRestart},
		{"H4 change", func(c *InboundConfig) { c.H4 = 999 }, diffRestart},
		{"S1 change", func(c *InboundConfig) { c.S1 = 88 }, diffRestart},
		{"S4 change", func(c *InboundConfig) { c.S4 = 24 }, diffRestart},
		{"Jc change", func(c *InboundConfig) { c.Jc = 8 }, diffRestart},
		{"Jmax change", func(c *InboundConfig) { c.Jmax = 100 }, diffRestart},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			next := base
			c.mut(&next)
			if got := classifyDiff(base, next); got != c.want {
				t.Errorf("classifyDiff: got %d want %d", got, c.want)
			}
		})
	}
}

func TestClassifyDiff_StrictestWins(t *testing.T) {
	old := InboundConfig{Interface: "awg0", ListenPort: 51820, Address: "10.0.0.1/24", PrivateKey: "k", H1: 100, H2: 200, H3: 300, H4: 400, S1: 72, S2: 56, S3: 32, S4: 16, Jc: 4, Jmin: 40, Jmax: 70}
	// H1 (restart) + S1 (syncconf) at once → restart should win
	new := old
	new.H1 = 999
	new.S1 = 88
	if got := classifyDiff(old, new); got != diffRestart {
		t.Errorf("strictest should be diffRestart, got %d", got)
	}

	// Subnet (subnet) + H1 (restart) → subnet wins
	new2 := old
	new2.Address = "10.0.0.1/16"
	new2.H1 = 999
	if got := classifyDiff(old, new2); got != diffSubnet {
		t.Errorf("strictest should be diffSubnet, got %d", got)
	}
}

// ───── ApplyInbound (slice 24b3) ─────

type recordingRunner struct {
	mu    sync.Mutex
	calls [][]string
}

func (r *recordingRunner) run(_ context.Context, name string, args ...string) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, append([]string{name}, args...))
	return nil, nil
}

func wirePayload(t *testing.T, mut func(m map[string]any)) []byte {
	t.Helper()
	body := map[string]any{
		"subnet":           "10.0.0.0/24",
		"serverPrivateKey": testWGPrivKey,
		"serverPublicKey":  testWGPubKeyA,
		"obfuscation": map[string]any{
			"jc": 4, "jmin": 40, "jmax": 70,
			"s1": 72, "s2": 56, "s3": 32, "s4": 16,
			"h1": 100, "h2": 200, "h3": 300, "h4": 400,
		},
	}
	if mut != nil {
		mut(body)
	}
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return b
}

func newApplyAdapter(t *testing.T, runner *recordingRunner) *Adapter {
	t.Helper()
	dir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := Config{
		Inbound: InboundConfig{
			Interface:  "awg0",
			ListenPort: 51820,
			PrivateKey: testWGPrivKey,
			Address:    "10.0.0.1/24",
			Jc:         4, Jmin: 40, Jmax: 70,
			S1: 72, S2: 56, S3: 32, S4: 16,
			H1: 100, H2: 200, H3: 300, H4: 400,
		},
		ConfigPath:  dir + "/awg0.conf",
		AwgBin:      "awg",
		AwgQuickBin: "awg-quick",
	}
	cfg.runCmd = runner.run
	return New(cfg, logger)
}

func TestApplyInbound_NoOpOnIdentical(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	if err := a.ApplyInbound(51820, wirePayload(t, func(m map[string]any) {
		m["serverPrivateKey"] = testWGPrivKey // matches initial cfg
	})); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if len(runner.calls) != 0 {
		t.Errorf("identical apply should not invoke any CLI: %v", runner.calls)
	}
}

func TestApplyInbound_RestartPathOnS1(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	// S1 change now routes through diffRestart (awg-quick down/up) because
	// the amneziawg fork doesn't apply junk/magic-size changes via syncconf
	// on a running interface, frozen at init time.
	body := wirePayload(t, func(m map[string]any) {
		m["serverPrivateKey"] = testWGPrivKey
		m["obfuscation"].(map[string]any)["s1"] = 88
	})
	if err := a.ApplyInbound(51820, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	// Should invoke awg-quick down + up (restartInterfaceLocked path)
	if len(runner.calls) == 0 {
		t.Fatalf("expected CLI invocations for restart, got none")
	}
	sawUp := false
	for _, call := range runner.calls {
		joined := strings.Join(call, " ")
		if strings.Contains(joined, "awg-quick") && strings.Contains(joined, " up ") {
			sawUp = true
			break
		}
	}
	if !sawUp {
		t.Errorf("expected `awg-quick up` after S1 change, got %v", runner.calls)
	}
}

func TestApplyInbound_RestartPathOnH1(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	body := wirePayload(t, func(m map[string]any) {
		m["serverPrivateKey"] = testWGPrivKey
		m["obfuscation"].(map[string]any)["h1"] = 9001
	})
	if err := a.ApplyInbound(51820, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	// awg-quick down + awg-quick up
	if len(runner.calls) < 2 {
		t.Fatalf("expected down+up calls, got %v", runner.calls)
	}
	if !strings.Contains(strings.Join(runner.calls[0], " "), "down") {
		t.Errorf("first call should be `awg-quick down`, got %v", runner.calls[0])
	}
	if !strings.Contains(strings.Join(runner.calls[1], " "), "up") {
		t.Errorf("second call should be `awg-quick up`, got %v", runner.calls[1])
	}
}

func TestApplyInbound_RejectsSubnetChangeWithPeers(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	// Allocate a peer first so subnet change must be rejected.
	if err := a.AddUser(core.User{
		UserID:             "u1",
		AmneziaWGPublicKey: testWGPubKeyA,
		AmneziaWGAllowedIP: "10.0.0.5/32",
	}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	runner.calls = nil // reset, AddUser also triggered a syncconf

	body := wirePayload(t, func(m map[string]any) {
		m["subnet"] = "172.16.0.0/24" // different subnet
		m["serverPrivateKey"] = testWGPrivKey
	})
	err := a.ApplyInbound(51820, body)
	if err == nil {
		t.Fatalf("expected subnet-change rejection, got nil")
	}
	if !strings.Contains(err.Error(), "subnet change rejected") {
		t.Errorf("unexpected error message: %v", err)
	}
	if len(runner.calls) != 0 {
		t.Errorf("rejected apply should not run CLI: %v", runner.calls)
	}
}

func TestApplyInbound_AcceptsSubnetChangeWithoutPeers(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	body := wirePayload(t, func(m map[string]any) {
		m["subnet"] = "172.16.0.0/24"
		m["serverPrivateKey"] = testWGPrivKey
	})
	if err := a.ApplyInbound(51820, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	// Should restart (down + up) since no peers allocated.
	if len(runner.calls) < 2 {
		t.Errorf("subnet change with no peers should restart, got %v", runner.calls)
	}
}

func TestApplyInbound_RejectsMalformedJSON(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	if err := a.ApplyInbound(51820, []byte("{not json")); err == nil {
		t.Errorf("expected parse error")
	}
	if len(runner.calls) != 0 {
		t.Errorf("no CLI on parse error, got %v", runner.calls)
	}
}

func TestApplyInbound_RejectsBadSubnet(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	body := wirePayload(t, func(m map[string]any) {
		m["subnet"] = "garbage"
		m["serverPrivateKey"] = testWGPrivKey
	})
	if err := a.ApplyInbound(51820, body); err == nil {
		t.Errorf("expected subnet parse error")
	}
}
