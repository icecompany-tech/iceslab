package xray

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

// Multi-inbound: the panel pushes inbounds one call at a time, and the adapter
// has to ACCUMULATE them. Before this it kept a single one, so the second push
// silently replaced the first and its users simply stopped being served.

func multiAdapter(t *testing.T) *Adapter {
	t.Helper()
	dir := t.TempDir()
	return New(Config{
		ConfigPath: filepath.Join(dir, "config.json"), // config-only mode: no binary
		Inbound:    validInbound(),
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func inboundWire(t *testing.T, id string, port int) []byte {
	t.Helper()
	return []byte(`{
		"inboundId": "` + id + `",
		"realityDest": "www.cloudflare.com:443",
		"realityServerNames": ["www.cloudflare.com"],
		"realityPrivateKey": "aGVsbG8td29ybGQtdGhpcy1pcy1hLWZha2Uta2V5MDA",
		"realityShortIds": ["0123456789abcdef"]
	}`)
}

func renderedInbounds(t *testing.T, a *Adapter) []map[string]any {
	t.Helper()
	blob, err := renderMultiConfig(currentInbounds(a), sortedClients(a.users), a.cascade, 8080, a.policy, a.dns)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	var cfg struct {
		Inbounds []map[string]any `json:"inbounds"`
	}
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatalf("unmarshal rendered config: %v", err)
	}
	return cfg.Inbounds
}

// currentInbounds mirrors what regenerateAndRestart feeds the renderer.
func currentInbounds(a *Adapter) []InboundConfig {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.inbounds) == 0 {
		return []InboundConfig{a.cfg.Inbound}
	}
	out := make([]InboundConfig, 0, len(a.inbounds))
	for _, id := range sortedKeys(a.inbounds) {
		out = append(out, a.inbounds[id])
	}
	return out
}

func sortedKeys(m map[string]InboundConfig) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	// insertion sort: the map is tiny and this avoids importing sort here
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}

// The whole point: a second inbound must not evict the first.
func TestSecondInboundIsHeldAlongsideTheFirst(t *testing.T) {
	a := multiAdapter(t)
	if err := a.ApplyInbound(443, inboundWire(t, "aaaaaaaa-1111-4000-8000-000000000001", 443)); err != nil {
		t.Fatalf("first ApplyInbound: %v", err)
	}
	if err := a.ApplyInbound(8443, inboundWire(t, "bbbbbbbb-2222-4000-8000-000000000002", 8443)); err != nil {
		t.Fatalf("second ApplyInbound: %v", err)
	}

	a.mu.Lock()
	held := len(a.inbounds)
	a.mu.Unlock()
	if held != 2 {
		t.Fatalf("adapter holds %d inbounds, want 2 (the second replaced the first)", held)
	}

	ins := renderedInbounds(t, a)
	// Two user inbounds plus the management one.
	if len(ins) != 3 {
		t.Fatalf("rendered %d inbounds, want 3 (two user + api)", len(ins))
	}
}

// Tags must be unique, because xray rejects the WHOLE config on a clash - the
// node would lose every inbound, not just the duplicate.
func TestEachInboundGetsItsOwnTag(t *testing.T) {
	a := multiAdapter(t)
	_ = a.ApplyInbound(443, inboundWire(t, "aaaaaaaa-1111-4000-8000-000000000001", 443))
	_ = a.ApplyInbound(8443, inboundWire(t, "bbbbbbbb-2222-4000-8000-000000000002", 8443))

	seen := map[string]bool{}
	for _, in := range renderedInbounds(t, a) {
		tag, _ := in["tag"].(string)
		if seen[tag] {
			t.Fatalf("duplicate inbound tag %q: xray would refuse the entire config", tag)
		}
		seen[tag] = true
	}
}

// A tag is derived from the inbound id and must not drift between pushes:
// traffic counters carry it, so a changed tag reads as a new inbound and zeroes
// this node's accounting for those users.
func TestInboundTagIsStableAcrossPushes(t *testing.T) {
	id := "aaaaaaaa-1111-4000-8000-000000000001"
	first := inboundTagFor(id, "vless-in")
	second := inboundTagFor(id, "vless-in")
	if first != second {
		t.Fatalf("tag drifted between calls: %q vs %q", first, second)
	}
	if other := inboundTagFor("bbbbbbbb-2222-4000-8000-000000000002", "vless-in"); other == first {
		t.Fatalf("two different inbounds derived the same tag %q", first)
	}
}

