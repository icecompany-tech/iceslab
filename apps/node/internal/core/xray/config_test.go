package xray

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validInbound() InboundConfig {
	return InboundConfig{
		RealityDest:        "www.cloudflare.com:443",
		RealityServerNames: []string{"www.cloudflare.com"},
		RealityPrivateKey:  "fake-private-key-for-testing",
		RealityShortIDs:    []string{"abc123"},
	}
}

func TestInboundValidation(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(*InboundConfig)
		wantErr string
	}{
		{"missing private key", func(c *InboundConfig) { c.RealityPrivateKey = "" }, "RealityPrivateKey"},
		{"missing server names", func(c *InboundConfig) { c.RealityServerNames = nil }, "RealityServerNames"},
		{"missing short IDs", func(c *InboundConfig) { c.RealityShortIDs = nil }, "RealityShortIDs"},
		{"missing dest", func(c *InboundConfig) { c.RealityDest = "" }, "RealityDest"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validInbound()
			tc.mutate(&cfg)
			if err := cfg.validate(); err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validate: got %v, want error containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestInboundDefaults(t *testing.T) {
	cfg := InboundConfig{
		RealityDest:        "x.com:443",
		RealityServerNames: []string{"x.com"},
		RealityPrivateKey:  "k",
		RealityShortIDs:    []string{"s"},
	}
	d := cfg.withDefaults()
	if d.Tag != "vless-in" {
		t.Errorf("Tag default: got %q", d.Tag)
	}
	if d.ListenHost != "0.0.0.0" {
		t.Errorf("ListenHost default: got %q", d.ListenHost)
	}
	if d.ListenPort != 443 {
		t.Errorf("ListenPort default: got %d", d.ListenPort)
	}
	// Flow is no longer defaulted — empty is the canonical "no Vision"
	// value for non-raw transports. Panel sets it explicitly when needed.
	if d.Flow != "" {
		t.Errorf("Flow default: got %q, want empty", d.Flow)
	}
}

func TestRenderConfigShape(t *testing.T) {
	users := []xrayClient{
		{ID: "uuid-1", Email: "user-a", Flow: "xtls-rprx-vision"},
		{ID: "uuid-2", Email: "user-b", Flow: "xtls-rprx-vision"},
	}
	blob, err := renderConfig(validInbound(), users)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal(blob, &parsed); err != nil {
		t.Fatalf("output is not valid JSON: %v", err)
	}

	inbounds, ok := parsed["inbounds"].([]any)
	// Slice 24c: render now emits two inbounds — the public VLESS one and a
	// dedicated `api-in` (dokodemo-door on 127.0.0.1:8080) that exposes
	// StatsService for `xray api statsquery`. Find the VLESS inbound by tag.
	if !ok || len(inbounds) != 2 {
		t.Fatalf("expected 2 inbounds (vless + api-in), got %v", parsed["inbounds"])
	}
	var inb map[string]any
	for _, raw := range inbounds {
		m := raw.(map[string]any)
		if m["protocol"] == "vless" {
			inb = m
			break
		}
	}
	if inb == nil {
		t.Fatalf("vless inbound not found in render output")
	}
	stream := inb["streamSettings"].(map[string]any)
	if stream["network"] != "raw" {
		t.Errorf("network: got %v want raw (v24.9.30 naming)", stream["network"])
	}
	if stream["security"] != "reality" {
		t.Errorf("security: got %v want reality", stream["security"])
	}
	settings := inb["settings"].(map[string]any)
	clients := settings["clients"].([]any)
	if len(clients) != 2 {
		t.Errorf("clients: got %d want 2", len(clients))
	}

	// Slice 24c — verify stats wiring is present
	if _, ok := parsed["stats"]; !ok {
		t.Errorf("stats block missing from rendered config")
	}
	api, ok := parsed["api"].(map[string]any)
	if !ok || api["tag"] != "api" {
		t.Errorf("api block missing/wrong: %v", parsed["api"])
	}
	policy := parsed["policy"].(map[string]any)
	levels := policy["levels"].(map[string]any)
	level0 := levels["0"].(map[string]any)
	if level0["statsUserUplink"] != true || level0["statsUserDownlink"] != true {
		t.Errorf("policy.levels.0 missing per-user stats flags: %v", level0)
	}
}

func TestRenderConfigEmptyClients(t *testing.T) {
	blob, err := renderConfig(validInbound(), []xrayClient{})
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	if !strings.Contains(string(blob), `"clients": []`) {
		t.Errorf("expected empty clients array in: %s", string(blob))
	}
}

func TestRenderConfigPropagatesValidationError(t *testing.T) {
	bad := validInbound()
	bad.RealityPrivateKey = ""
	if _, err := renderConfig(bad, nil); err == nil {
		t.Errorf("expected validation error to propagate")
	}
}

func TestRenderConfigWarpEgress(t *testing.T) {
	cfg := validInbound()
	cfg.Tag = "vless-in"
	cfg.Warp = &WarpConfig{
		SecretKey: "WARP-PRIV",
		Address:   []string{"172.16.0.2/32", "2606:4700:110::/128"},
		Reserved:  []int{240, 25, 146},
	}
	blob, err := renderConfig(cfg, []xrayClient{{ID: "u", Email: "u"}})
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(blob, &parsed); err != nil {
		t.Fatal(err)
	}

	// The WARP wireguard outbound must be present with defaults filled in.
	var warp map[string]any
	for _, raw := range parsed["outbounds"].([]any) {
		m := raw.(map[string]any)
		if m["tag"] == "warp" {
			warp = m
			break
		}
	}
	if warp == nil {
		t.Fatalf("warp outbound not found: %v", parsed["outbounds"])
	}
	if warp["protocol"] != "wireguard" {
		t.Errorf("warp protocol = %v, want wireguard", warp["protocol"])
	}
	s := warp["settings"].(map[string]any)
	if s["secretKey"] != "WARP-PRIV" {
		t.Errorf("secretKey = %v", s["secretKey"])
	}
	if s["mtu"].(float64) != 1280 {
		t.Errorf("mtu = %v, want 1280 (default)", s["mtu"])
	}
	reserved := s["reserved"].([]any)
	if len(reserved) != 3 || reserved[0].(float64) != 240 {
		t.Errorf("reserved = %v, want [240 25 146]", reserved)
	}
	peer := s["peers"].([]any)[0].(map[string]any)
	if peer["publicKey"] != warpDefaultPublicKey {
		t.Errorf("peer publicKey = %v, want default", peer["publicKey"])
	}
	if peer["endpoint"] != warpDefaultEndpoint {
		t.Errorf("peer endpoint = %v, want default", peer["endpoint"])
	}

	// A routing rule must send the user inbound's traffic to the warp outbound.
	rules := parsed["routing"].(map[string]any)["rules"].([]any)
	found := false
	for _, raw := range rules {
		m := raw.(map[string]any)
		if m["outboundTag"] == "warp" {
			tags := m["inboundTag"].([]any)
			if len(tags) == 1 && tags[0] == "vless-in" {
				found = true
			}
		}
	}
	if !found {
		t.Errorf("no routing rule sending vless-in -> warp: %v", rules)
	}

	// Without Warp the config must not mention warp at all (byte-stable).
	plain, _ := renderConfig(validInbound(), nil)
	if strings.Contains(string(plain), `"warp"`) {
		t.Error("non-warp config should not mention warp")
	}
}

func TestWarpValidation(t *testing.T) {
	ok := validInbound()
	ok.Warp = &WarpConfig{SecretKey: "k", Address: []string{"172.16.0.2/32"}}
	if err := ok.validate(); err != nil {
		t.Fatalf("valid warp should pass: %v", err)
	}

	noKey := validInbound()
	noKey.Warp = &WarpConfig{Address: []string{"172.16.0.2/32"}}
	if err := noKey.validate(); err == nil || !strings.Contains(err.Error(), "SecretKey") {
		t.Errorf("missing SecretKey: got %v", err)
	}

	badReserved := validInbound()
	badReserved.Warp = &WarpConfig{SecretKey: "k", Address: []string{"172.16.0.2/32"}, Reserved: []int{1, 2}}
	if err := badReserved.validate(); err == nil || !strings.Contains(err.Error(), "Reserved") {
		t.Errorf("bad reserved length: got %v", err)
	}
}

func TestWriteConfigAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "subdir", "config.json")
	blob := []byte(`{"hello":"world"}`)
	if err := writeConfig(path, blob); err != nil {
		t.Fatalf("writeConfig: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != string(blob) {
		t.Errorf("content mismatch: got %q", string(got))
	}
	// Temp file should be cleaned up after rename.
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("temp file lingered: %v", err)
	}
}

