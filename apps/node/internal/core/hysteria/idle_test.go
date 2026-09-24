package hysteria

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// Idle (core.Idler) where systemd runs hysteria: the unit is STOPPED (not
// killed, not left running), once, and the same inbound pushed again restarts
// it. In spawn mode it does nothing, because ApplyInbound there never spawns
// again and a stopped hysteria would stay stopped.
func TestIdleStopsTheUnitOnceAndTheSameInboundRestartsIt(t *testing.T) {
	var mu sync.Mutex
	var calls []string
	run := func(_ context.Context, name string, args ...string) error {
		mu.Lock()
		defer mu.Unlock()
		calls = append(calls, name+" "+strings.Join(args, " "))
		return nil
	}
	a := New(Config{
		BinaryPath:  "/usr/local/bin/hysteria",
		ConfigPath:  filepath.Join(t.TempDir(), "config.yaml"),
		ServiceUnit: "hysteria",
		ACMEEmail:   "ops@example.com",
		RunCmd:      run,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	cfg := json.RawMessage(`{"hostname":"hy.example.com"}`)
	count := func(want string) int {
		mu.Lock()
		defer mu.Unlock()
		n := 0
		for _, c := range calls {
			if c == want {
				n++
			}
		}
		return n
	}

	if err := a.ApplyInbound(443, cfg); err != nil {
		t.Fatal(err)
	}
	if count("systemctl restart hysteria") != 1 {
		t.Fatalf("calls %v", calls)
	}
	if err := a.Idle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := a.Idle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if count("systemctl stop hysteria") != 1 {
		t.Fatalf("the unit was stopped %d times over two idle pushes, want once: %v", count("systemctl stop hysteria"), calls)
	}
	if err := a.ApplyInbound(443, cfg); err != nil {
		t.Fatal(err)
	}
	if count("systemctl restart hysteria") != 2 {
		t.Fatalf("the same inbound pushed again did not restart the unit: %v", calls)
	}

	spawn := New(Config{BinaryPath: "/usr/local/bin/hysteria", RunCmd: run}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	before := len(calls)
	if err := spawn.Idle(context.Background()); err != nil || len(calls) != before {
		t.Fatalf("spawn mode was touched by Idle: %v %v", err, calls[before:])
	}
}
