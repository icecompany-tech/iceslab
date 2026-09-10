package xray

import (
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

// Vision (xtls-rprx-vision) reaches the users, and only where it is legal.
//
// The field symptom was silent: the operator turned Vision on, the panel pushed
// an inbound carrying flow=xtls-rprx-vision, the node applied it and reported
// success, and every user was still served without Vision. Nothing logged an
// error, the connection worked, it was just slower and more visible to DPI.
//
// Two separate mistakes produced that, and both are pinned below.
//
//  1. `flow` was copied into the user record from a.cfg.Inbound, the inbound the
//     AGENT BOOTED WITH. ApplyInbound stores an identified inbound in a.inbounds
//     and leaves cfg.Inbound untouched, so on a panel-provisioned node that field
//     is the empty string forever.
//  2. Even reading it from the right inbound would not be enough: a user is added
//     to EVERY inbound the node serves, and Vision is only legal on raw. One value
//     per user cannot describe a node that carries raw and xhttp side by side.

func flowAdapter(t *testing.T) *Adapter {
	t.Helper()
	return New(Config{
		// Config-only mode: no binary, so AddUser renders instead of restarting.
		ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		// A node provisioned by the panel installs empty and receives everything
		// over ApplyInbound. This is what makes the old code serve flow="".
		Inbound: InboundConfig{},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func flowWire(id, network, flow string) []byte {
	wire := map[string]any{
		"inboundId":          id,
		"realityDest":        "www.cloudflare.com:443",
		"realityServerNames": []string{"www.cloudflare.com"},
		"realityPrivateKey":  "aGVsbG8td29ybGQtdGhpcy1pcy1hLWZha2Uta2V5MDA",
		"realityShortIds":    []string{"0123456789abcdef"},
		"network":            network,
		"flow":               flow,
	}
	blob, err := json.Marshal(wire)
	if err != nil {
		panic(err)
	}
	return blob
}

// clientsByTag reads the rendered config the way xray would: per inbound.
func clientsByTag(t *testing.T, a *Adapter) map[string][]map[string]any {
	t.Helper()
	out := map[string][]map[string]any{}
	for _, in := range renderedInbounds(t, a) {
		settings, ok := in["settings"].(map[string]any)
		if !ok {
			continue
		}
		raw, ok := settings["clients"].([]any)
		if !ok {
			continue
		}
		clients := make([]map[string]any, 0, len(raw))
		for _, c := range raw {
			clients = append(clients, c.(map[string]any))
		}
		out[in["tag"].(string)] = clients
	}
	return out
}

// The regression itself: a user added AFTER the inbound was applied must be
// served with that inbound's flow, not with whatever the agent booted with.
func TestUserGetsTheAppliedInboundsFlow(t *testing.T) {
	a := flowAdapter(t)
	if err := a.ApplyInbound(443, flowWire("aaaaaaaa-1111-4000-8000-000000000001", "raw", "xtls-rprx-vision")); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if err := a.AddUser(core.User{UserID: "alice", XrayUUID: "uuid-a"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	for tag, clients := range clientsByTag(t, a) {
		if len(clients) != 1 {
			t.Fatalf("inbound %s: %d clients, want 1", tag, len(clients))
		}
		if got := clients[0]["flow"]; got != "xtls-rprx-vision" {
			t.Errorf("inbound %s: client flow = %v, want xtls-rprx-vision", tag, got)
		}
	}
}

// The order the panel actually uses on an existing node: users are already there
// when Vision is switched on. Re-rendering has to pick the new flow up.
func TestFlowAppliesToUsersAddedBeforeIt(t *testing.T) {
	a := flowAdapter(t)
	if err := a.ApplyInbound(443, flowWire("aaaaaaaa-1111-4000-8000-000000000001", "raw", "")); err != nil {
		t.Fatalf("first ApplyInbound: %v", err)
	}
	if err := a.AddUser(core.User{UserID: "alice", XrayUUID: "uuid-a"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if err := a.ApplyInbound(443, flowWire("aaaaaaaa-1111-4000-8000-000000000001", "raw", "xtls-rprx-vision")); err != nil {
		t.Fatalf("second ApplyInbound: %v", err)
	}

	for tag, clients := range clientsByTag(t, a) {
		if got := clients[0]["flow"]; got != "xtls-rprx-vision" {
			t.Errorf("inbound %s: client flow = %v, want xtls-rprx-vision", tag, got)
		}
	}
}

// A node serving raw AND xhttp: one user, two different answers. Vision on the
// xhttp inbound is not a cosmetic flaw, xray refuses the client outright
// ("client flow is empty" on the server side), so this is the half that would
// break a working transport rather than just weaken it.
func TestFlowIsPerInboundNotPerUser(t *testing.T) {
	a := flowAdapter(t)
	if err := a.ApplyInbound(443, flowWire("aaaaaaaa-1111-4000-8000-000000000001", "raw", "xtls-rprx-vision")); err != nil {
		t.Fatalf("raw ApplyInbound: %v", err)
	}
	if err := a.ApplyInbound(8443, flowWire("bbbbbbbb-2222-4000-8000-000000000002", "xhttp", "")); err != nil {
		t.Fatalf("xhttp ApplyInbound: %v", err)
	}
	if err := a.AddUser(core.User{UserID: "alice", XrayUUID: "uuid-a"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	byTag := clientsByTag(t, a)
	if len(byTag) != 2 {
		t.Fatalf("rendered %d user inbounds, want 2", len(byTag))
	}
	seen := map[string]bool{}
	for _, clients := range byTag {
		flow, present := clients[0]["flow"]
		if !present {
			flow = ""
		}
		seen[flow.(string)] = true
	}
	if !seen["xtls-rprx-vision"] || !seen[""] {
		t.Errorf("one inbound must carry Vision and the other must not, got %v", seen)
	}
}

// The mirror of the original bug, and the reason the boot inbound must not be
// consulted at all: a node INSTALLED with Vision must not stamp it onto an
// xhttp inbound the panel pushes later.
func TestBootConfigFlowDoesNotLeakIntoAppliedInbounds(t *testing.T) {
	a := New(Config{
		ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		Inbound:    InboundConfig{Flow: "xtls-rprx-vision"},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := a.ApplyInbound(8443, flowWire("bbbbbbbb-2222-4000-8000-000000000002", "xhttp", "")); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if err := a.AddUser(core.User{UserID: "alice", XrayUUID: "uuid-a"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	for tag, clients := range clientsByTag(t, a) {
		if got, present := clients[0]["flow"]; present {
			t.Errorf("inbound %s: client carries flow %v, but the pushed inbound has none", tag, got)
		}
	}
}

// `xray api adu` is the path a live add takes, and it builds its own settings
// block. It must read the flow from the inbound too, or a user added without a
// restart is served differently from one added with it.
func TestLiveAddPayloadCarriesTheInboundFlow(t *testing.T) {
	data, err := buildAduPayload(
		[]InboundConfig{
			{Tag: "raw-in", Subprotocol: "vless", Flow: "xtls-rprx-vision"},
			{Tag: "xhttp-in", Subprotocol: "vless", ListenPort: 8443},
		},
		xrayClient{ID: "uuid-a", Email: "alice"},
	)
	if err != nil {
		t.Fatalf("buildAduPayload: %v", err)
	}
	var doc struct {
		Inbounds []struct {
			Tag      string `json:"tag"`
			Settings struct {
				Clients []map[string]any `json:"clients"`
			} `json:"settings"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, data)
	}
	if len(doc.Inbounds) != 2 {
		t.Fatalf("inbounds: got %d want 2", len(doc.Inbounds))
	}
	for _, ib := range doc.Inbounds {
		flow, present := ib.Settings.Clients[0]["flow"]
		switch ib.Tag {
		case "raw-in":
			if flow != "xtls-rprx-vision" {
				t.Errorf("raw-in: flow = %v, want xtls-rprx-vision", flow)
			}
		case "xhttp-in":
			if present {
				t.Errorf("xhttp-in: flow = %v, want none", flow)
			}
		default:
			t.Errorf("unexpected tag %q", ib.Tag)
		}
	}
}