// ───── K9-B: REALITY self-steal ─────

// TestSelfSteal_RewritesDestAndValidates checks that self-steal mode (a) passes
// validation even with an empty/loopback dest the SSRF guard would normally
// reject, and (b) withDefaults rewrites RealityDest to the local fallback, so
// the rendered REALITY config points at 127.0.0.1:8443.
func TestSelfSteal_RewritesDestAndValidates(t *testing.T) {
	cfg := InboundConfig{
		RealityServerNames: []string{"node.example.com"},
		RealityPrivateKey:  "k",
		RealityShortIDs:    []string{"ab"},
		RealityMode:        "self-steal",
		// RealityDest deliberately empty: self-steal supplies it.
	}
	if err := cfg.validate(); err != nil {
		t.Fatalf("self-steal should validate without a panel dest: %v", err)
	}
	d := cfg.withDefaults()
	if d.RealityDest != selfStealAddr {
		t.Errorf("withDefaults should rewrite dest to %s, got %q", selfStealAddr, d.RealityDest)
	}

	blob, err := renderConfig(cfg, []xrayClient{{ID: "u1", Email: "u1"}})
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	if !strings.Contains(string(blob), selfStealAddr) {
		t.Errorf("rendered config should reference self-steal dest %s", selfStealAddr)
	}
}

