package xray

import (
	"encoding/json"
	"os"
	"testing"
)

// The cascade as a NODE-level block.
//
// What has to be true, in order of how much it would cost to get wrong:
//
//  1. the same fragments arriving the new way render the SAME bytes as the old
//     way, which is what the golden captured before the move is for;
//  2. for one release both ways arrive together, and the node-level one wins;
//  3. that preference lasts exactly one push, so an agent that outlives a
//     rollback of the panel goes back to reading the inbound copy instead of
//     sitting without a chain forever.

func TestTheNodeBlockRendersTheSameBytesAsTheInboundCopy(t *testing.T) {
	want, err := os.ReadFile(cascadeGoldenPath)
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}

	a, path := cascadeAdapter(t)
	// The new way: the fragments arrive on their own, and the inbound carries
	// none. This is the shape the panel sends once the old copy is dropped.
	if err := a.ApplyCascade(cascadeFragmentsFixture(t)); err != nil {
		t.Fatalf("ApplyCascade: %v", err)
	}
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, nil)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read written config: %v", err)
	}
	if string(got) != string(want) {
		t.Errorf("the node-level block renders differently than the inbound copy did"+
			"\n--- want\n%s\n--- got\n%s", want, got)
	}
}

// The transitional release sends both. The node-level one is the answer, and
// the inbound copy must not overwrite it afterwards: the two arrive in one push
// and ApplyInbound runs last.
func TestTheNodeBlockWinsOverTheCopyStillOnTheInbound(t *testing.T) {
	a, path := cascadeAdapter(t)
	fragments := cascadeFragmentsFixture(t)

	// A different chain on the inbound, so a win is visible rather than assumed.
	stale := json.RawMessage(`{
		"inbounds": [],
		"outbounds": [{"tag":"cascade-link-out-d9-0","protocol":"vless"}],
		"routingRules": [{"type":"field","network":"tcp,udp","outboundTag":"cascade-link-out-d9-0"}]
	}`)

	if err := a.ApplyCascade(fragments); err != nil {
		t.Fatalf("ApplyCascade: %v", err)
	}
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, stale)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read written config: %v", err)
	}
	if !containsTag(t, blob, "cascade-link-out-d1-0") {
		t.Error("the node-level cascade was lost")
	}
	if containsTag(t, blob, "cascade-link-out-d9-0") {
		t.Error("the copy on the inbound overwrote the node-level block")
	}
}

// The flag says "this push", not "ever". An agent that keeps running while the
// panel is rolled back to a version that only sends the inbound copy has to
// start reading it again, or it serves no cascade at all and says nothing.
func TestAfterAPushWithoutTheBlockTheInboundCopyIsReadAgain(t *testing.T) {
	a, path := cascadeAdapter(t)

	if err := a.ApplyCascade(cascadeFragmentsFixture(t)); err != nil {
		t.Fatalf("ApplyCascade: %v", err)
	}
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, nil)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	// Next push, older panel: nothing at the node level, the chain rides on the
	// inbound again.
	older := json.RawMessage(`{
		"inbounds": [],
		"outbounds": [{"tag":"cascade-link-out-d9-0","protocol":"vless"}],
		"routingRules": [{"type":"field","network":"tcp,udp","outboundTag":"cascade-link-out-d9-0"}]
	}`)
	if err := a.ApplyCascade(nil); err != nil {
		t.Fatalf("ApplyCascade(nil): %v", err)
	}
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, older)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read written config: %v", err)
	}
	if !containsTag(t, blob, "cascade-link-out-d9-0") {
		t.Error("after the block stopped coming, the inbound copy was still ignored")
	}
}

// Removing the cascade has to work in both worlds: the panel that dropped it
// sends neither the block nor the copy, and the node has to end up with no
// chain rather than the last one it saw.
func TestACascadeIsRemovedWhenNeitherArrives(t *testing.T) {
	a, path := cascadeAdapter(t)
	if err := a.ApplyCascade(cascadeFragmentsFixture(t)); err != nil {
		t.Fatalf("ApplyCascade: %v", err)
	}
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, nil)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	if err := a.ApplyCascade(nil); err != nil {
		t.Fatalf("ApplyCascade(nil): %v", err)
	}
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, nil)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read written config: %v", err)
	}
	if containsTag(t, blob, "cascade-link-out-d1-0") {
		t.Error("the cascade survived being removed")
	}
}

// A repeated push must not restart the core: a restart drops every live
// connection on the node, and on a cascade entry it tears down the whole chain.
func TestRepeatingTheSameCascadeIsNotAChange(t *testing.T) {
	a, _ := cascadeAdapter(t)
	fragments := cascadeFragmentsFixture(t)
	if err := a.ApplyCascade(fragments); err != nil {
		t.Fatalf("ApplyCascade: %v", err)
	}
	before := a.cascade

	if err := a.ApplyCascade(cascadeFragmentsFixture(t)); err != nil {
		t.Fatalf("ApplyCascade again: %v", err)
	}
	if a.cascade != before {
		t.Error("the same cascade was stored again, which means the core was restarted for nothing")
	}
}

func containsTag(t *testing.T, blob []byte, tag string) bool {
	t.Helper()
	var cfg struct {
		Outbounds []map[string]any `json:"outbounds"`
		Routing   struct {
			Rules []map[string]any `json:"rules"`
		} `json:"routing"`
	}
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, o := range cfg.Outbounds {
		if o["tag"] == tag {
			return true
		}
	}
	for _, r := range cfg.Routing.Rules {
		if r["outboundTag"] == tag {
			return true
		}
	}
	return false
}
