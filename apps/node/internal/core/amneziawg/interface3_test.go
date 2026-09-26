package amneziawg

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

// t07-6: the node's 3.1 interface, beside the 1.x one.

// The panel mints the geometry (nodes/awg3-geometry.ts) and writes these with
// a seeded draw; each has to be one this agent parses, passes and renders, or
// the two tables have drifted apart.
func TestTheGeometryThePanelMintsIsOneTheAgentRenders(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "geometry3-minted.json"))
	if err != nil {
		t.Fatal(err)
	}
	var minted []geometry3Wire
	if err := json.Unmarshal(raw, &minted); err != nil {
		t.Fatal(err)
	}
	if len(minted) == 0 {
		t.Fatal("no geometry in the fixture")
	}
	for i, w := range minted {
		g, err := w.toGeometry()
		if err != nil {
			t.Fatalf("#%d: %v", i, err)
		}
		if v := g.violations(); len(v) != 0 {
			t.Errorf("#%d breaks %v", i, v)
		}
		in := validInbound()
		in.Geometry = &g
		blob, err := renderConfig(in, nil)
		if err != nil {
			t.Fatalf("#%d render: %v", i, err)
		}
		for _, want := range []string{"MTU = 1376\n", "HeaderProtectionKey = " + w.HeaderProtectionKey + "\n", "RandomTrailers = on\n", "H1 = " + w.H1 + "\n"} {
			if !strings.Contains(blob, want) {
				t.Errorf("#%d: the 3.1 file lacks %q:\n%s", i, want, blob)
			}
		}
		// The 1.x block is not there beside it: its H would be the profile's.
		if strings.Count(blob, "H1 = ") != 1 || strings.Contains(blob, "H1 = 100\n") {
			t.Errorf("#%d: the 1.x block leaked into the 3.1 file:\n%s", i, blob)
		}
	}
}

func fixtureWire(t *testing.T) *geometry3Wire {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "geometry3-minted.json"))
	if err != nil {
		t.Fatal(err)
	}
	var minted []geometry3Wire
	if err := json.Unmarshal(raw, &minted); err != nil {
		t.Fatal(err)
	}
	return &minted[0]
}

