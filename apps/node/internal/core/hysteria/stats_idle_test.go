package hysteria

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

// countingClient answers the traffic API and counts the calls.
type countingClient struct{ calls atomic.Int32 }

func (c *countingClient) Do(*http.Request) (*http.Response, error) {
	c.calls.Add(1)
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(`{"u1":{"tx":5,"rx":7}}`)),
	}, nil
}

// E36: a hysteria the agent does not consider serving gives zeros without a
// request and without a WARN. Every adapter is registered on every node, so an
// idle one was asked anyway and warned about a refused connection every 30 s.
func TestAnIdleHysteriaIsNotAskedForStats(t *testing.T) {
	var mu sync.Mutex
	active := false
	run := func(_ context.Context, name string, args ...string) error {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case name == "systemctl" && args[0] == "restart":
			active = true
		case name == "systemctl" && args[0] == "stop":
			active = false
		case name == "systemctl" && args[0] == "is-active":
			if !active {
				return errInactive
			}
		}
		return nil
	}
	client := &countingClient{}
	var log bytes.Buffer
	a := New(Config{
		BinaryPath:         "/usr/local/bin/hysteria",
		ConfigPath:         filepath.Join(t.TempDir(), "config.yaml"),
		ServiceUnit:        "hysteria",
		ACMEEmail:          "ops@example.com",
		TrafficStatsListen: "127.0.0.1:9999",
		TrafficStatsSecret: "fixture-stats-secret-not-a-secret",
		HTTPClient:         client,
		RunCmd:             run,
	}, slog.New(slog.NewTextHandler(&log, nil)))
	_ = a.AddUser(core.User{UserID: "u1", HysteriaPassword: "p1"})

	zeros := func(when string) {
		t.Helper()
		stats, err := a.GetStats()
		if err != nil || len(stats.Users) != 1 || stats.Users[0].BytesIn != 0 || stats.Users[0].BytesOut != 0 {
			t.Fatalf("%s: %v %+v, want zeros for the one user", when, err, stats)
		}
	}

	// A fresh node: nothing applied, nothing to ask.
	zeros("before the first push")
	if client.calls.Load() != 0 {
		t.Fatalf("asked before anything was applied: %d calls", client.calls.Load())
	}

	if err := a.ApplyInbound(443, json.RawMessage(`{"hostname":"hy.example.com"}`)); err != nil {
		t.Fatal(err)
	}
	stats, _ := a.GetStats()
	if client.calls.Load() != 1 || stats.Users[0].BytesIn != 5 || stats.Users[0].BytesOut != 7 {
		t.Fatalf("the serving hysteria: %d calls, %+v", client.calls.Load(), stats)
	}

	if err := a.Idle(context.Background()); err != nil {
		t.Fatal(err)
	}
	zeros("after Idle")
	if client.calls.Load() != 1 {
		t.Errorf("the idle hysteria was asked: %d calls", client.calls.Load())
	}
	if strings.Contains(log.String(), "level=WARN") {
		t.Errorf("an idle hysteria warned:\n%s", log.String())
	}
}

var errInactive = errors.New("inactive")
