package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/chain"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
)

/*
A core the last applied push does not name stops, and says why.

Until this the agent only APPLIED what a push carried: a core whose last
inbound the panel removed ran on forever on its last config (a deleted host
kept serving), a --remove of that core was refused because it was running, and
a node with an installed core nobody used read as DEGRADED, "not running:
hysteria" (E26, stand 24.09). Three exceptions, each a fact of the push and not
a name: the core handed a non-empty cascade drawing keeps running, the chain
process is not an adapter and is never touched, and a push the node refused in
part stops nothing.
*/

// idleCore is a fake core that counts Idle calls and can take a cascade.
type idleCore struct {
	fakeAdapter
	idles int
	drawn []json.RawMessage
}

func (c *idleCore) Idle(_ context.Context) error {
	c.idles++
	return nil
}

type cascadeIdleCore struct{ idleCore }

func (c *cascadeIdleCore) ApplyCascade(f json.RawMessage) error {
	c.drawn = append(c.drawn, f)
	return nil
}

func inboundFor(protocol, engine string) dto.InboundDto {
	return dto.InboundDto{
		ID:       protocol + "-1",
		Name:     protocol,
		Protocol: dto.ProtocolName(protocol),
		Engine:   dto.EngineName(engine),
		Port:     443,
		Config:   json.RawMessage(`{}`),
	}
}

func healthOf(t *testing.T, s *Server) dto.HealthcheckResponse {
	t.Helper()
	rr := httptest.NewRecorder()
	s.routes().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	var h dto.HealthcheckResponse
	if err := json.NewDecoder(rr.Body).Decode(&h); err != nil {
		t.Fatal(err)
	}
	return h
}

func coreOf(h dto.HealthcheckResponse, name string) dto.CoreStatus {
	for _, c := range h.Cores {
		if string(c.Name) == name {
			return c
		}
	}
	return dto.CoreStatus{}
}

func TestACoreThePushStopsNamingIsIdledAndDoesNotDegradeTheNode(t *testing.T) {
	xray := &idleCore{fakeAdapter: fakeAdapter{name: "xray", engine: "xray"}}
	// Healthy() false: the stopped core. Before this it degraded the node.
	ss := &idleCore{fakeAdapter: fakeAdapter{name: "shadowsocks", engine: "xray", failOnStats: true}}
	s := newServerWith(t, xray, ss)

	s.applyPush(context.Background(), dto.ApplyInboundsRequest{
		Inbounds: []dto.InboundDto{inboundFor("xray", "xray"), inboundFor("shadowsocks", "xray")},
	})
	if xray.idles != 0 || ss.idles != 0 {
		t.Fatalf("a named core was idled: xray %d, ss %d", xray.idles, ss.idles)
	}

	// Two inbounds, then one: the second core goes.
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{
		Inbounds: []dto.InboundDto{inboundFor("xray", "xray")},
	})
	if ss.idles != 1 || xray.idles != 0 {
		t.Fatalf("idles after the second push: xray %d, ss %d, want 0 and 1", xray.idles, ss.idles)
	}

	h := healthOf(t, s)
	c := coreOf(h, "shadowsocks")
	if c.Running || c.Provisioned == nil || *c.Provisioned || c.Reason != core.IdleReason {
		t.Errorf("the idled core reads %+v, want running:false provisioned:false reason %q", c, core.IdleReason)
	}
	if h.Status != "ok" {
		t.Errorf("node status %q: an idle core must not degrade it", h.Status)
	}
	if coreOf(h, "xray").Reason != "" {
		t.Error("the named core carries the idle reason")
	}

	// And it comes back with the next push that names it.
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{
		Inbounds: []dto.InboundDto{inboundFor("xray", "xray"), inboundFor("shadowsocks", "xray")},
	})
	if coreOf(healthOf(t, s), "shadowsocks").Reason != "" {
		t.Error("a core named again still reads idle")
	}
}