func inboundJSON(t *testing.T, id string, gen int, g *geometry3Wire) json.RawMessage {
	t.Helper()
	m := map[string]any{
		"serverPrivateKey": testWGPrivKey,
		"subnet":           "10.66.66.0/24",
		"inboundId":        id,
		"obfuscation":      map[string]any{"jc": 4, "jmin": 40, "jmax": 70, "s1": 72, "s2": 56, "h1": 100, "h2": 200, "h3": 300, "h4": 400},
	}
	if gen == 3 {
		m["subnet"] = "10.67.67.0/24"
		m["awgProtocol"] = 3
		m["geometry3"] = g
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func twoInterfaceAdapter(t *testing.T) (*Adapter, string) {
	t.Helper()
	dir := t.TempDir()
	a := New(Config{
		Inbound:    InboundConfig{Interface: "awg0"},
		ConfigPath: filepath.Join(dir, "awg0.conf"),
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return a, dir
}

func TestEachGenerationLandsOnItsOwnInterface(t *testing.T) {
	a, dir := twoInterfaceAdapter(t)
	if err := a.ApplyInbound(51830, inboundJSON(t, "b3", 3, fixtureWire(t))); err != nil {
		t.Fatalf("3.1 inbound: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "awg0.conf")); err == nil {
		t.Error("a 3.1 inbound wrote the 1.x interface's file")
	}
	three, err := os.ReadFile(filepath.Join(dir, "awg3.conf"))
	if err != nil {
		t.Fatalf("no awg3.conf: %v", err)
	}
	if !strings.Contains(string(three), "HeaderProtectionKey = ") || !strings.Contains(string(three), "ListenPort = 51830") {
		t.Errorf("awg3.conf:\n%s", three)
	}

	if err := a.ApplyInbound(51820, inboundJSON(t, "b1", 1, nil)); err != nil {
		t.Fatalf("1.x inbound: %v", err)
	}
	one, err := os.ReadFile(filepath.Join(dir, "awg0.conf"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(one), "HeaderProtectionKey") || !strings.Contains(string(one), "H1 = 100\n") {
		t.Errorf("awg0.conf is not the 1.x render:\n%s", one)
	}
	// The 1.x inbound did not touch the 3.1 file.
	if again, _ := os.ReadFile(filepath.Join(dir, "awg3.conf")); string(again) != string(three) {
		t.Error("the 1.x inbound rewrote awg3.conf")
	}
}

func TestA31InboundThatCannotBeServedIsRefused(t *testing.T) {
	a, _ := twoInterfaceAdapter(t)
	if err := a.ApplyInbound(51830, inboundJSON(t, "b3", 3, nil)); err == nil {
		t.Error("a 3.1 inbound with no geometry was applied")
	}
	b, _ := json.Marshal(map[string]any{"serverPrivateKey": testWGPrivKey, "subnet": "10.66.66.0/24", "awgProtocol": 2})
	if err := a.ApplyInbound(51830, b); err == nil {
		t.Error("an inbound of generation 2 was applied")
	}
	broken := *fixtureWire(t)
	broken.S1 = 5
	if err := a.ApplyInbound(51830, inboundJSON(t, "b3", 3, &broken)); err == nil || !strings.Contains(err.Error(), "s-nonce-floor") {
		t.Errorf("a geometry below the nonce floor: %v", err)
	}
}

func TestAUserHasAPeerOnEachInterfaceItReaches(t *testing.T) {
	a, _ := twoInterfaceAdapter(t)
	if err := a.ApplyInbound(51820, inboundJSON(t, "b1", 1, nil)); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(51830, inboundJSON(t, "b3", 3, fixtureWire(t))); err != nil {
		t.Fatal(err)
	}
	u := core.User{UserID: "u1", AmneziaWGPublicKey: testWGPubKeyA, AmneziaWGAllowedIP: "10.66.66.2", AmneziaWGAllowedIP3: "10.67.67.2"}
	if err := a.AddUser(u); err != nil {
		t.Fatal(err)
	}
	if a.peers["u1"].AllowedIP != "10.66.66.2/32" || a.v3.peers["u1"].AllowedIP != "10.67.67.2/32" {
		t.Fatalf("peers: 1.x %v, 3.1 %v", a.peers, a.v3.peers)
	}
	// No 3.1 address any more (no 3.1 profile reaches the user): gone from awg3.
	u.AmneziaWGAllowedIP3 = ""
	if err := a.AddUser(u); err != nil {
		t.Fatal(err)
	}
	if _, on3 := a.v3.peers["u1"]; on3 {
		t.Error("the user kept a peer on the 3.1 interface")
	}
	if err := a.RemoveUser("u1"); err != nil {
		t.Fatal(err)
	}
	if len(a.peers) != 0 {
		t.Error("RemoveUser left the 1.x peer")
	}
}

func TestAUserArrivingBeforeThe31InboundIsRemembered(t *testing.T) {
	a, _ := twoInterfaceAdapter(t)
	u := core.User{UserID: "u1", AmneziaWGPublicKey: testWGPubKeyA, AmneziaWGAllowedIP3: "10.67.67.2"}
	if err := a.AddUser(u); err != nil {
		t.Fatalf("a 3.1 peer before its interface: %v", err)
	}
	if err := a.ApplyInbound(51830, inboundJSON(t, "b3", 3, fixtureWire(t))); err != nil {
		t.Fatal(err)
	}
	blob, _ := os.ReadFile(a.v3.cfg.ConfigPath)
	if !strings.Contains(string(blob), "AllowedIPs = 10.67.67.2/32") {
		t.Errorf("the remembered peer is not in the first 3.1 file:\n%s", blob)
	}
}

func TestAPushThatDropsOneGenerationTakesOnlyThatInterfaceDown(t *testing.T) {
	a, _ := twoInterfaceAdapter(t)
	if err := a.ApplyInbound(51820, inboundJSON(t, "b1", 1, nil)); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(51830, inboundJSON(t, "b3", 3, fixtureWire(t))); err != nil {
		t.Fatal(err)
	}
	if err := a.RetainInbounds([]string{"b3"}); err != nil {
		t.Fatal(err)
	}
	if a.cfg.Inbound.PrivateKey != "" {
		t.Error("the 1.x interface is still configured after its binding left the push")
	}
	if a.v3.cfg.Inbound.PrivateKey == "" {
		t.Error("the 3.1 interface went down with it")
	}
	// A node that serves 3.1 alone is configured and judged by that interface.
	if !a.Provisioned() || !a.Healthy() {
		t.Errorf("3.1 alone: provisioned %v, healthy %v", a.Provisioned(), a.Healthy())
	}
}

func TestAUserOnBothInterfacesIsBilledOnce(t *testing.T) {
	got := mergeStats(
		&core.Stats{Users: []core.UserStats{{UserID: "u1", BytesIn: 10, BytesOut: 1}, {UserID: "u2", BytesIn: 5}}, TotalBytesIn: 15, TotalBytesOut: 1},
		&core.Stats{Users: []core.UserStats{{UserID: "u1", BytesIn: 7, BytesOut: 2}, {UserID: "u3", BytesOut: 4}}, TotalBytesIn: 7, TotalBytesOut: 6},
	)
	by := map[string]core.UserStats{}
	for _, u := range got.Users {
		if _, dup := by[u.UserID]; dup {
			t.Fatalf("%s twice", u.UserID)
		}
		by[u.UserID] = u
	}
	if by["u1"].BytesIn != 17 || by["u1"].BytesOut != 3 || by["u2"].BytesIn != 5 || by["u3"].BytesOut != 4 {
		t.Errorf("merged: %+v", got.Users)
	}
	if got.TotalBytesIn != 22 || got.TotalBytesOut != 7 {
		t.Errorf("totals %d/%d", got.TotalBytesIn, got.TotalBytesOut)
	}
}
