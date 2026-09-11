package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
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
