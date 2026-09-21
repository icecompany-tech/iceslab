package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
)

// The installer registers an adapter for every protocol the operator might
// switch on later, so a node normally runs with several cores idle, waiting for
// an inbound that may never come. Counting those as failures made every healthy
// node report `degraded` permanently (all four of the field fleet did), which
// meant the status no longer changed when a core actually died.

// fakeCore is the smallest adapter that satisfies the interface. It does not
// implement Provisionable, so it stands for the pre-existing behaviour.
type fakeCore struct {
	name    string
	engine  string
	running bool
}

func (f *fakeCore) Name() string { return f.name }
func (f *fakeCore) Engine() string {
	if f.engine != "" {
		return f.engine
	}
	return f.name
}
func (f *fakeCore) Start(context.Context) error             { return nil }
func (f *fakeCore) Stop(context.Context) error              { return nil }
func (f *fakeCore) AddUser(core.User) error                 { return nil }
func (f *fakeCore) RemoveUser(string) error                 { return nil }
func (f *fakeCore) GetStats() (*core.Stats, error)          { return &core.Stats{}, nil }
func (f *fakeCore) Healthy() bool                           { return f.running }
func (f *fakeCore) ApplyInbound(int, json.RawMessage) error { return nil }

// provisionableCore additionally reports whether it was ever configured.
type provisionableCore struct {
	fakeCore
	provisioned bool
}

func (p *provisionableCore) Provisioned() bool { return p.provisioned }

