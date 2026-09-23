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

// The handover drawing the chain block carries for the user's core: the same
// cascade, ending in a loopback socks outbound instead of a leg.
const handoverFragments = `{"outbounds":[{"tag":"cascade-link-out-chain-d1","protocol":"socks"}]}`

func chainBlock() *dto.NodeChain {
	return &dto.NodeChain{
		Engine:        "singbox",
		Config:        json.RawMessage(`{"log":{"level":"warn"},"outbounds":[{"type":"direct","tag":"direct"}]}`),
		Socks:         []dto.ChainSocks{{Tag: 0, Port: 26000}, {Tag: 1, Port: 26001}},
		SocksPassword: "chain-socks-fixture-password-0000",
		UserCore: &dto.ChainUserCore{
			Engine:    "xray",
			Fragments: json.RawMessage(handoverFragments),
		},
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
	// The CHAIN's drawing, not the one in `cascade`. The old block is still on
	// the wire for agents that cannot see `chain` at all, and applying it here
	// would put two processes on one chain; dropping it and handing the core
	// nothing would be worse still, because an entry with no cascade routing
	// does not fail, it sends users out of the entry country.
	if string(xray.got[0]) != handoverFragments {
		t.Fatalf("the core did not get the handover drawing: %s", xray.got[0])
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
	if string(xray.got[0]) != handoverFragments {
		t.Fatalf("with the chain in force the core did not get the handover drawing: %s", xray.got[0])
	}
	if string(xray.got[1]) != string(fragments) {
		t.Fatalf("after the chain was withdrawn the core did not get the legacy fragments back: %s", xray.got[1])
	}
}

func TestATransitGetsNoDrawingAndNoAlarm(t *testing.T) {
	// A transit and an exit have no user core to hand over from: their whole
	// chain lives in the process. The core receives nil, and that is correct
	// rather than a failure, so the "nobody draws the cascade" alarm must stay
	// quiet. It fires on what there WAS to deliver, not on which block arrived.
	xray := &cascadeCore{fakeCore: fakeCore{name: "vless", engine: "xray", running: true}}
	var logs strings.Builder
	s, _ := serverWithChain(t, &logs, xray)

	block := chainBlock()
	block.UserCore = nil
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{
		Chain:   block,
		Cascade: &dto.NodeCascade{Engine: "xray", Fragments: json.RawMessage(`{"outbounds":[]}`)},
	})

	if len(xray.got) != 1 || xray.got[0] != nil {
		t.Fatalf("a transit's core was handed a drawing: %+v", xray.got)
	}
	if strings.Contains(logs.String(), "the chain is NOT applied") {
		t.Fatalf("the fail-closed alarm fired on a transit that has nothing to draw:\n%s", logs.String())
	}
}

// A hysteria entry, phase 6: the user core is told where to hand its users to,
// and only the hysteria core is told it.
func hysteriaEntryBlock() *dto.NodeChain {
	block := chainBlock()
	block.UserCore = &dto.ChainUserCore{
		Engine: "hysteria",
		Socks:  &dto.ChainUserCoreSocks{Port: 26000, Username: "chain", Password: "chain-socks-fixture-password-0000"},
	}
	return block
}

func TestAHysteriaEntryHandsTheSocksToHysteriaAndNobodyElse(t *testing.T) {
	// A node can run xray AND hysteria. The cascade's entry names ONE engine,
	// and the other core must be told "not you" (nil) rather than handed a
	// payload meant for someone else: a standalone profile on the same node is
	// not part of the cascade and must not be pulled into it.
	xray := &cascadeCore{fakeCore: fakeCore{name: "vless", engine: "xray", running: true}}
	hy := &cascadeCore{fakeCore: fakeCore{name: "hysteria", engine: "hysteria", running: true}}
	var logs strings.Builder
	s, _ := serverWithChain(t, &logs, xray, hy)

	s.applyPush(context.Background(), dto.ApplyInboundsRequest{Chain: hysteriaEntryBlock()})

	if len(hy.got) != 1 || len(xray.got) != 1 {
		t.Fatalf("each receiver is called once per push: hysteria %d, xray %d", len(hy.got), len(xray.got))
	}
	var got dto.ChainUserCoreSocks
	if err := json.Unmarshal(hy.got[0], &got); err != nil {
		t.Fatalf("hysteria was not handed the socks hand-off: %s (%v)", hy.got[0], err)
	}
	if got.Port != 26000 || got.Username != "chain" || got.Password == "" {
		t.Fatalf("hysteria got the wrong hand-off: %+v", got)
	}
	if xray.got[0] != nil {
		t.Fatalf("xray was handed a payload meant for hysteria: %s", xray.got[0])
	}
	if strings.Contains(logs.String(), "the chain is NOT applied") {
		t.Fatalf("the alarm fired on a hand-off that was delivered:\n%s", logs.String())
	}
}

func TestAUserCoreThatDoesNotMatchItsEngineReachesNobody(t *testing.T) {
	/*
		The dangerous half of the union. A hysteria block with no socks, handed on
		as "nothing", would make the hysteria core drop its hand-off and render no
		outbounds: every user of that entry would leave from the ENTRY country, with
		a working connection and nothing in any log but this one. So a mismatched
		block reaches no core at all, not even as nil, and every core stays on what
		it last applied.
	*/
	cases := map[string]*dto.ChainUserCore{
		"hysteria without socks": {Engine: "hysteria"},
		"hysteria with fragments": {
			Engine:    "hysteria",
			Socks:     &dto.ChainUserCoreSocks{Port: 26000, Username: "chain", Password: "pw"},
			Fragments: json.RawMessage(handoverFragments),
		},
		"xray without fragments": {Engine: "xray"},
		"xray with socks": {
			Engine:    "xray",
			Fragments: json.RawMessage(handoverFragments),
			Socks:     &dto.ChainUserCoreSocks{Port: 26000, Username: "chain", Password: "pw"},
		},
		"an engine that draws no user core": {Engine: "singbox", Fragments: json.RawMessage(handoverFragments)},
		"hysteria with tproxy": {
			Engine: "hysteria",
			Socks:  &dto.ChainUserCoreSocks{Port: 26000, Username: "chain", Password: "pw"},
			TProxy: &dto.ChainUserCoreTProxy{Port: 25000, Mark: 65536 + 51820},
		},
		"xray with tproxy": {
			Engine:    "xray",
			Fragments: json.RawMessage(handoverFragments),
			TProxy:    &dto.ChainUserCoreTProxy{Port: 25000, Mark: 65536 + 51820},
		},
		"amneziawg without tproxy": {Engine: "amneziawg"},
		"amneziawg with socks": {
			Engine: "amneziawg",
			TProxy: &dto.ChainUserCoreTProxy{Port: 25000, Mark: 65536 + 51820},
			Socks:  &dto.ChainUserCoreSocks{Port: 26000, Username: "chain", Password: "pw"},
		},
		"amneziawg with fragments": {
			Engine:    "amneziawg",
			TProxy:    &dto.ChainUserCoreTProxy{Port: 25000, Mark: 65536 + 51820},
			Fragments: json.RawMessage(handoverFragments),
		},
	}
	for name, uc := range cases {
		t.Run(name, func(t *testing.T) {
			xray := &cascadeCore{fakeCore: fakeCore{name: "vless", engine: "xray", running: true}}
			hy := &cascadeCore{fakeCore: fakeCore{name: "hysteria", engine: "hysteria", running: true}}
			var logs strings.Builder
			s, _ := serverWithChain(t, &logs, xray, hy)

			block := chainBlock()
			block.UserCore = uc
			s.applyPush(context.Background(), dto.ApplyInboundsRequest{Chain: block})

			if len(hy.got) != 0 || len(xray.got) != 0 {
				t.Fatalf("a refused block still reached a core: hysteria %v, xray %v", hy.got, xray.got)
			}
			if !strings.Contains(logs.String(), "chain userCore refused") {
				t.Fatalf("the refusal was silent:\n%s", logs.String())
			}
		})
	}
}

// TestAnAmneziawgHandOffNobodyDrawsYetIsLoud pins the gap between the contract
// and the door. The union knows amneziawg before the awg adapter can take a
// hand-off, and the panel refuses such an entry at the save until it can. If a
// well-formed block arrives anyway, it must land on the same alarm as any
// drawing without a taker, not pass as applied.
func TestAnAmneziawgHandOffNobodyDrawsYetIsLoud(t *testing.T) {
	awg := &fakeCore{name: "amneziawg", engine: "amneziawg", running: true}
	xray := &cascadeCore{fakeCore: fakeCore{name: "vless", engine: "xray", running: true}}
	var logs strings.Builder
	s, _ := serverWithChain(t, &logs, awg, xray)

	block := chainBlock()
	block.UserCore = &dto.ChainUserCore{
		Engine: "amneziawg",
		TProxy: &dto.ChainUserCoreTProxy{Port: 25000, Mark: 65536 + 51820},
	}
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{Chain: block})

	if strings.Contains(logs.String(), "chain userCore refused") {
		t.Fatalf("a well-formed amneziawg block was refused as malformed:\n%s", logs.String())
	}
	if !strings.Contains(logs.String(), "the chain is NOT applied") {
		t.Fatalf("an awg hand-off no core draws went by without the alarm:\n%s", logs.String())
	}
	if len(xray.got) != 1 || xray.got[0] != nil {
		t.Fatalf("xray was handed the awg hand-off: %v", xray.got)
	}
}

