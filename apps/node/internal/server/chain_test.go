package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/chain"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
)

/*
The chain as its own process, seen from the agent's edges.

The package that runs it has its own tests. What is checked HERE is the two
decisions the server makes around it, both of which are about a fleet that is
half updated:

  - for one transitional release the panel sends the chain block AND the old
    cascade fragments, so an agent too old to know the first keeps working off
    the second. An agent that knows it must ignore them, or two processes draw
    one chain and fight over the link port;
  - the healthcheck has to be able to say "no chain here", "the chain runs" and
    "the chain is down" as three different things. Reading the first as the
    third would have turned the whole fleet red the day the field shipped.
*/

// cascadeCore records what the cascade receiver was handed, which is the only
// way to tell "ignored" from "delivered" from outside.
type cascadeCore struct {
	fakeCore
	got      []json.RawMessage
	reserved []dto.ReservedPortDto
}

func (c *cascadeCore) ApplyCascade(fragments json.RawMessage) error {
	c.got = append(c.got, fragments)
	return nil
}

func (c *cascadeCore) ReservedPorts() []core.ReservedPort {
	out := make([]core.ReservedPort, 0, len(c.reserved))
	for _, r := range c.reserved {
		out = append(out, core.ReservedPort{Owner: r.Owner, Port: r.Port})
	}
	return out
}

func chainManager(t *testing.T, logger *slog.Logger) *chain.Manager {
	t.Helper()
	dir := t.TempDir()
	return chain.New(chain.Config{
		BinaryPath: filepath.Join(dir, "sing-box"),
		ConfigPath: filepath.Join(dir, "chain", "config.json"),
		Logger:     logger,
		// The engine accepts everything here: what this file is about is the
		// server's behaviour once a block took, not the check.
		Run: func(_ context.Context, _ string, args ...string) ([]byte, error) {
			if len(args) > 0 && args[0] == "version" {
				return []byte("sing-box version 1.13.14\n"), nil
			}
			return nil, nil
		},
	})
}

func chainBlock() *dto.NodeChain {
	return &dto.NodeChain{
		Engine:        "singbox",
		Config:        json.RawMessage(`{"log":{"level":"warn"},"outbounds":[{"type":"direct","tag":"direct"}]}`),
		Socks:         []dto.ChainSocks{{Tag: 0, Port: 26000}, {Tag: 1, Port: 26001}},
		SocksPassword: "chain-socks-fixture-password-0000",
	}
}