func TestACoreHandedACascadeDrawingIsNotIdled(t *testing.T) {
	// The exit of a legacy cascade: xray serves no user, and its link-in rides
	// the fragments. Idling it would cut the leg.
	xray := &cascadeIdleCore{idleCore{fakeAdapter: fakeAdapter{name: "xray", engine: "xray"}}}
	s := newServerWith(t, xray)
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{
		Cascade: &dto.NodeCascade{Engine: "xray", Fragments: json.RawMessage(`{"inbounds":[{"tag":"cascade-link-in"}]}`)},
	})
	if xray.idles != 0 {
		t.Fatalf("the core carrying the cascade leg was idled")
	}
	if coreOf(healthOf(t, s), "xray").Reason != "" {
		t.Error("the cascade core reads idle")
	}

	// With the drawing gone and still no inbound, it has nothing left to do.
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{})
	if xray.idles != 1 {
		t.Fatalf("idles after the cascade went: %d, want 1", xray.idles)
	}
}

func TestAPushTheNodeRefusedInPartStopsNothing(t *testing.T) {
	xray := &idleCore{fakeAdapter: fakeAdapter{name: "xray", engine: "xray", failOnApply: "core rejected the config"}}
	ss := &idleCore{fakeAdapter: fakeAdapter{name: "shadowsocks", engine: "xray"}}
	s := newServerWith(t, xray, ss)
	_, failed, _ := s.applyPush(context.Background(), dto.ApplyInboundsRequest{
		Inbounds: []dto.InboundDto{inboundFor("xray", "xray")},
	})
	if failed == 0 {
		t.Fatal("the fixture push did not fail")
	}
	if ss.idles != 0 || xray.idles != 0 {
		t.Fatalf("a refused push idled a core: xray %d, ss %d", xray.idles, ss.idles)
	}
	if coreOf(healthOf(t, s), "shadowsocks").Reason != "" {
		t.Error("a refused push marked a core idle")
	}
}

func TestTheChainProcessIsNotTouchedWhenNoSingboxInboundIsNamed(t *testing.T) {
	// The chain is sing-box, but it is not an adapter: a push that names no
	// sing-box inbound idles the tuic adapter and leaves the chain as it was.
	if runtime.GOOS == "windows" {
		t.Skip("the stand-in chain binary is a shell script")
	}
	tuic := &idleCore{fakeAdapter: fakeAdapter{name: "tuic", engine: "singbox"}}
	xray := &cascadeIdleCore{idleCore{fakeAdapter: fakeAdapter{name: "vless", engine: "xray"}}}

	// A chain that really runs: the push has to apply WHOLE for anything to
	// idle, and a chain that cannot start is a refused part of it.
	dir := t.TempDir()
	bin := filepath.Join(dir, "sing-box")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\nexec sleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	life, stop := context.WithCancel(context.Background())
	t.Cleanup(stop)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	m := chain.New(chain.Config{
		BinaryPath: bin,
		ConfigPath: filepath.Join(dir, "chain", "config.json"),
		Logger:     logger,
		Lifetime:   life,
		Run: func(_ context.Context, _ string, args ...string) ([]byte, error) {
			if len(args) > 0 && args[0] == "version" {
				return []byte("sing-box version 1.13.14\n"), nil
			}
			return nil, nil
		},
	})
	s, err := New(Config{Logger: logger, Payload: &payload.Payload{}, Adapters: []core.CoreAdapter{tuic, xray}, Chain: m})
	if err != nil {
		t.Fatal(err)
	}

	if _, failed, reasons := s.applyPush(context.Background(), dto.ApplyInboundsRequest{Chain: chainBlock()}); failed != 0 {
		t.Fatalf("the fixture chain did not apply: %v", reasons)
	}
	before := m.Status()
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{Chain: chainBlock()})
	after := m.Status()
	if !after.Running {
		t.Fatalf("the chain is not running after a push that only idled an adapter: %+v", after)
	}
	if tuic.idles == 0 {
		t.Fatal("the tuic adapter nobody named was not idled")
	}
	b, _ := json.Marshal(before)
	a, _ := json.Marshal(after)
	if string(b) != string(a) {
		t.Fatalf("the chain changed on a push that only idled an adapter:\n%s\n%s", b, a)
	}
	// The xray user core took the handover drawing, so it is named.
	if xray.idles != 0 {
		t.Fatal("the core handed the chain's handover drawing was idled")
	}
}
