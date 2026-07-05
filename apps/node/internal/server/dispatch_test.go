package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
)

// fakeAdapter records calls and can be configured to fail on demand.
type fakeAdapter struct {
	name        string
	engine      string
	added       []core.User
	removed     []string
	applied     []appliedInbound
	failOnAdd   bool
	failOnStats bool
	stats       *core.Stats
}

// appliedInbound captures one ApplyInbound call so engine-routing tests can
// assert which adapter a push landed on.
type appliedInbound struct {
	port int
	cfg  json.RawMessage
}

func (f *fakeAdapter) Name() string                  { return f.name }
func (f *fakeAdapter) Engine() string                { return f.engine }
func (f *fakeAdapter) Start(_ context.Context) error { return nil }
func (f *fakeAdapter) Stop(_ context.Context) error  { return nil }
func (f *fakeAdapter) Healthy() bool                 { return !f.failOnStats /* flag re-used to simulate unhealthy */ }
func (f *fakeAdapter) ApplyInbound(port int, cfg json.RawMessage) error {
	f.applied = append(f.applied, appliedInbound{port: port, cfg: cfg})
	return nil
}
func (f *fakeAdapter) AddUser(u core.User) error {
	f.added = append(f.added, u)
	if f.failOnAdd {
		return errors.New("fake addUser fail")
	}
	return nil
}
func (f *fakeAdapter) RemoveUser(userID string) error {
	f.removed = append(f.removed, userID)
	return nil
}
func (f *fakeAdapter) GetStats() (*core.Stats, error) {
	if f.failOnStats {
		return nil, errors.New("fake getStats fail")
	}
	return f.stats, nil
}

func newServerWith(t *testing.T, adapters ...core.CoreAdapter) *Server {
	t.Helper()
	srv, err := New(Config{
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Payload:  &payload.Payload{NodeCertPem: "x", NodeKeyPem: "y", CACertPem: "z"},
		Adapters: adapters,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return srv
}

func TestAddUserDispatchesToAllAdapters(t *testing.T) {
	hys := &fakeAdapter{name: "hysteria"}
	xry := &fakeAdapter{name: "xray"}
	srv := newServerWith(t, hys, xry)

	body := `{"userId":"u-1","shortId":"s","username":"alice","credentials":{"hysteriaPassword":"hp","xrayUuid":"uu"}}`
	req := httptest.NewRequest(http.MethodPost, "/addUser", strings.NewReader(body))
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200; body=%s", rr.Code, rr.Body.String())
	}
	if len(hys.added) != 1 || hys.added[0].HysteriaPassword != "hp" {
		t.Errorf("hysteria did not receive AddUser with password: %+v", hys.added)
	}
	if len(xry.added) != 1 || xry.added[0].XrayUUID != "uu" {
		t.Errorf("xray did not receive AddUser with uuid: %+v", xry.added)
	}
}

func TestAddUserReturns500WhenAdapterFails(t *testing.T) {
	hys := &fakeAdapter{name: "hysteria", failOnAdd: true}
	srv := newServerWith(t, hys)

	body := `{"userId":"u-1","shortId":"s","username":"a","credentials":{"hysteriaPassword":"hp"}}`
	req := httptest.NewRequest(http.MethodPost, "/addUser", strings.NewReader(body))
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("status: got %d want 500", rr.Code)
	}
	var resp dto.ErrorResponse
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp.Error != "ADAPTER_FAILED" {
		t.Errorf("error code: got %q want ADAPTER_FAILED", resp.Error)
	}
}

// Regression: wave-13 best-effort fanout. A failing adapter that's NOT
// Healthy() (dormant — no ApplyInbound received yet) should be logged and
// ignored, not 500'd. Otherwise BullMQ backfill against a fresh node loops
// forever while one adapter is mid-init. fakeAdapter re-uses failOnStats as
// "simulate unhealthy" — set both flags to model "dormant + buggy".
func TestAddUserSucceedsWhenOnlyDormantAdapterFails(t *testing.T) {
	dormantBuggy := &fakeAdapter{name: "xray", failOnAdd: true, failOnStats: true}
	healthy := &fakeAdapter{name: "hysteria"}
	srv := newServerWith(t, dormantBuggy, healthy)

	body := `{"userId":"u-1","shortId":"s","username":"a","credentials":{"hysteriaPassword":"hp"}}`
	req := httptest.NewRequest(http.MethodPost, "/addUser", strings.NewReader(body))
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want 200 (dormant failure should be ignored); body=%s", rr.Code, rr.Body.String())
	}
	if len(healthy.added) != 1 {
		t.Errorf("healthy adapter should still have received AddUser: %+v", healthy.added)
	}
}