// TestStealOthers_StillRejectsLoopbackDest guards the SSRF check for the normal
// mode: a loopback dest WITHOUT self-steal must still be refused.
func TestStealOthers_StillRejectsLoopbackDest(t *testing.T) {
	cfg := InboundConfig{
		RealityServerNames: []string{"x.com"},
		RealityPrivateKey:  "k",
		RealityShortIDs:    []string{"ab"},
		RealityDest:        "127.0.0.1:8443",
		// RealityMode empty == steal-others.
	}
	if err := cfg.validate(); err == nil {
		t.Errorf("loopback dest must be rejected when NOT self-steal (SSRF guard)")
	}
}

// ───── C3: cascade fragment merging ─────

// TestRender_CascadeNil_ByteIdenticalToBase is the safety net for non-cascade
// nodes: passing a nil *CascadeFragments must produce exactly the same bytes as
// the plain renderConfig path, so every existing node is unaffected.
func TestRender_CascadeNil_ByteIdenticalToBase(t *testing.T) {
	users := []xrayClient{{ID: "u1", Email: "u1", Flow: "xtls-rprx-vision"}}
	base, err := renderConfig(validInbound(), users)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	withNil, err := renderConfigWithCascade(validInbound(), users, nil)
	if err != nil {
		t.Fatalf("renderConfigWithCascade(nil): %v", err)
	}
	if string(base) != string(withNil) {
		t.Errorf("nil cascade must be byte-identical to base render\nbase:\n%s\nwithNil:\n%s", base, withNil)
	}
}

