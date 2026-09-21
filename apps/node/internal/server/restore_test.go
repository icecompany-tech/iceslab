package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
)

/*
A restarted agent brings its cores back from disk, without the panel.

THE INCIDENT, 2026-09-22. Four agents were restarted. The old process stopped
xray cleanly; the new one logged "no REALITY key yet, waiting for ApplyInbound
from panel" and sat there, because an adapter's idea of what it serves lives in
memory. Two of them were cascade entries whose push the panel could not build at
all (a direction pointed at a deleted node), so nothing ever came and they
served nobody for over an hour, with a config that had been valid a second
earlier sitting unread on disk.
*/

// recordingCore remembers what it was told to apply, which is the only question
// these tests ask.
type recordingCore struct {
	fakeCore
	appliedPorts []int
	policy       []byte
	dns          []byte
	retained     [][]string
}

func (r *recordingCore) ApplyInbound(port int, _ json.RawMessage) error {
	r.appliedPorts = append(r.appliedPorts, port)
	return nil
}
func (r *recordingCore) ApplyPolicy(p json.RawMessage) error {
	r.policy = append([]byte(nil), p...)
	return nil
}
func (r *recordingCore) ApplyDns(d json.RawMessage) error {
	r.dns = append([]byte(nil), d...)
	return nil
}
func (r *recordingCore) RetainInbounds(ids []string) error {
	r.retained = append(r.retained, ids)
	return nil
}

func serverWithStore(t *testing.T, path string, adapters ...core.CoreAdapter) *Server {
	t.Helper()
	s, err := New(Config{
		Logger:            slog.New(slog.NewTextHandler(io.Discard, nil)),
		Payload:           &payload.Payload{},
		Adapters:          adapters,
		InboundsStorePath: path,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s
}

// port:0 keeps ensureInboundFirewall from shelling out to ufw during the test.
const storedPush = `{
  "inbounds": [{"id":"i1","name":"reality","protocol":"xray","port":0,"config":{}}],
  "policy": {"rules":[{"kind":"block"}]},
  "dns": {"servers":[{"address":"1.1.1.1"}]}
}`

func TestRestoreBringsTheCoresBackWithoutThePanel(t *testing.T) {
	dir := t.TempDir()
	store := filepath.Join(dir, "inbounds.json")
	if err := os.WriteFile(store, []byte(storedPush), 0o600); err != nil {
		t.Fatal(err)
	}
	xray := &recordingCore{fakeCore: fakeCore{name: "xray", engine: "xray", running: true}}
	s := serverWithStore(t, store, xray)

	s.restoreFromStore(context.Background())

	if len(xray.appliedPorts) != 1 {
		t.Fatalf("inbounds applied = %v, want the one on disk", xray.appliedPorts)
	}
	// The node-level blocks too, and this is the half that would have been
	// silently lost by restoring inbounds alone: the node would have come back
	// serving traffic under routing the operator never chose.
	if len(xray.policy) == 0 {
		t.Error("the node-level policy was not restored")
	}
	if len(xray.dns) == 0 {
		t.Error("the node-level resolver was not restored")
	}
	// And the reconcile pass ran, so a core holding a stale inbound drops it.
	if len(xray.retained) != 1 {
		t.Errorf("RetainInbounds calls = %d, want 1: the restore must take the same path as a push", len(xray.retained))
	}
}

// A file written by an agent older than the whole-push store is a bare array.
// Refusing it would mean a node that restarts mid-rollout restores nothing,
// which is the situation being fixed.
func TestRestoreReadsTheLegacyInboundArray(t *testing.T) {
	dir := t.TempDir()
	store := filepath.Join(dir, "inbounds.json")
	legacy := `[{"id":"i1","name":"reality","protocol":"xray","port":0,"config":{}}]`
	if err := os.WriteFile(store, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	xray := &recordingCore{fakeCore: fakeCore{name: "xray", engine: "xray", running: true}}
	s := serverWithStore(t, store, xray)

	s.restoreFromStore(context.Background())

	if len(xray.appliedPorts) != 1 {
		t.Fatalf("a legacy store must still restore its inbounds, applied = %v", xray.appliedPorts)
	}
}

func TestRestoreIsQuietOnAFreshNode(t *testing.T) {
	// No file at all: a node that has never been pushed to has nothing to
	// restore, and that is not a fault worth a line in the log.
	xray := &recordingCore{fakeCore: fakeCore{name: "xray", engine: "xray", running: true}}
	s := serverWithStore(t, filepath.Join(t.TempDir(), "absent.json"), xray)

	s.restoreFromStore(context.Background())

	if len(xray.appliedPorts) != 0 {
		t.Errorf("nothing should have been applied, got %v", xray.appliedPorts)
	}
}

// The store is what the restore reads, so what a push writes has to be the
// whole push and not only its inbounds.
func TestAPushPersistsItsNodeLevelBlocksToo(t *testing.T) {
	dir := t.TempDir()
	store := filepath.Join(dir, "inbounds.json")
	var req dto.ApplyInboundsRequest
	if err := json.Unmarshal([]byte(storedPush), &req); err != nil {
		t.Fatal(err)
	}
	if err := writePushStore(store, req); err != nil {
		t.Fatalf("writePushStore: %v", err)
	}

	back, err := readPushStore(store)
	if err != nil {
		t.Fatalf("readPushStore: %v", err)
	}
	if len(back.Inbounds) != 1 {
		t.Errorf("inbounds did not survive the round trip: %+v", back.Inbounds)
	}
	if len(back.Policy) == 0 || len(back.Dns) == 0 {
		t.Errorf("the node-level blocks did not survive the round trip: policy=%s dns=%s",
			back.Policy, back.Dns)
	}
}