func serverWithChain(t *testing.T, logs *strings.Builder, adapters ...core.CoreAdapter) (*Server, *chain.Manager) {
	t.Helper()
	var logger *slog.Logger
	if logs != nil {
		logger = slog.New(slog.NewTextHandler(logs, nil))
	} else {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	// One logger for both: the ignore line is written by the manager and the
	// push alarms by the server, and a test that reads only one of the two
	// would miss half the story.
	m := chainManager(t, logger)
	s, err := New(Config{
		Logger:   logger,
		Payload:  &payload.Payload{},
		Adapters: adapters,
		Chain:    m,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s, m
}

func TestAChainInForceMakesTheCascadeFragmentsIgnored(t *testing.T) {
	xray := &cascadeCore{fakeCore: fakeCore{name: "vless", engine: "xray", running: true}}
	var logs strings.Builder
	s, _ := serverWithChain(t, &logs, xray)

	s.applyPush(context.Background(), dto.ApplyInboundsRequest{
		Chain: chainBlock(),
		Cascade: &dto.NodeCascade{
			Engine:    "xray",
			Fragments: json.RawMessage(`{"outbounds":[{"tag":"cascade-link-out-d1-0"}]}`),
		},
	})

	if len(xray.got) != 1 {
		t.Fatalf("the cascade receiver was called %d times, want once", len(xray.got))
	}
	// nil, not the fragments: that call is what tells the core to STOP drawing
	// the chain it used to draw. Silence would leave the old drawing in place
	// next to the new process.
	if xray.got[0] != nil {
		t.Fatalf("the core was handed cascade fragments while the chain process holds the chain: %s", xray.got[0])
	}
	// The line an incident review starts from, verbatim.
	if !strings.Contains(logs.String(), "chain block present, xray cascade fragments ignored") {
		t.Fatalf("the ignore line was not written:\n%s", logs.String())
	}
	// And NOT the older alarm about a cascade nobody drew: here that is the
	// intended state, and shouting about it teaches an operator to ignore the
	// one line that matters.
	if strings.Contains(logs.String(), "the chain is NOT applied") {
		t.Fatalf("the fail-closed alarm fired on a cascade the chain process is drawing:\n%s", logs.String())
	}
}

func TestWithoutAChainTheFragmentsStillReachTheCore(t *testing.T) {
	// The other half of the transitional release, and the half a rollback
	// depends on: a push with no chain block puts the node straight back on
	// drawing the cascade in its core, with nobody logging in to the box.
	xray := &cascadeCore{fakeCore: fakeCore{name: "vless", engine: "xray", running: true}}
	s, _ := serverWithChain(t, nil, xray)

	fragments := json.RawMessage(`{"outbounds":[{"tag":"cascade-link-out-d1-0"}]}`)
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{
		Chain:   chainBlock(),
		Cascade: &dto.NodeCascade{Engine: "xray", Fragments: fragments},
	})
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{
		Cascade: &dto.NodeCascade{Engine: "xray", Fragments: fragments},
	})

	if len(xray.got) != 2 {
		t.Fatalf("the cascade receiver was called %d times, want twice", len(xray.got))
	}
	if string(xray.got[1]) != string(fragments) {
		t.Fatalf("after the chain was withdrawn the core did not get the fragments back: %s", xray.got[1])
	}
}

func TestHealthSaysNothingAboutAChainThisNodeDoesNotRun(t *testing.T) {
	// ⚠ The rule that keeps a fleet green on the day this shipped: absence is
	// "no chain here", never "chain down". Asserted on the WIRE, because a
	// decoder cannot tell an absent key from a zero value.
	s, _ := serverWithChain(t, nil, &fakeCore{name: "vless", engine: "xray", running: true})
	rec := httptest.NewRecorder()
	s.handleHealth(rec, httptest.NewRequest("GET", "/healthz", nil))

	if strings.Contains(rec.Body.String(), `"chain"`) {
		t.Fatalf("a node with no chain still carries a chain field: %s", rec.Body.String())
	}
	var out dto.HealthcheckResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Status != "ok" {
		t.Fatalf("a node with no chain is %q, want ok", out.Status)
	}
}

func TestHealthReportsTheChainAndTheLoopbackPortsItHolds(t *testing.T) {
	xray := &cascadeCore{
		fakeCore: fakeCore{name: "vless", engine: "xray", running: true},
		reserved: []dto.ReservedPortDto{{Owner: "xray-api", Port: 10085}},
	}
	s, _ := serverWithChain(t, nil, xray)
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{Chain: chainBlock()})

	rec := httptest.NewRecorder()
	s.handleHealth(rec, httptest.NewRequest("GET", "/healthz", nil))
	var out dto.HealthcheckResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}

	if out.Chain == nil {
		t.Fatal("a node holding a chain reports none")
	}
	// The binary in these tests does not exist, so the process could not start:
	// held and not running is exactly the state the panel has to be able to see,
	// and it degrades the node because something it asked for is not happening.
	if out.Chain.Running {
		t.Fatal("the chain reports running with no binary to run")
	}
	if out.Chain.Error == "" {
		t.Fatal("the chain is down and says nothing about why")
	}
	if out.Status != "degraded" {
		t.Fatalf("a node whose chain is down is %q, want degraded", out.Status)
	}

	// The loopback ports ride along with a core's reserved ports, which is
	// where the panel already looks, and they keep the core's own entries.
	if len(out.Cores) != 1 || out.Cores[0].ReservedPorts == nil {
		t.Fatalf("no reserved ports on the core: %+v", out.Cores)
	}
	byOwner := map[string]int{}
	for _, p := range *out.Cores[0].ReservedPorts {
		byOwner[p.Owner] = p.Port
	}
	if byOwner["xray-api"] != 10085 {
		t.Fatalf("the core's own reserved port was lost: %+v", byOwner)
	}
	if byOwner[chain.PortOwner] == 0 {
		t.Fatalf("the chain's loopback ports are not reported: %+v", byOwner)
	}
}
