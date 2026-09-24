package shadowsocks

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
)

// Idle (core.Idler): a push without a shadowsocks inbound stops the core, and
// the SAME inbound pushed again brings it back. The second half is the one a
// careless Idle breaks: ApplyInbound skips a config it already holds, so an
// Idle that stopped the process but kept the cipher would leave it stopped.
func TestIdleStopsAndTheSameInboundBringsItBack(t *testing.T) {
	a := New(Config{ConfigPath: filepath.Join(t.TempDir(), "ss.json")}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	cfg := json.RawMessage(`{"method":"2022-blake3-aes-128-gcm","serverPsk":"AAAAAAAAAAAAAAAAAAAAAA=="}`)

	if err := a.ApplyInbound(8388, cfg); err != nil {
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
	// Idempotent: a second push that names no shadowsocks is a no-op.
	if err := a.Idle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(8388, cfg); err != nil {
		t.Fatal(err)
	}
	if !a.Provisioned() || !a.Healthy() {
		t.Fatal("the same inbound pushed again did not bring it back")
	}
}