// TestRender_CascadeFragmentsMerged checks that the panel-generated link-in
// inbound, link-out outbound and routing rules are appended to the base config,
// and that base anti-abuse rules still precede the cascade rules.
func TestRender_CascadeFragmentsMerged(t *testing.T) {
	cascade := &CascadeFragments{
		Inbounds: []json.RawMessage{
			json.RawMessage(`{"tag":"cascade-link-in","protocol":"vless","port":24000}`),
		},
		Outbounds: []json.RawMessage{
			json.RawMessage(`{"tag":"cascade-link-out","protocol":"vless"}`),
		},
		RoutingRules: []json.RawMessage{
			json.RawMessage(`{"type":"field","inboundTag":["vless-in"],"outboundTag":"cascade-link-out"}`),
		},
	}
	blob, err := renderConfigWithCascade(validInbound(), []xrayClient{{ID: "u1", Email: "u1"}}, cascade)
	if err != nil {
		t.Fatalf("renderConfigWithCascade: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(blob, &m); err != nil {
		t.Fatalf("output is not valid JSON: %v", err)
	}

	// link-in inbound present (base vless + api-in + cascade = 3)
	inbounds := m["inbounds"].([]any)
	if len(inbounds) != 3 {
		t.Fatalf("expected 3 inbounds (vless + api-in + cascade-link-in), got %d", len(inbounds))
	}
	var sawLinkIn bool
	for _, raw := range inbounds {
		if raw.(map[string]any)["tag"] == "cascade-link-in" {
			sawLinkIn = true
		}
	}
	if !sawLinkIn {
		t.Errorf("cascade-link-in inbound not merged: %v", inbounds)
	}

	// link-out outbound present (base direct/dns-out/blocked + cascade = 4)
	outbounds := m["outbounds"].([]any)
	var sawLinkOut bool
	for _, raw := range outbounds {
		if raw.(map[string]any)["tag"] == "cascade-link-out" {
			sawLinkOut = true
		}
	}
	if !sawLinkOut {
		t.Errorf("cascade-link-out outbound not merged: %v", outbounds)
	}

	// Cascade routing rule present AND positioned after the base block rules so
	// the DNS-hijack / BitTorrent / SMTP rules keep precedence.
	rules := m["routing"].(map[string]any)["rules"].([]any)
	lastIdx, cascadeIdx := -1, -1
	for i, raw := range rules {
		r := raw.(map[string]any)
		if r["outboundTag"] == "blocked" {
			lastIdx = i // remember the last base block rule index
		}
		if r["outboundTag"] == "cascade-link-out" {
			cascadeIdx = i
		}
	}
	if cascadeIdx == -1 {
		t.Fatalf("cascade routing rule not merged: %v", rules)
	}
	if cascadeIdx < lastIdx {
		t.Errorf("cascade rule (idx %d) must come after base block rules (last block idx %d)", cascadeIdx, lastIdx)
	}
}

// TestRender_CascadeAutoBalancer covers the C3-auto path: a latency-balanced
// entry ships a top-level `observatory` plus `routing.balancers`, and its user
// rule targets the balancer via `balancerTag`. All three must land verbatim.
func TestRender_CascadeAutoBalancer(t *testing.T) {
	cascade := &CascadeFragments{
		Outbounds: []json.RawMessage{
			json.RawMessage(`{"tag":"cascade-link-out-0","protocol":"vless"}`),
			json.RawMessage(`{"tag":"cascade-link-out-1","protocol":"vless"}`),
		},
		RoutingRules: []json.RawMessage{
			json.RawMessage(`{"type":"field","network":"tcp,udp","balancerTag":"auto"}`),
		},
		Observatory: json.RawMessage(`{"subjectSelector":["cascade-link-out"],"probeURL":"https://www.gstatic.com/generate_204","probeInterval":"5m"}`),
		Balancers: []json.RawMessage{
			json.RawMessage(`{"tag":"auto","selector":["cascade-link-out"],"strategy":{"type":"leastPing"}}`),
		},
	}
	blob, err := renderConfigWithCascade(validInbound(), []xrayClient{{ID: "u1", Email: "u1"}}, cascade)
	if err != nil {
		t.Fatalf("renderConfigWithCascade: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(blob, &m); err != nil {
		t.Fatalf("output is not valid JSON: %v", err)
	}
	obs, ok := m["observatory"].(map[string]any)
	if !ok {
		t.Fatalf("observatory missing/not an object: %v", m["observatory"])
	}
	if obs["probeURL"] != "https://www.gstatic.com/generate_204" {
		t.Errorf("observatory probeURL not carried through: %v", obs)
	}
	routing := m["routing"].(map[string]any)
	bals, ok := routing["balancers"].([]any)
	if !ok || len(bals) != 1 {
		t.Fatalf("routing.balancers missing/wrong len: %v", routing["balancers"])
	}
	if bals[0].(map[string]any)["tag"] != "auto" {
		t.Errorf("balancer tag not carried: %v", bals[0])
	}
	var sawBal bool
	for _, raw := range routing["rules"].([]any) {
		if raw.(map[string]any)["balancerTag"] == "auto" {
			sawBal = true
		}
	}
	if !sawBal {
		t.Errorf("balancerTag routing rule not merged: %v", routing["rules"])
	}
}

// TestRender_CascadeNoBalancer_NoKeys: a plain cascade WITHOUT observatory/
// balancers must NOT emit those keys, the balancer path is strictly additive.
func TestRender_CascadeNoBalancer_NoKeys(t *testing.T) {
	cascade := &CascadeFragments{
		Outbounds:    []json.RawMessage{json.RawMessage(`{"tag":"cascade-link-out","protocol":"vless"}`)},
		RoutingRules: []json.RawMessage{json.RawMessage(`{"type":"field","outboundTag":"cascade-link-out"}`)},
	}
	blob, err := renderConfigWithCascade(validInbound(), nil, cascade)
	if err != nil {
		t.Fatalf("renderConfigWithCascade: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(blob, &m); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if _, ok := m["observatory"]; ok {
		t.Errorf("observatory must be absent when not provided")
	}
	if _, ok := m["routing"].(map[string]any)["balancers"]; ok {
		t.Errorf("routing.balancers must be absent when not provided")
	}
}

// TestCascadeEqual covers the restart-gate helper: nil==nil, nil!=non-nil, and
// byte-equality of the raw fragments.
func TestCascadeEqual(t *testing.T) {
	a := &CascadeFragments{Inbounds: []json.RawMessage{json.RawMessage(`{"tag":"x"}`)}}
	b := &CascadeFragments{Inbounds: []json.RawMessage{json.RawMessage(`{"tag":"x"}`)}}
	c := &CascadeFragments{Inbounds: []json.RawMessage{json.RawMessage(`{"tag":"y"}`)}}
	if !cascadeEqual(nil, nil) {
		t.Errorf("nil == nil should be equal")
	}
	if cascadeEqual(a, nil) || cascadeEqual(nil, a) {
		t.Errorf("nil and non-nil must differ")
	}
	if !cascadeEqual(a, b) {
		t.Errorf("identical fragments should be equal")
	}
	if cascadeEqual(a, c) {
		t.Errorf("different fragments should differ")
	}
}

// TestApplyInboundWire_ParsesCascade verifies the panel-pushed `cascade` field
// round-trips into the adapter's wire DTO.
func TestApplyInboundWire_ParsesCascade(t *testing.T) {
	raw := []byte(`{
		"realityPrivateKey":"k",
		"cascade":{
			"inbounds":[{"tag":"cascade-link-in"}],
			"outbounds":[{"tag":"cascade-link-out"}],
			"routingRules":[{"type":"field","outboundTag":"cascade-link-out"}]
		}
	}`)
	var wire xrayInboundCfgWire
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if wire.Cascade == nil {
		t.Fatalf("cascade not parsed from wire")
	}
	if len(wire.Cascade.Inbounds) != 1 || len(wire.Cascade.Outbounds) != 1 || len(wire.Cascade.RoutingRules) != 1 {
		t.Errorf("cascade fragments not fully parsed: %+v", wire.Cascade)
	}
}

// TestApplyInboundWire_NoCascadeIsNil: a plain node's wire has no `cascade`,
// so the field must stay nil (drives the byte-identical render path).
func TestApplyInboundWire_NoCascadeIsNil(t *testing.T) {
	var wire xrayInboundCfgWire
	if err := json.Unmarshal([]byte(`{"realityPrivateKey":"k"}`), &wire); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if wire.Cascade != nil {
		t.Errorf("expected nil cascade when absent from wire, got %+v", wire.Cascade)
	}
}

// ───── Slice 24c part 2: routing defaults + sockopt + transport branches ─────

func renderToMap(t *testing.T, cfg InboundConfig) map[string]any {
	t.Helper()
	blob, err := renderConfig(cfg, []xrayClient{{ID: "u1", Email: "u1"}})
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(blob, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return m
}

func TestRender_RoutingDefaults_SniffingOnVlessInbound(t *testing.T) {
	m := renderToMap(t, validInbound())
	inbounds := m["inbounds"].([]any)
	for _, raw := range inbounds {
		inb := raw.(map[string]any)
		if inb["protocol"] == "vless" {
			sn := inb["sniffing"].(map[string]any)
			if sn["enabled"] != true {
				t.Errorf("sniffing should be enabled on vless inbound")
			}
			dest := sn["destOverride"].([]any)
			if len(dest) != 3 {
				t.Errorf("destOverride should have 3 entries, got %v", dest)
			}
		}
	}
}

func TestRender_RoutingDefaults_DnsOutAndBlackhole(t *testing.T) {
	m := renderToMap(t, validInbound())
	outbounds := m["outbounds"].([]any)
	tags := map[string]bool{}
	for _, raw := range outbounds {
		ob := raw.(map[string]any)
		tags[ob["tag"].(string)] = true
	}
	if !tags["direct"] || !tags["dns-out"] || !tags["blocked"] {
		t.Errorf("expected tags direct/dns-out/blocked, got %v", tags)
	}
}

func TestRender_RoutingDefaults_BlockRules(t *testing.T) {
	m := renderToMap(t, validInbound())
	routing := m["routing"].(map[string]any)
	rules := routing["rules"].([]any)

	var dnsRule, btRule, smtpRule bool
	for _, raw := range rules {
		r := raw.(map[string]any)
		out := r["outboundTag"]
		if protocols, ok := r["protocol"].([]any); ok {
			for _, p := range protocols {
				if p == "dns" && out == "dns-out" {
					dnsRule = true
				}
				if p == "bittorrent" && out == "blocked" {
					btRule = true
				}
			}
		}
		if r["port"] == "25" && out == "blocked" {
			smtpRule = true
		}
	}
	if !dnsRule {
		t.Errorf("missing dns→dns-out routing rule")
	}
	if !btRule {
		t.Errorf("missing bittorrent→blocked routing rule")
	}
	if !smtpRule {
		t.Errorf("missing port:25→blocked routing rule")
	}
}

func TestRender_DirectOutboundUsesBBR(t *testing.T) {
	m := renderToMap(t, validInbound())
	outbounds := m["outbounds"].([]any)
	for _, raw := range outbounds {
		ob := raw.(map[string]any)
		if ob["tag"] == "direct" {
			ss, ok := ob["streamSettings"].(map[string]any)
			if !ok {
				t.Errorf("direct outbound missing streamSettings")
				return
			}
			sock := ss["sockopt"].(map[string]any)
			if sock["tcpCongestion"] != "bbr" {
				t.Errorf("direct outbound should set tcpCongestion=bbr, got %v", sock["tcpCongestion"])
			}
			if sock["tcpFastOpen"] != true {
				t.Errorf("direct outbound should set tcpFastOpen=true")
			}
		}
	}
}

func TestRender_Network_WSEmitsWsSettings(t *testing.T) {
	cfg := validInbound()
	cfg.Network = "ws"
	cfg.Path = "/vless"
	cfg.HostHeader = "cdn.example.com"
	m := renderToMap(t, cfg)
	for _, raw := range m["inbounds"].([]any) {
		inb := raw.(map[string]any)
		if inb["protocol"] != "vless" {
			continue
		}
		ss := inb["streamSettings"].(map[string]any)
		if ss["network"] != "ws" {
			t.Errorf("network: got %v want ws", ss["network"])
		}
		ws, ok := ss["wsSettings"].(map[string]any)
		if !ok {
			t.Fatalf("wsSettings missing")
		}
		if ws["path"] != "/vless" {
			t.Errorf("ws path: got %v want /vless", ws["path"])
		}
		headers := ws["headers"].(map[string]any)
		if headers["Host"] != "cdn.example.com" {
			t.Errorf("ws Host header: got %v", headers["Host"])
		}
	}
}

func TestRender_Network_HTTPUpgradeEmitsHttpupgradeSettings(t *testing.T) {
	cfg := validInbound()
	cfg.Network = "httpupgrade"
	cfg.Path = "/u"
	m := renderToMap(t, cfg)
	for _, raw := range m["inbounds"].([]any) {
		inb := raw.(map[string]any)
		if inb["protocol"] != "vless" {
			continue
		}
		ss := inb["streamSettings"].(map[string]any)
		if ss["network"] != "httpupgrade" {
			t.Errorf("network: got %v", ss["network"])
		}
		hu, ok := ss["httpupgradeSettings"].(map[string]any)
		if !ok {
			t.Fatalf("httpupgradeSettings missing")
		}
		if hu["path"] != "/u" {
			t.Errorf("httpupgrade path: got %v", hu["path"])
		}
	}
}

func TestRender_Network_KCPEmitsKcpSettings(t *testing.T) {
	cfg := validInbound()
	cfg.Network = "kcp"
	m := renderToMap(t, cfg)
	for _, raw := range m["inbounds"].([]any) {
		inb := raw.(map[string]any)
		if inb["protocol"] != "vless" {
			continue
		}
		ss := inb["streamSettings"].(map[string]any)
		if ss["network"] != "kcp" {
			t.Errorf("network: got %v", ss["network"])
		}
		if _, ok := ss["kcpSettings"].(map[string]any); !ok {
			t.Errorf("kcpSettings missing")
		}
	}
}

func TestRender_Network_GrpcEmitsServiceName(t *testing.T) {
	cfg := validInbound()
	cfg.Network = "grpc"
	cfg.ServiceName = "GunSvc"
	m := renderToMap(t, cfg)
	for _, raw := range m["inbounds"].([]any) {
		inb := raw.(map[string]any)
		if inb["protocol"] != "vless" {
			continue
		}
		ss := inb["streamSettings"].(map[string]any)
		grpc := ss["grpcSettings"].(map[string]any)
		if grpc["serviceName"] != "GunSvc" {
			t.Errorf("serviceName: got %v", grpc["serviceName"])
		}
	}
}

// ───── B3: extra xray options (xver / maxTimeDiff / rejectUnknownSni /
// xhttp mode+padding / grpc multiMode) ─────

// vlessStream pulls the streamSettings of the public vless inbound out of a
// rendered config, so the B3 tests can assert on the transport-level shape.
func vlessStream(t *testing.T, m map[string]any) map[string]any {
	t.Helper()
	for _, raw := range m["inbounds"].([]any) {
		inb := raw.(map[string]any)
		if inb["protocol"] == "vless" {
			return inb["streamSettings"].(map[string]any)
		}
	}
	t.Fatalf("vless inbound not found in render output")
	return nil
}

func TestRender_B3_GrpcMultiMode(t *testing.T) {
	cfg := validInbound()
	cfg.Network = "grpc"
	cfg.ServiceName = "GunSvc"
	cfg.GrpcMultiMode = true
	grpc := vlessStream(t, renderToMap(t, cfg))["grpcSettings"].(map[string]any)
	if grpc["multiMode"] != true {
		t.Errorf("grpcSettings.multiMode: got %v want true", grpc["multiMode"])
	}
}

func TestRender_B3_XhttpMode(t *testing.T) {
	cfg := validInbound()
	cfg.Network = "xhttp"
	cfg.XhttpMode = "packet-up"
	cfg.XhttpPaddingBytes = "100-1000"
	xh := vlessStream(t, renderToMap(t, cfg))["xhttpSettings"].(map[string]any)
	if xh["mode"] != "packet-up" {
		t.Errorf("xhttpSettings.mode: got %v want packet-up", xh["mode"])
	}
	extra, ok := xh["extra"].(map[string]any)
	if !ok {
		t.Fatalf("xhttpSettings.extra missing: %v", xh)
	}
	if extra["xPaddingBytes"] != "100-1000" {
		t.Errorf("xhttp xPaddingBytes: got %v want 100-1000", extra["xPaddingBytes"])
	}
}

func TestRender_B3_XhttpDefaultsToAutoNoPadding(t *testing.T) {
	cfg := validInbound()
	cfg.Network = "xhttp"
	// XhttpMode / XhttpPaddingBytes left empty — must render as before B3.
	xh := vlessStream(t, renderToMap(t, cfg))["xhttpSettings"].(map[string]any)
	if xh["mode"] != "auto" {
		t.Errorf("xhttp default mode: got %v want auto", xh["mode"])
	}
	if _, has := xh["extra"]; has {
		t.Errorf("xhttp should omit extra when no padding set: %v", xh)
	}
}

func TestRender_B3_TlsRejectUnknownSni(t *testing.T) {
	cfg := validInbound()
	cfg.Security = "tls"
	cfg.TLSServerName = "node.example.com"
	cfg.TLSCert = "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----"
	cfg.TLSKey = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"
	cfg.TLSRejectUnknownSni = true
	tls := vlessStream(t, renderToMap(t, cfg))["tlsSettings"].(map[string]any)
	if tls["rejectUnknownSni"] != true {
		t.Errorf("tlsSettings.rejectUnknownSni: got %v want true", tls["rejectUnknownSni"])
	}
}

func TestRender_B3_RealityXverAndMaxTimeDiff(t *testing.T) {
	cfg := validInbound()
	cfg.RealityXver = 2
	cfg.RealityMaxTimeDiff = 60000
	rs := vlessStream(t, renderToMap(t, cfg))["realitySettings"].(map[string]any)
	// JSON numbers decode to float64.
	if rs["xver"] != float64(2) {
		t.Errorf("realitySettings.xver: got %v want 2", rs["xver"])
	}
	if rs["maxTimeDiff"] != float64(60000) {
		t.Errorf("realitySettings.maxTimeDiff: got %v want 60000", rs["maxTimeDiff"])
	}
}

// TestRender_B3_DefaultsBackwardCompatible pins the no-op render: default xver
// 0, no maxTimeDiff, mode auto, multiMode false must match the pre-B3 output so
// existing nodes are byte-stable across the upgrade.
func TestRender_B3_DefaultsBackwardCompatible(t *testing.T) {
	rs := vlessStream(t, renderToMap(t, validInbound()))["realitySettings"].(map[string]any)
	if rs["xver"] != float64(0) {
		t.Errorf("default realitySettings.xver: got %v want 0", rs["xver"])
	}
	if _, has := rs["maxTimeDiff"]; has {
		t.Errorf("default render should omit maxTimeDiff: %v", rs)
	}

	cfg := validInbound()
	cfg.Network = "grpc"
	cfg.ServiceName = "GunSvc"
	grpc := vlessStream(t, renderToMap(t, cfg))["grpcSettings"].(map[string]any)
	if grpc["multiMode"] != false {
		t.Errorf("default grpcSettings.multiMode: got %v want false", grpc["multiMode"])
	}
}

// ───── G: probe-resistance fallback rate-limit ─────

// TestRender_G_RealityLimitFallback pins the throttle render: a non-zero
// upload/download rate emits limitFallbackUpload/Download as REALITY objects
// {afterBytes, bytesPerSec, burstBytesPerSec} on the unverified fallback path.
func TestRender_G_RealityLimitFallback(t *testing.T) {
	cfg := validInbound()
	cfg.RealityLimitFallbackUploadBytesPerSec = 1048576
	cfg.RealityLimitFallbackDownloadBytesPerSec = 2097152
	rs := vlessStream(t, renderToMap(t, cfg))["realitySettings"].(map[string]any)

	up, ok := rs["limitFallbackUpload"].(map[string]any)
	if !ok {
		t.Fatalf("realitySettings.limitFallbackUpload missing: %v", rs)
	}
	// JSON numbers decode to float64.
	if up["bytesPerSec"] != float64(1048576) {
		t.Errorf("limitFallbackUpload.bytesPerSec: got %v want 1048576", up["bytesPerSec"])
	}
	if up["burstBytesPerSec"] != float64(1048576) {
		t.Errorf("limitFallbackUpload.burstBytesPerSec: got %v want 1048576", up["burstBytesPerSec"])
	}
	if up["afterBytes"] != float64(0) {
		t.Errorf("limitFallbackUpload.afterBytes: got %v want 0", up["afterBytes"])
	}

	down, ok := rs["limitFallbackDownload"].(map[string]any)
	if !ok {
		t.Fatalf("realitySettings.limitFallbackDownload missing: %v", rs)
	}
	if down["bytesPerSec"] != float64(2097152) {
		t.Errorf("limitFallbackDownload.bytesPerSec: got %v want 2097152", down["bytesPerSec"])
	}
}

// TestRender_G_DefaultsOmitLimitFallback pins the no-op render: with both rates
// 0 (default) neither limitFallbackUpload nor limitFallbackDownload is emitted,
// so existing nodes stay byte-stable across the upgrade.
func TestRender_G_DefaultsOmitLimitFallback(t *testing.T) {
	rs := vlessStream(t, renderToMap(t, validInbound()))["realitySettings"].(map[string]any)
	if _, has := rs["limitFallbackUpload"]; has {
		t.Errorf("default render should omit limitFallbackUpload: %v", rs)
	}
	if _, has := rs["limitFallbackDownload"]; has {
		t.Errorf("default render should omit limitFallbackDownload: %v", rs)
	}
}

// ───── Slice 24c part 3: Trojan subprotocol ─────

func TestRender_DefaultsToVless(t *testing.T) {
	m := renderToMap(t, validInbound())
	for _, raw := range m["inbounds"].([]any) {
		inb := raw.(map[string]any)
		if inb["tag"] == "vless-in" || inb["tag"] == "" {
			if inb["protocol"] != "vless" {
				t.Errorf("default subprotocol should be vless, got %v", inb["protocol"])
			}
		}
	}
}

func TestRender_TrojanInboundProtocol(t *testing.T) {
	cfg := validInbound()
	cfg.Subprotocol = "trojan"
	m := renderToMap(t, cfg)

	var trojanInb map[string]any
	for _, raw := range m["inbounds"].([]any) {
		inb := raw.(map[string]any)
		if inb["protocol"] == "trojan" {
			trojanInb = inb
			break
		}
	}
	if trojanInb == nil {
		t.Fatalf("trojan inbound not found in render")
	}

	settings := trojanInb["settings"].(map[string]any)
	clients := settings["clients"].([]any)
	if len(clients) != 1 {
		t.Fatalf("expected 1 client, got %d", len(clients))
	}
	c := clients[0].(map[string]any)
	if c["password"] != "u1" {
		t.Errorf("trojan client should have password=ID, got %v", c["password"])
	}
	if _, hasID := c["id"]; hasID {
		t.Errorf("trojan client should NOT have `id` field, only `password`")
	}
	// Trojan also doesn't carry the VLESS-only `decryption: none`
	if _, hasDec := settings["decryption"]; hasDec {
		t.Errorf("trojan settings should NOT have `decryption` field")
	}
}

func TestRender_Trojan_StillUsesRealityStreamSettings(t *testing.T) {
	cfg := validInbound()
	cfg.Subprotocol = "trojan"
	m := renderToMap(t, cfg)
	for _, raw := range m["inbounds"].([]any) {
		inb := raw.(map[string]any)
		if inb["protocol"] != "trojan" {
			continue
		}
		ss := inb["streamSettings"].(map[string]any)
		if ss["security"] != "reality" {
			t.Errorf("trojan should still use REALITY security, got %v", ss["security"])
		}
		// Reality settings should contain server names + private key
		rs := ss["realitySettings"].(map[string]any)
		if rs["privateKey"] != "fake-private-key-for-testing" {
			t.Errorf("trojan should preserve REALITY private key")
		}
	}
}
