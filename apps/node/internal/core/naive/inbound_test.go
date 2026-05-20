package naive

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

func TestInboundEqual(t *testing.T) {
	a := InboundConfig{Hostname: "h.example", ListenPort: 443, TLSEmail: "e@x", MasqueradeRoot: "/var/www/html"}
	b := InboundConfig{Hostname: "h.example", ListenPort: 443, TLSEmail: "e@x", MasqueradeRoot: "/var/www/html"}
	if !inboundEqual(a, b) {
		t.Errorf("equal structs reported different")
	}
	b.Hostname = "other.example"
	if inboundEqual(a, b) {
		t.Errorf("differing Hostname reported equal")
	}
}

func TestInboundCfgWireRoundtrip(t *testing.T) {
	w := inboundCfgWire{
		Hostname:       "h.example",
		TLSEmail:       "e@x.io",
		MasqueradeRoot: "/srv/www",
	}
	got := w.toInboundConfig(8443)
	want := InboundConfig{
		Hostname:       "h.example",
		ListenPort:     8443,
		TLSEmail:       "e@x.io",
		MasqueradeRoot: "/srv/www",
	}
	if !inboundEqual(got, want) {
		t.Errorf("toInboundConfig mismatch:\n got %+v\nwant %+v", got, want)
	}
}

// ───── ApplyInbound (slice 24b4) ─────

type recordingRunner struct {
	mu    sync.Mutex
	calls [][]string
}

func (r *recordingRunner) run(_ context.Context, name string, args ...string) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, append([]string{name}, args...))
	return nil, nil
}

func newApplyAdapter(t *testing.T, runner *recordingRunner) *Adapter {
	t.Helper()
	dir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := Config{
		Inbound: InboundConfig{
			Hostname:       "naive.example.com",
			ListenPort:     443,
			TLSEmail:       "admin@example.com",
			MasqueradeRoot: "/var/www/html",
		},
		CaddyfilePath: dir + "/Caddyfile",
		CaddyBin:      "caddy",
		runCmd:        runner.run,
	}
	a := New(cfg, logger)
	// Tests exercise the `caddy reload` (already-running) path. Marking
	// proc as non-nil so regenerateAndReloadLocked skips the production
	// cold-start branch that spawns a real subprocess (caddy binary isn't
	// on PATH in CI). The zero-value subprocess is never invoked by the
	// reload path — only its presence matters.
	a.proc = &subprocess.Subprocess{}
	a.started = true
	return a
}

func wirePayload(t *testing.T, mut func(m map[string]any)) []byte {
	t.Helper()
	body := map[string]any{
		"hostname":       "naive.example.com",
		"tlsEmail":       "admin@example.com",
		"masqueradeRoot": "/var/www/html",
	}
	if mut != nil {
		mut(body)
	}
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func TestApplyInbound_NoOpOnIdentical(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	if err := a.ApplyInbound(443, wirePayload(t, nil)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if len(runner.calls) != 0 {
		t.Errorf("identical apply should not invoke caddy reload: %v", runner.calls)
	}
}

func TestApplyInbound_HostnameChange_TriggersReload(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	body := wirePayload(t, func(m map[string]any) {
		m["hostname"] = "new-host.example.com"
	})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	if len(runner.calls) != 1 {
		t.Fatalf("expected exactly 1 caddy reload call, got %d: %v", len(runner.calls), runner.calls)
	}
	joined := strings.Join(runner.calls[0], " ")
	if !strings.Contains(joined, "reload") {
		t.Errorf("expected `caddy reload`, got %v", runner.calls[0])
	}
}

func TestApplyInbound_MasqueradeRootChange_TriggersReload(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	body := wirePayload(t, func(m map[string]any) {
		m["masqueradeRoot"] = "/var/www/different"
	})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if len(runner.calls) != 1 {
		t.Errorf("expected 1 reload, got %d", len(runner.calls))
	}
}

func TestApplyInbound_TLSEmailChange_TriggersReload(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	body := wirePayload(t, func(m map[string]any) {
		m["tlsEmail"] = "new@admin.io"
	})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if len(runner.calls) != 1 {
		t.Errorf("expected 1 reload, got %d", len(runner.calls))
	}
}

func TestApplyInbound_RejectsMalformedJSON(t *testing.T) {
	runner := &recordingRunner{}
	a := newApplyAdapter(t, runner)

	if err := a.ApplyInbound(443, []byte("{not json")); err == nil {
		t.Errorf("expected parse error")
	}
	if len(runner.calls) != 0 {
		t.Errorf("no reload on parse error, got %v", runner.calls)
	}
}

func TestApplyInbound_ConfigOnlyMode_WritesNoReload(t *testing.T) {
	runner := &recordingRunner{}
	dir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{
		Inbound: InboundConfig{
			Hostname:       "h.example",
			ListenPort:     443,
			TLSEmail:       "e@x.io",
			MasqueradeRoot: "/var/www/html",
		},
		CaddyfilePath: dir + "/Caddyfile",
		runCmd:        runner.run,
		// CaddyBin deliberately empty → config-only mode
	}, logger)

	body := wirePayload(t, func(m map[string]any) {
		m["hostname"] = "new.example.com"
	})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if len(runner.calls) != 0 {
		t.Errorf("config-only mode should not invoke caddy reload: %v", runner.calls)
	}
}