// healthBody is the raw JSON, for the assertions that are about the WIRE rather
// than about the decoded struct: a decoder cannot tell an absent key from an
// empty list once it has filled a slice in.
func healthBody(t *testing.T, adapters ...core.CoreAdapter) string {
	t.Helper()
	s, err := New(Config{
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Payload:  &payload.Payload{},
		Adapters: adapters,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	rec := httptest.NewRecorder()
	s.handleHealth(rec, httptest.NewRequest("GET", "/healthz", nil))
	return rec.Body.String()
}

func health(t *testing.T, adapters ...core.CoreAdapter) dto.HealthcheckResponse {
	t.Helper()
	s, err := New(Config{
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Payload:  &payload.Payload{},
		Adapters: adapters,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	rec := httptest.NewRecorder()
	s.handleHealth(rec, httptest.NewRequest("GET", "/healthz", nil))
	var out dto.HealthcheckResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode /healthz: %v (body %s)", err, rec.Body.String())
	}
	return out
}

func TestUnconfiguredCoreDoesNotDegradeTheNode(t *testing.T) {
	got := health(t,
		&provisionableCore{fakeCore{name: "xray", running: true}, true},
		&provisionableCore{fakeCore{name: "shadowsocks", running: false}, false},
	)
	if got.Status != "ok" {
		t.Fatalf("status = %q, want ok: a core nobody configured is idle, not broken", got.Status)
	}
}

func TestConfiguredCoreThatIsDownDegradesTheNode(t *testing.T) {
	got := health(t,
		&provisionableCore{fakeCore{name: "xray", running: false}, true},
		&provisionableCore{fakeCore{name: "shadowsocks", running: false}, false},
	)
	if got.Status != "degraded" {
		t.Fatalf("status = %q, want degraded: a configured core is down", got.Status)
	}
}

// policyCore renders the node-level policy and resolver; xray is the only real
// adapter that does today, and that is the whole point of reporting it.
type policyCore struct {
	provisionableCore
}

func (p *policyCore) ApplyPolicy(json.RawMessage) error { return nil }
func (p *policyCore) ApplyDns(json.RawMessage) error    { return nil }

// The operator's policy is applied by the CORE, not by the node. Until the node
// said which of its cores render it, the panel showed the policy attached to a
// node whose cores ignore it, with nothing anywhere to say so.
func TestEachCoreReportsWhetherItRendersThePolicy(t *testing.T) {
	got := health(t,
		&policyCore{provisionableCore{fakeCore{name: "xray", engine: "xray", running: true}, true}},
		&provisionableCore{fakeCore{name: "tuic", engine: "singbox", running: true}, true},
		&fakeCore{name: "hysteria", engine: "hysteria", running: true},
	)
	byName := map[string]dto.CoreStatus{}
	for _, c := range got.Cores {
		byName[string(c.Name)] = c
	}
	if p := byName["xray"].RendersPolicy; p == nil || !*p {
		t.Error("xray renders the policy and has to say so")
	}
	if p := byName["tuic"].RendersPolicy; p == nil || *p {
		t.Error("tuic on sing-box renders no policy and has to say so, not stay silent")
	}
	if d := byName["xray"].RendersDns; d == nil || !*d {
		t.Error("the resolver has the same shape and the same answer for xray")
	}
	if d := byName["hysteria"].RendersDns; d == nil || *d {
		t.Error("hysteria renders no resolver and has to say so")
	}
	// The engine, not only the protocol: one node can serve tuic and vless both
	// through sing-box, and the capability belongs to the engine.
	if e := byName["tuic"].Engine; e != "singbox" {
		t.Errorf("engine = %q, want singbox", e)
	}
	if e := byName["xray"].Engine; e != "xray" {
		t.Errorf("engine = %q, want xray", e)
	}
}

// Adapters that don't report provisioning keep counting, so adding the field
// cannot silently hide a core that was being watched before.
func TestCoreThatDoesNotReportProvisioningStillCounts(t *testing.T) {
	got := health(t, &fakeCore{name: "hysteria", running: false})
	if got.Status != "degraded" {
		t.Fatalf("status = %q, want degraded: a non-reporting core must be assumed configured", got.Status)
	}
}

// The panel needs the per-core flag, not only the aggregate: it names the cores
// that are down, and must leave the idle ones out of that list.
func TestPerCoreFlagIsReported(t *testing.T) {
	got := health(t,
		&provisionableCore{fakeCore{name: "xray", running: true}, true},
		&provisionableCore{fakeCore{name: "shadowsocks", running: false}, false},
		&fakeCore{name: "hysteria", running: true},
	)
	byName := map[string]*bool{}
	for _, c := range got.Cores {
		byName[string(c.Name)] = c.Provisioned
	}
	if p := byName["xray"]; p == nil || !*p {
		t.Error("xray should report provisioned=true")
	}
	if p := byName["shadowsocks"]; p == nil || *p {
		t.Error("shadowsocks should report provisioned=false")
	}
	// Absent, not false: the panel must be able to tell "does not report" from
	// "not configured", or an older agent would look fully unconfigured.
	if p := byName["hysteria"]; p != nil {
		t.Error("a core that cannot report provisioning must omit the field")
	}
}

// portHoldingCore stands for a real adapter: it knows where its binary is and
// which sockets it opens for itself.
type portHoldingCore struct {
	fakeCore
	installed bool
	reserved  []core.ReservedPort
}

func (p *portHoldingCore) Installed() bool                    { return p.installed }
func (p *portHoldingCore) ReservedPorts() []core.ReservedPort { return p.reserved }

// A node holds ports nobody asked it to: the hysteria auth callback, the
// loopback gRPC sockets xray and sing-box open for per-user counters. The panel
// knew none of them, so a profile could be saved onto one and the node would
// then fail to bring one of the two listeners up, in its journal, hours later.
func TestCoresReportTheirOwnPorts(t *testing.T) {
	got := health(t, &portHoldingCore{
		fakeCore:  fakeCore{name: "hysteria", engine: "hysteria", running: true},
		installed: true,
		reserved: []core.ReservedPort{
			{Owner: "hysteria-auth", Port: 8080},
			{Owner: "hysteria-stats", Port: 9999},
		},
	})
	if len(got.Cores) != 1 {
		t.Fatalf("cores = %d, want 1", len(got.Cores))
	}
	c := got.Cores[0]
	if c.ReservedPorts == nil || len(*c.ReservedPorts) != 2 {
		t.Fatalf("reservedPorts = %+v, want both", c.ReservedPorts)
	}
	held := *c.ReservedPorts
	// The OWNER is a key, not a sentence: the panel is bilingual and writes the
	// words itself.
	if held[0].Owner != "hysteria-auth" || held[0].Port != 8080 {
		t.Errorf("first reserved port = %+v", held[0])
	}
	// And the transport travels rather than being assumed panel-side, the same
	// rule the port key follows: 443/TCP and 443/UDP are different sockets.
	if held[1].Transport != "tcp" {
		t.Errorf("transport = %q, want tcp", held[1].Transport)
	}
	if c.Installed == nil || !*c.Installed {
		t.Error("a core that knows its binary is present has to say so")
	}
}

// Absent is not false. An adapter that does not implement the interfaces must
// leave both fields out, so a panel can tell "this agent does not report" from
// "this core holds nothing" and refuse to promise a port on the strength of it.
func TestACoreThatDoesNotReportPortsStaysSilent(t *testing.T) {
	got := health(t, &fakeCore{name: "xray", running: true})
	c := got.Cores[0]
	if c.ReservedPorts != nil {
		t.Errorf("reservedPorts = %+v, want absent", c.ReservedPorts)
	}
	if c.Installed != nil {
		t.Errorf("installed = %v, want absent", *c.Installed)
	}
}

// A core that is configured but NOT on the machine renders nothing, and the
// panel used to show such a node applying the operator's routing policy.
func TestInstalledIsSeparateFromProvisioned(t *testing.T) {
	got := health(t, &portHoldingCore{
		fakeCore:  fakeCore{name: "xray", engine: "xray", running: false},
		installed: false,
	})
	c := got.Cores[0]
	if c.Installed == nil || *c.Installed {
		t.Fatal("a core whose binary is missing has to say installed:false, not stay silent")
	}
	// It implements the interface and holds nothing, and that is an ANSWER: the
	// empty list travels. Silence is what a core says when it cannot speak, and
	// the panel treats the two differently on purpose, or a node running only
	// cores that reserve nothing could never be answered about with certainty.
	if c.ReservedPorts == nil {
		t.Fatal("an adapter that reserves nothing must say so with [], not stay silent")
	}
	if len(*c.ReservedPorts) != 0 {
		t.Errorf("reservedPorts = %+v, want empty", *c.ReservedPorts)
	}
}

// The empty list has to survive the JSON, not just the struct: `[]` and a
// missing key are the two states this whole field exists to tell apart, and a
// stray omitempty would collapse them again without failing anything else.
func TestAnEmptyReservationTravelsAsAListAndSilenceAsNothing(t *testing.T) {
	body := healthBody(t,
		&portHoldingCore{fakeCore: fakeCore{name: "naive", running: true}, installed: true},
	)
	if !strings.Contains(body, `"reservedPorts":[]`) {
		t.Errorf("an adapter holding nothing must send an empty list: %s", body)
	}

	body = healthBody(t, &fakeCore{name: "xray", running: true})
	if strings.Contains(body, "reservedPorts") {
		t.Errorf("an adapter that cannot speak must send no key at all: %s", body)
	}
}