// Two inbounds on one port is a configuration error worth naming: xray would
// otherwise reject the whole file with a parser message that points nowhere.
func TestPortClashIsRefusedByName(t *testing.T) {
	a := multiAdapter(t)
	_ = a.ApplyInbound(443, inboundWire(t, "aaaaaaaa-1111-4000-8000-000000000001", 443))
	_ = a.ApplyInbound(443, inboundWire(t, "bbbbbbbb-2222-4000-8000-000000000002", 443))

	_, err := renderMultiConfig(currentInbounds(a), nil, nil, 8080, nil, nil)
	if err == nil {
		t.Fatal("expected a port clash to be refused")
	}
}

// Deleting an inbound in the panel must actually stop it on the node. The push
// is per-inbound, so without reconciliation the adapter never hears about a
// removal and keeps the listener up - found in the field 2026-08-08, where a
// binding deleted from the panel was still serving on port 8443.
func TestRemovedInboundStopsBeingServed(t *testing.T) {
	a := multiAdapter(t)
	keep := "aaaaaaaa-1111-4000-8000-000000000001"
	drop := "bbbbbbbb-2222-4000-8000-000000000002"
	_ = a.ApplyInbound(443, inboundWire(t, keep, 443))
	_ = a.ApplyInbound(8443, inboundWire(t, drop, 8443))

	// The panel now sends only the surviving one.
	if err := a.RetainInbounds([]string{keep}); err != nil {
		t.Fatalf("RetainInbounds: %v", err)
	}

	a.mu.Lock()
	_, keptStill := a.inbounds[keep]
	_, droppedStill := a.inbounds[drop]
	a.mu.Unlock()
	if !keptStill {
		t.Error("the inbound the panel still sends was dropped")
	}
	if droppedStill {
		t.Fatal("the deleted inbound is still held; it would keep listening on the node")
	}

	for _, in := range renderedInbounds(t, a) {
		if tag, _ := in["tag"].(string); tag == inboundTagFor(drop, "vless-in") {
			t.Fatal("the deleted inbound is still rendered into the config")
		}
	}
}

// Removing the LAST inbound is a real state, not a no-op to skip: an empty keep
// set has to be honoured, or the final inbound could never be turned off.
func TestRetainWithEmptySetDropsEverything(t *testing.T) {
	a := multiAdapter(t)
	_ = a.ApplyInbound(443, inboundWire(t, "aaaaaaaa-1111-4000-8000-000000000001", 443))
	if err := a.RetainInbounds(nil); err != nil {
		t.Fatalf("RetainInbounds: %v", err)
	}
	a.mu.Lock()
	held := len(a.inbounds)
	a.mu.Unlock()
	if held != 0 {
		t.Fatalf("adapter still holds %d inbounds after the panel sent none", held)
	}
}

