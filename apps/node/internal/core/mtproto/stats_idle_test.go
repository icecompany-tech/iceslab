package mtproto

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

// E36: an mtproto the agent does not consider serving gives zeros without a
// scrape and without a WARN. The panel adds its users to every node, so an idle
// one used to scrape a port nobody listened on every 30 s.
func TestAnIdleMtprotoIsNotScraped(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		_, _ = w.Write([]byte(fakeMtgMetrics))
	}))
	defer srv.Close()

	var log bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&log, nil))
	a := New(Config{
		Inbound:    InboundConfig{Domain: "www.bing.com", Secret: "ee00", ListenPort: 443, StatsPort: 3129},
		MetricsURL: srv.URL,
	}, logger)
	_ = a.AddUser(core.User{UserID: "alice"})

	stats, _ := a.GetStats()
	if hits.Load() != 1 || stats.TotalBytesIn == 0 {
		t.Fatalf("the serving mtg was not scraped: %d hits, %+v", hits.Load(), stats)
	}

	if err := a.Idle(context.Background()); err != nil {
		t.Fatal(err)
	}
	stats, err := a.GetStats()
	if err != nil || stats.TotalBytesIn != 0 || stats.TotalBytesOut != 0 || len(stats.Users) != 1 {
		t.Fatalf("idle: %v %+v, want zeros for the one user", err, stats)
	}
	if hits.Load() != 1 {
		t.Errorf("the idle mtg was scraped: %d hits", hits.Load())
	}
	if strings.Contains(log.String(), "level=WARN") {
		t.Errorf("an idle mtg warned:\n%s", log.String())
	}

	// Where the agent runs mtg, provisioned is not enough: no process, no scrape.
	spawn := New(Config{
		BinaryPath: "/usr/local/bin/mtg",
		Inbound:    InboundConfig{Domain: "www.bing.com", Secret: "ee00", ListenPort: 443, StatsPort: 3129},
		MetricsURL: srv.URL,
	}, logger)
	_ = spawn.AddUser(core.User{UserID: "bob"})
	if _, err := spawn.GetStats(); err != nil || hits.Load() != 1 {
		t.Errorf("an mtg that is not running was scraped: %v, %d hits", err, hits.Load())
	}
}