func TestRemoveUserDispatchesToAllAdapters(t *testing.T) {
	hys := &fakeAdapter{name: "hysteria"}
	xry := &fakeAdapter{name: "xray"}
	srv := newServerWith(t, hys, xry)

	body := `{"userId":"u-99"}`
	req := httptest.NewRequest(http.MethodPost, "/removeUser", strings.NewReader(body))
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rr.Code)
	}
	if len(hys.removed) != 1 || hys.removed[0] != "u-99" {
		t.Errorf("hysteria did not receive RemoveUser: %+v", hys.removed)
	}
	if len(xry.removed) != 1 || xry.removed[0] != "u-99" {
		t.Errorf("xray did not receive RemoveUser: %+v", xry.removed)
	}
}

func TestStatsAggregatesAcrossAdapters(t *testing.T) {
	hys := &fakeAdapter{
		name: "hysteria",
		stats: &core.Stats{
			Users:         []core.UserStats{{UserID: "a", BytesIn: 100, BytesOut: 200}},
			TotalBytesIn:  100,
			TotalBytesOut: 200,
		},
	}
	xry := &fakeAdapter{
		name: "xray",
		stats: &core.Stats{
			Users:         []core.UserStats{{UserID: "b", BytesIn: 50, BytesOut: 75}},
			TotalBytesIn:  50,
			TotalBytesOut: 75,
		},
	}
	srv := newServerWith(t, hys, xry)

	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rr.Code)
	}
	var resp dto.GetStatsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Users) != 2 {
		t.Errorf("users: got %d want 2", len(resp.Users))
	}
	if resp.TotalBytesIn != 150 {
		t.Errorf("totalIn: got %d want 150", resp.TotalBytesIn)
	}
	if resp.TotalBytesOut != 275 {
		t.Errorf("totalOut: got %d want 275", resp.TotalBytesOut)
	}
}

func TestStatsContinuesPastFailingAdapter(t *testing.T) {
	failing := &fakeAdapter{name: "broken", failOnStats: true}
	working := &fakeAdapter{
		name:  "hysteria",
		stats: &core.Stats{Users: []core.UserStats{{UserID: "ok"}}, TotalBytesIn: 10},
	}
	srv := newServerWith(t, failing, working)

	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rr.Code)
	}
	var resp dto.GetStatsResponse
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if len(resp.Users) != 1 || resp.Users[0].UserID != "ok" {
		t.Errorf("expected 1 user from working adapter, got %+v", resp.Users)
	}
	if resp.TotalBytesIn != 10 {
		t.Errorf("totalIn: got %d want 10", resp.TotalBytesIn)
	}
}

func TestHealthListsAllCores(t *testing.T) {
	srv := newServerWith(t,
		&fakeAdapter{name: "hysteria"},
		&fakeAdapter{name: "xray"},
	)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	var resp dto.HealthcheckResponse
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if len(resp.Cores) != 2 {
		t.Errorf("cores: got %d want 2", len(resp.Cores))
	}
	names := map[string]bool{}
	for _, c := range resp.Cores {
		names[string(c.Name)] = true
	}
	if !names["hysteria"] || !names["xray"] {
		t.Errorf("missing core in healthcheck: %+v", resp.Cores)
	}
}

// Engine-choice: two adapters share the protocol name "xray" but differ by
// engine. A push pinning engine=singbox must land ONLY on the sing-box adapter.
// port:0 keeps ensureInboundFirewall from shelling out to ufw during the test.
func TestApplyInboundsRoutesByEngine(t *testing.T) {
	native := &fakeAdapter{name: "xray", engine: "xray"}
	sb := &fakeAdapter{name: "xray", engine: "singbox"}
	srv := newServerWith(t, native, sb)

	body := `{"inbounds":[{"id":"i1","name":"vless","protocol":"xray","port":0,"engine":"singbox","config":{}}]}`
	req := httptest.NewRequest(http.MethodPost, "/applyInbounds", strings.NewReader(body))
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200; body=%s", rr.Code, rr.Body.String())
	}
	if len(sb.applied) != 1 {
		t.Errorf("singbox adapter should have received the engine=singbox inbound: %+v", sb.applied)
	}
	if len(native.applied) != 0 {
		t.Errorf("native xray adapter should NOT have received the engine=singbox inbound: %+v", native.applied)
	}
}

// An inbound with no engine field resolves to the protocol's native core, so a
// pre-engine-choice push still lands on the native adapter, not the sing-box one.
func TestApplyInboundsDefaultsToNativeEngine(t *testing.T) {
	native := &fakeAdapter{name: "xray", engine: "xray"}
	sb := &fakeAdapter{name: "xray", engine: "singbox"}
	srv := newServerWith(t, native, sb)

	body := `{"inbounds":[{"id":"i1","name":"vless","protocol":"xray","port":0,"config":{}}]}`
	req := httptest.NewRequest(http.MethodPost, "/applyInbounds", strings.NewReader(body))
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200; body=%s", rr.Code, rr.Body.String())
	}
	if len(native.applied) != 1 {
		t.Errorf("native xray adapter should have received the engine-less inbound: %+v", native.applied)
	}
	if len(sb.applied) != 0 {
		t.Errorf("singbox adapter should NOT have received the engine-less inbound: %+v", sb.applied)
	}
}