func TestADrawingNobodyTakesIsStillLoud(t *testing.T) {
	// The other side of the same condition: the chain handed over a drawing for
	// a core this node does not run. That is the case the alarm exists for, and
	// moving the fragments into the chain block must not have silenced it.
	other := &cascadeCore{fakeCore: fakeCore{name: "tuic", engine: "singbox", running: true}}
	var logs strings.Builder
	s, _ := serverWithChain(t, &logs, other)

	s.applyPush(context.Background(), dto.ApplyInboundsRequest{Chain: chainBlock()})

	if !strings.Contains(logs.String(), "the chain is NOT applied") {
		t.Fatalf("no core draws the handover and nothing was said:\n%s", logs.String())
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

	// The loopback ports come inside the chain's own block.
	got := map[int]string{}
	for _, p := range out.Chain.ReservedPorts {
		got[p.Port] = p.Owner
		if p.Transport != "tcp" {
			t.Fatalf("socks port %d is reported as %q, want tcp", p.Port, p.Transport)
		}
	}
	if got[26000] != chain.PortOwner || got[26001] != chain.PortOwner {
		t.Fatalf("the chain's loopback ports are not in its block: %+v", out.Chain.ReservedPorts)
	}

	// ⚠ And NOT in a core's list. They were there for one afternoon, which said
	// "xray holds 26000" about a port the chain holds and made the answer
	// depend on which cores the node runs. Asserted on the core's own entries:
	// the xray-api socket must survive and nothing else may appear beside it.
	if len(out.Cores) != 1 || out.Cores[0].ReservedPorts == nil {
		t.Fatalf("no reserved ports on the core: %+v", out.Cores)
	}
	for _, p := range *out.Cores[0].ReservedPorts {
		if p.Owner == chain.PortOwner {
			t.Fatalf("a chain port is reported as the core's: %+v", p)
		}
	}
	if len(*out.Cores[0].ReservedPorts) != 1 || (*out.Cores[0].ReservedPorts)[0].Port != 10085 {
		t.Fatalf("the core's own reserved ports changed: %+v", *out.Cores[0].ReservedPorts)
	}
}

func TestChainPortsAreNotInTheCoresRawJson(t *testing.T) {
	// The same rule read off the WIRE rather than the decoded struct, because
	// the mistake this guards was a placement mistake and a decoder hides
	// placement: it would fill the same field whichever list the entry came in.
	xray := &cascadeCore{
		fakeCore: fakeCore{name: "vless", engine: "xray", running: true},
		reserved: []dto.ReservedPortDto{{Owner: "xray-api", Port: 10085}},
	}
	s, _ := serverWithChain(t, nil, xray)
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{Chain: chainBlock()})
	rec := httptest.NewRecorder()
	s.handleHealth(rec, httptest.NewRequest("GET", "/healthz", nil))

	body := rec.Body.String()
	coresPart := body[strings.Index(body, `"cores"`):strings.Index(body, `"chain"`)]
	if strings.Contains(coresPart, chain.PortOwner) {
		t.Fatalf("chain-socks appears inside cores:\n%s", coresPart)
	}
	if !strings.Contains(body[strings.Index(body, `"chain"`):], chain.PortOwner) {
		t.Fatalf("chain-socks does not appear inside the chain block:\n%s", body)
	}
}
