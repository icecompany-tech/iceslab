package xray

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

// The byte-identical proof for a CASCADE node.
//
// `render-empty-policy.json` covers the plain node, and it was captured before
// the policy and the resolver existed, which is exactly what makes it worth
// something. It says nothing about a cascade: it was taken without one.
//
// This golden was captured from the code as it stood BEFORE c1f5cb3, the commit
// that moved the block to the node level, with the cascade still riding inside
// the inbound (`XrayInboundCfg.cascade`). It is the "before" picture. Taken
// first and on purpose: a golden captured after the move would only prove the
// move agrees with itself, which is the same trap the field checklist warns
// about when it says to record the original state before updating the agent.
//
// The commit ORDER does not show that, because this file landed after the move
// (38da707 after c1f5cb3), so here is how to check the claim rather than take
// it. Verified this way on 2026-09-11, byte for byte:
//
//	git worktree add /tmp/check c1f5cb3~1
//	cd /tmp/check
//	git checkout 38da707 -- apps/node/internal/core/xray/cascade_golden_test.go \
//	                        apps/node/internal/core/xray/testdata/
//	cd apps/node && UPDATE_GOLDEN=1 go test -run TestCascadeEntryRenderMatchesGolden ./internal/core/xray/
//	git diff --stat -- apps/node/internal/core/xray/testdata/render-cascade-entry.json   # empty
//
// The fragments in testdata are not invented. They are what
// buildTopologyFragmentsForNode prints for an entry with two directions, a pool
// of two on the first, one A4 policy and the Auto profile on: the QUIC block,
// the per-direction rules gated on vlessRoute, the Auto rule, two balancers and
// the observatory they need.
const cascadeGoldenPath = "testdata/render-cascade-entry.json"
const cascadeFragmentsPath = "testdata/cascade-entry-fragments.json"

func cascadeFragmentsFixture(t *testing.T) json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile(cascadeFragmentsPath)
	if err != nil {
		t.Fatalf("read cascade fixture: %v", err)
	}
	return json.RawMessage(raw)
}

// cascadeEntryInboundWire is the inbound the panel pushes to a cascade entry
// today: an ordinary REALITY inbound with the fragments hanging off it.
func cascadeEntryInboundWire(t *testing.T, fragments json.RawMessage) []byte {
	t.Helper()
	wire := map[string]any{
		"inboundId":          "cascade-entry",
		"realityDest":        "www.microsoft.com:443",
		"realityServerNames": []string{"www.microsoft.com"},
		"realityPrivateKey":  "aGVsbG8td29ybGQtdGhpcy1pcy1hLWZha2Uta2V5MDA",
		"realityShortIds":    []string{"0123456789abcdef"},
		"flow":               "xtls-rprx-vision",
		"network":            "raw",
	}
	if fragments != nil {
		wire["cascade"] = fragments
	}
	body, err := json.Marshal(wire)
	if err != nil {
		t.Fatalf("marshal inbound wire: %v", err)
	}
	return body
}

// cascadeAdapter builds an adapter in config-only mode and returns it with the
// path it writes to. Going through the adapter rather than calling the renderer
// directly is the point: what has to stay identical across the move is what
// lands ON DISK after a push, not what one function returns.
func cascadeAdapter(t *testing.T) (*Adapter, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	a := New(Config{
		ConfigPath: path,
		Inbound:    validInbound(),
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	user := policyUsers()[0]
	if err := a.AddUser(core.User{UserID: user.Email, XrayUUID: user.ID}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	return a, path
}

func TestCascadeEntryRenderMatchesGolden(t *testing.T) {
	a, path := cascadeAdapter(t)
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, cascadeFragmentsFixture(t))); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read written config: %v", err)
	}

	// Regenerating is behind an environment variable on purpose. A golden that
	// rewrites itself when the output changes is not a test, it is a record of
	// whatever happened last.
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile(cascadeGoldenPath, blob, 0o644); err != nil {
			t.Fatalf("write golden: %v", err)
		}
		t.Skip("golden regenerated")
	}

	want, err := os.ReadFile(cascadeGoldenPath)
	if err != nil {
		t.Fatalf("read golden (regenerate with UPDATE_GOLDEN=1): %v", err)
	}
	if string(blob) != string(want) {
		t.Errorf("a cascade entry renders differently than it did\n--- want\n%s\n--- got\n%s", want, blob)
	}
}

// The fragments the panel authored come through untouched, in the panel's own
// order. Pinned separately from the golden so a failure says WHICH property
// broke: the golden alone would only say the bytes differ.
func TestCascadeFragmentsArriveInThePanelsOrder(t *testing.T) {
	a, path := cascadeAdapter(t)
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, cascadeFragmentsFixture(t))); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read written config: %v", err)
	}
	var cfg struct {
		Routing struct {
			Rules     []map[string]any `json:"rules"`
			Balancers []map[string]any `json:"balancers"`
		} `json:"routing"`
		Observatory map[string]any   `json:"observatory"`
		Outbounds   []map[string]any `json:"outbounds"`
	}
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// Protection first, then the QUIC block (it names a port, so it is narrow),
	// then the doors: direction, direction, Auto. The node policy would go
	// between the QUIC block and the first door.
	tail := []string{}
	for _, r := range cfg.Routing.Rules {
		if v, ok := r["vlessRoute"].(string); ok {
			tail = append(tail, v)
		}
	}
	want := []string{"1,257", "2,258", "65535,65534"}
	if len(tail) != len(want) {
		t.Fatalf("vlessRoute rules: got %v, want %v", tail, want)
	}
	for i := range want {
		if tail[i] != want[i] {
			t.Errorf("rule %d: got %q, want %q", i, tail[i], want[i])
		}
	}
	if len(cfg.Routing.Balancers) != 2 {
		t.Errorf("both balancers have to reach the config, got %d", len(cfg.Routing.Balancers))
	}
	// A balancer without its observatory makes xray refuse the WHOLE config, so
	// the node goes dark rather than losing the cascade (field, 2026-08-15).
	if cfg.Observatory == nil {
		t.Error("the observatory the balancers depend on is missing")
	}
	if len(cfg.Outbounds) != 3+3 {
		t.Errorf("outbounds: got %d, want the node's three plus three link-outs", len(cfg.Outbounds))
	}
}
