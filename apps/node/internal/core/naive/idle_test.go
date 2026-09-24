package naive

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
)

// Idle (core.Idler): see the shadowsocks test of the same name. Caddy in
// config-only mode: the Caddyfile is the whole of what runs.
func TestIdleStopsAndTheSameInboundBringsItBack(t *testing.T) {
	a := New(Config{CaddyfilePath: filepath.Join(t.TempDir(), "Caddyfile")}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	cfg := json.RawMessage(`{"hostname":"naive.example.com","tlsEmail":"ops@example.com"}`)

	if err := a.ApplyInbound(443, cfg); err != nil {
		t.Fatal(err)
	}
	if !a.Provisioned() || !a.Healthy() {
		t.Fatal("not up after the first push")
	}
	if err := a.Idle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if a.Provisioned() || a.Healthy() {
		t.Fatal("still provisioned or healthy after Idle")
	}
	if err := a.ApplyInbound(443, cfg); err != nil {
		t.Fatal(err)
	}
	if !a.Provisioned() || !a.Healthy() {
		t.Fatal("the same inbound pushed again did not bring it back")
	}
}