// Serving nobody has to be renderable. On a node installed empty - the normal
// case, where everything arrives from the panel - the install-time inbound has
// no REALITY key, so with the last inbound removed there is nothing to fall back
// to. Refusing to render that left the PREVIOUS config on disk and the core kept
// serving the inbound the operator had just deleted (field, 2026-08-10: panel
// said "no inbounds", the node still listened on 443).
func TestLastInboundRemovedLeavesNothingServed(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	// Install-time inbound with no credentials: exactly what a panel-provisioned
	// node has.
	a := New(Config{
		ConfigPath: cfgPath,
		Inbound:    InboundConfig{ApiPort: 9090},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	id := "aaaaaaaa-1111-4000-8000-000000000001"
	if err := a.ApplyInbound(443, inboundWire(t, id, 443)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if err := a.RetainInbounds(nil); err != nil {
		t.Fatalf("RetainInbounds with an empty set: %v", err)
	}

	blob, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	var cfg struct {
		Inbounds []struct {
			Tag  string `json:"tag"`
			Port int    `json:"port"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatalf("unmarshal config: %v\n%s", err, blob)
	}
	for _, in := range cfg.Inbounds {
		if in.Tag != "api-in" {
			t.Errorf("still serving %q on %d after the panel removed every inbound",
				in.Tag, in.Port)
		}
	}
	if len(cfg.Inbounds) != 1 {
		t.Fatalf("expected only the management inbound, got %d", len(cfg.Inbounds))
	}
	// The management port is install-time identity and must survive having no
	// inbound to read it from; guessing the default would break stats on a node
	// whose operator moved it.
	if cfg.Inbounds[0].Port != 9090 {
		t.Errorf("management port: got %d want 9090", cfg.Inbounds[0].Port)
	}
}

// Reconciliation must not restart the core when nothing changed: a push that
// changes one inbound would otherwise bounce every other one along with it.
func TestRetainIsQuietWhenNothingChanged(t *testing.T) {
	a := multiAdapter(t)
	id := "aaaaaaaa-1111-4000-8000-000000000001"
	_ = a.ApplyInbound(443, inboundWire(t, id, 443))
	before := a.RestartStats()
	if err := a.RetainInbounds([]string{id}); err != nil {
		t.Fatalf("RetainInbounds: %v", err)
	}
	after := a.RestartStats()
	if before.Crash != after.Crash || before.Memory != after.Memory {
		t.Error("a no-op reconciliation disturbed the running core")
	}
}

// Adding a user must reach EVERY inbound the node serves, and must do it live.
//
// The live path used to build its `xray api adu` payload from the install-time
// inbound alone. Once the panel pushes identified inbounds, the running config
// carries tags derived from their ids, so that payload named a tag that no
// longer existed: adu added nobody, AddUser fell back to a full core restart,
// and every single user added tore down every live connection on the node.
// Caught in the field 2026-08-08, by an SSH session through a cascade dying each
// time a user was created.
func TestAduPayloadCoversEveryServedInbound(t *testing.T) {
	a := multiAdapter(t)
	first := "aaaaaaaa-1111-4000-8000-000000000001"
	second := "bbbbbbbb-2222-4000-8000-000000000002"
	_ = a.ApplyInbound(443, inboundWire(t, first, 443))
	_ = a.ApplyInbound(8443, inboundWire(t, second, 8443))

	a.mu.Lock()
	served := a.servedInboundsLocked()
	a.mu.Unlock()
	if len(served) != 2 {
		t.Fatalf("served %d inbounds, want 2", len(served))
	}

	data, err := buildAduPayload(served, xrayClient{ID: "uuid-a", Email: "alice"})
	if err != nil {
		t.Fatalf("buildAduPayload: %v", err)
	}
	var doc struct {
		Inbounds []struct {
			Tag string `json:"tag"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, data)
	}
	if len(doc.Inbounds) != 2 {
		t.Fatalf("adu payload carries %d inbounds, want 2: a user missing from one "+
			"inbound cannot connect there", len(doc.Inbounds))
	}
	// The tags must be the ones the RUNNING config uses, not the install-time
	// tag: naming an absent tag is what made adu a silent no-op.
	rendered := map[string]bool{}
	for _, in := range renderedInbounds(t, a) {
		if tag, _ := in["tag"].(string); tag != "" {
			rendered[tag] = true
		}
	}
	for _, in := range doc.Inbounds {
		if !rendered[in.Tag] {
			t.Errorf("adu payload names tag %q, which is not in the rendered config", in.Tag)
		}
	}
}

// A partial add is a failure: the user would be live on one inbound and missing
// on another, and nothing would say so.
func TestLiveAddDemandsEveryInbound(t *testing.T) {
	out := []byte("Added 1 user(s) in total.")
	if liveOpSucceeded(out, "Added", 2) {
		t.Error("adding 1 of 2 inbounds counted as success")
	}
	if !liveOpSucceeded(out, "Added", 1) {
		t.Error("adding the only inbound should count as success")
	}
	if !liveOpSucceeded([]byte("Added 2 user(s) in total."), "Added", 2) {
		t.Error("adding both inbounds should count as success")
	}
}

// An older panel sends no id; that path must behave exactly as before.
func TestUnidentifiedInboundKeepsLegacyBehaviour(t *testing.T) {
	a := multiAdapter(t)
	wire := []byte(`{
		"realityDest": "www.cloudflare.com:443",
		"realityServerNames": ["www.cloudflare.com"],
		"realityPrivateKey": "aGVsbG8td29ybGQtdGhpcy1pcy1hLWZha2Uta2V5MDA",
		"realityShortIds": ["0123456789abcdef"]
	}`)
	if err := a.ApplyInbound(443, wire); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	a.mu.Lock()
	held := len(a.inbounds)
	tag := a.cfg.Inbound.Tag
	a.mu.Unlock()
	if held != 0 {
		t.Fatalf("unidentified inbound went into the map (%d entries); it must stay the single legacy one", held)
	}
	if tag != validInbound().Tag {
		t.Fatalf("legacy inbound tag changed to %q", tag)
	}
}
