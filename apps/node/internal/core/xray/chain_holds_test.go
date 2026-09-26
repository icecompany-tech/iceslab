package xray

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

// E47, 26.09 on ru-02 and nl-01: sing-box was installed after E46, the chain
// started, and the transits' xray died "bind: address already in use" on
// 24000/24001 five times and stayed down with the node's own hosts. The first
// push without a running chain had left the leg's link-in in xray's config,
// drawn from the copy of the cascade riding on the inbound, and the chain now
// held that port. With the chain holding the cascade, xray draws no leg at all.

// transitLinkIn: what the panel hangs on a transit's inbound for old agents,
// the leg's link-in on the port the chain now listens on.
func transitLinkIn() json.RawMessage {
	return json.RawMessage(`{
		"inbounds": [{"tag":"cascade-link-in","listen":"0.0.0.0","port":24000,"protocol":"vless","settings":{"clients":[],"decryption":"none"}}],
		"outbounds": [],
		"routingRules": []
	}`)
}

func hasLinkIn(t *testing.T, path string) bool {
	t.Helper()
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return strings.Contains(string(blob), `"cascade-link-in"`)
}

func modTime(t *testing.T, path string) time.Time {
	t.Helper()
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return st.ModTime()
}

func TestWhileTheChainHoldsTheCascadeXrayDrawsNoLeg(t *testing.T) {
	a, path := cascadeAdapter(t)

	// The E46 push: no chain in force, the copy on the inbound is read and the
	// link-in lands in xray.
	a.SetChainHolds(false)
	if err := a.ApplyCascade(nil); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, transitLinkIn())); err != nil {
		t.Fatal(err)
	}
	if !hasLinkIn(t, path) {
		t.Fatal("fixture: the link-in did not reach xray without a chain")
	}

	// sing-box installed, the chain holds the cascade: the same push again.
	before := modTime(t, path)
	time.Sleep(20 * time.Millisecond)
	a.SetChainHolds(true)
	if err := a.ApplyCascade(nil); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, transitLinkIn())); err != nil {
		t.Fatal(err)
	}
	if hasLinkIn(t, path) {
		t.Fatal("xray still draws the leg's link-in while the chain holds the cascade: two processes on one port")
	}
	once := modTime(t, path)
	if !once.After(before) {
		t.Fatal("the config was not rewritten")
	}

	// And the next identical push is no change: one restart, not one per push.
	time.Sleep(20 * time.Millisecond)
	a.SetChainHolds(true)
	if err := a.ApplyCascade(nil); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, transitLinkIn())); err != nil {
		t.Fatal(err)
	}
	if !modTime(t, path).Equal(once) {
		t.Error("a repeated push with the chain holding rewrote xray again")
	}
}

func TestTheEntryStillTakesTheChainsHandoverDrawing(t *testing.T) {
	// The entry's xray is handed the chain's drawing (userCore fragments): that
	// is a cascade from the node level, and holding the chain must not drop it.
	a, path := cascadeAdapter(t)
	a.SetChainHolds(true)
	if err := a.ApplyCascade(cascadeFragmentsFixture(t)); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, transitLinkIn())); err != nil {
		t.Fatal(err)
	}
	blob, _ := os.ReadFile(path)
	if !containsTag(t, blob, "cascade-link-out-d1-0") {
		t.Error("the entry lost the drawing it was handed")
	}
	if hasLinkIn(t, path) {
		t.Error("the copy on the inbound was read beside the handed drawing")
	}
}

func TestWithoutAChainTheCopyOnTheInboundIsStillRead(t *testing.T) {
	// An agent pushed by a panel that sends no chain (or a rolled-back one):
	// the transitional behaviour stays as it was.
	a, path := cascadeAdapter(t)
	a.SetChainHolds(false)
	if err := a.ApplyCascade(nil); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(443, cascadeEntryInboundWire(t, transitLinkIn())); err != nil {
		t.Fatal(err)
	}
	if !hasLinkIn(t, path) {
		t.Error("without a chain the inbound copy was ignored")
	}
}
