package mtproto

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

func newConfigOnlyAdapter(t *testing.T) *Adapter {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	domain := "www.cloudflare.com"
	return New(Config{
		Inbound: InboundConfig{
			Domain:     domain,
			Secret:     DeriveSecret("inbound-1", domain),
			ListenPort: 443,
			StatsPort:  3129,
		},
	}, logger)
}

func TestNameMatchesProtocol(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if a.Name() != Name {
		t.Errorf("Name: got %q want %q", a.Name(), Name)
	}
}

// Per single-secret architecture, AddUser/RemoveUser are bookkeeping no-ops
// — mtg has no per-user concept.
func TestAddUser_BookkeepingOnly(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.AddUser(core.User{UserID: "u-1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if _, ok := a.users["u-1"]; !ok {
		t.Errorf("AddUser should track userID for GetStats reporting")
	}
}

func TestRemoveUser_BookkeepingOnly(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	_ = a.AddUser(core.User{UserID: "u-1"})
	if err := a.RemoveUser("u-1"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	if _, ok := a.users["u-1"]; ok {
		t.Errorf("RemoveUser did not clear userID")
	}
}

func TestApplyInbound_RejectsMissingDomain(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{"secret": "ee01"})
	if err := a.ApplyInbound(443, body); err == nil || !strings.Contains(err.Error(), "domain is required") {
		t.Errorf("expected domain-required error, got %v", err)
	}
}

func TestApplyInbound_RejectsMissingSecret(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{"domain": "www.cloudflare.com"})
	if err := a.ApplyInbound(443, body); err == nil || !strings.Contains(err.Error(), "secret is required") {
		t.Errorf("expected secret-required error, got %v", err)
	}
}

func TestApplyInbound_RejectsMalformedJSON(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.ApplyInbound(443, []byte("{not json")); err == nil {
		t.Errorf("expected parse error")
	}
}

func TestApplyInbound_DomainAndSecretChangeUpdatesAdapter(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	newDomain := "www.google.com"
	newSecret := DeriveSecret("inbound-1", newDomain)
	body, _ := json.Marshal(map[string]any{
		"domain": newDomain,
		"secret": newSecret,
	})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.cfg.Inbound.Domain != newDomain {
		t.Errorf("Domain not updated: %q", a.cfg.Inbound.Domain)
	}
	if a.cfg.Inbound.Secret != newSecret {
		t.Errorf("Secret not updated: %q", a.cfg.Inbound.Secret)
	}
	if !a.started {
		t.Errorf("started should be true after regenerate")
	}
}

func TestApplyInbound_NoOpOnIdenticalConfig(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	domain := a.cfg.Inbound.Domain
	secret := a.cfg.Inbound.Secret
	body, _ := json.Marshal(map[string]any{"domain": domain, "secret": secret})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.started {
		t.Errorf("identical apply should not have started")
	}
}

// Real mtg Prometheus output (verified live 2026-05-13 on aeza-se-p1). Two
// telegram DC IPs, each with from_client + to_client direction.
const fakeMtgMetrics = `# HELP mtg_client_connections A number of actively processing client connections.
mtg_client_connections{ip_family="ipv4"} 0
# HELP mtg_domain_fronting_traffic Traffic which is generated talking with front domain.
mtg_domain_fronting_traffic{direction="from_client"} 103831
mtg_domain_fronting_traffic{direction="to_client"} 358581
# HELP mtg_telegram_traffic Traffic which is generated talking with Telegram servers.
mtg_telegram_traffic{dc="2",direction="from_client",telegram_ip="149.154.167.51"} 24543
mtg_telegram_traffic{dc="2",direction="from_client",telegram_ip="95.161.76.100"} 55454
mtg_telegram_traffic{dc="2",direction="to_client",telegram_ip="149.154.167.51"} 62670
mtg_telegram_traffic{dc="2",direction="to_client",telegram_ip="95.161.76.100"} 483306
`

func TestParseMtgTelegramTraffic_SumsAcrossLabels(t *testing.T) {
	in, out, err := parseMtgTelegramTraffic(fakeMtgMetrics)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	const wantIn = int64(24543 + 55454)
	const wantOut = int64(62670 + 483306)
	if in != wantIn {
		t.Errorf("from_client sum: got %d want %d", in, wantIn)
	}
	if out != wantOut {
		t.Errorf("to_client sum: got %d want %d", out, wantOut)
	}
}

func TestParseMtgTelegramTraffic_IgnoresFrontingAndOtherMetrics(t *testing.T) {
	// mtg_domain_fronting_traffic must NOT be counted — it's SNI-probe
	// camouflage traffic, not user traffic.
	in, _, err := parseMtgTelegramTraffic(fakeMtgMetrics)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if in == 103831 || in == 103831+24543+55454 {
		t.Errorf("fronting traffic leaked into in-bytes total: %d", in)
	}
}

func TestGetStats_ScrapesPrometheusAndPopulatesTotals(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(fakeMtgMetrics))
	}))
	defer srv.Close()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{
		Inbound:    InboundConfig{Domain: "www.bing.com", Secret: "ee00", ListenPort: 443, StatsPort: 3129},
		MetricsURL: srv.URL,
	}, logger)
	_ = a.AddUser(core.User{UserID: "alice"})
	_ = a.AddUser(core.User{UserID: "bob"})

	stats, err := a.GetStats()
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}
	if len(stats.Users) != 2 {
		t.Errorf("user count: got %d want 2", len(stats.Users))
	}
	const wantIn = int64(24543 + 55454)
	const wantOut = int64(62670 + 483306)
	if stats.TotalBytesIn != wantIn || stats.TotalBytesOut != wantOut {
		t.Errorf("totals: got %d/%d want %d/%d",
			stats.TotalBytesIn, stats.TotalBytesOut, wantIn, wantOut)
	}
	// Per-user counters remain zero — single-secret architecture.
	for _, u := range stats.Users {
		if u.BytesIn != 0 || u.BytesOut != 0 {
			t.Errorf("per-user counter must be zero for mtproto, got %+v", u)
		}
	}
}

func TestGetStats_PrometheusUnreachableReturnsZeroNoError(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{
		Inbound:    InboundConfig{Domain: "www.bing.com", Secret: "ee00", ListenPort: 443, StatsPort: 3129},
		MetricsURL: "http://127.0.0.1:1/never-listens",
	}, logger)
	_ = a.AddUser(core.User{UserID: "u1"})

	stats, err := a.GetStats()
	if err != nil {
		t.Fatalf("GetStats should fall back, not error: %v", err)
	}
	if stats.TotalBytesIn != 0 || stats.TotalBytesOut != 0 {
		t.Errorf("totals: expected zero fallback, got %d/%d",
			stats.TotalBytesIn, stats.TotalBytesOut)
	}
}
