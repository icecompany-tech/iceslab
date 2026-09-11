package xray

import (
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// Э3 piece F: who answers the users' name lookups.
//
// The node renders no `dns` section today, so the DNS-hijack rule hands client
// queries to dns-out and they fall through to the NODE's own resolver. On a
// cascade that is the wrong machine: the name is resolved by the entry while
// the connection leaves from the exit (E13). What matters first, exactly as
// with the policy, is that naming nothing changes nothing: the golden in
// policy_test.go was captured before either field existed and still has to
// match, which is why there is no second golden here.
//
// The setting is the NODE's. It shipped on the inbound first, and this file
// used to hold two tests about what happens when two profiles on one node
// disagree about it. There is nothing left to disagree: one node, one resolver,
// one place to put it.

func renderedDns(t *testing.T, dns *dto.DnsCfg) map[string]any {
	t.Helper()
	blob, err := renderMultiConfig([]InboundConfig{validInbound()}, policyUsers(), nil, 8080, nil, dns)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	var cfg struct {
		Dns map[string]any `json:"dns"`
	}
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return cfg.Dns
}

func dnsAdapter(t *testing.T) *Adapter {
	t.Helper()
	dir := t.TempDir()
	return New(Config{
		ConfigPath: filepath.Join(dir, "config.json"), // config-only mode: no binary
		Inbound:    validInbound(),
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestNoResolverRendersNoDnsSection(t *testing.T) {
	// Not an empty section: the key is absent, which is what makes shipping the
	// field ahead of the panel side inert.
	blob, err := renderConfig(validInbound(), policyUsers())
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(blob, &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, present := doc["dns"]; present {
		t.Errorf("a node nobody set a resolver on rendered a dns section")
	}
}

func TestAResolverWithNoScopeRendersAsABareString(t *testing.T) {
	// The shape xray's own documentation uses for a plain fallback. The object
	// form works too, but a config an operator opens should look familiar.
	dns := renderedDns(t, &dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}})
	servers, ok := dns["servers"].([]any)
	if !ok || len(servers) != 1 {
		t.Fatalf("servers: %v", dns["servers"])
	}
	if servers[0] != "8.8.8.8" {
		t.Errorf("plain resolver rendered as %#v, want the bare string", servers[0])
	}
}

func TestAScopedResolverKeepsItsScope(t *testing.T) {
	dns := renderedDns(t, &dto.DnsCfg{
		Servers: []dto.DnsServer{
			{
				Address:      "77.88.8.8",
				Domains:      []string{"geosite:category-ru"},
				ExpectIPs:    []string{"geoip:ru"},
				SkipFallback: true,
			},
			{Address: "8.8.8.8"},
		},
		QueryStrategy: "UseIPv4",
	})
	servers := dns["servers"].([]any)
	if len(servers) != 2 {
		t.Fatalf("servers: %v", servers)
	}
	first := servers[0].(map[string]any)
	if first["address"] != "77.88.8.8" {
		t.Errorf("address: %v", first["address"])
	}
	// xray spells it expectIPs, not expectIps. Getting the case wrong is
	// silent: the field is ignored and the scoping simply does not apply.
	if _, ok := first["expectIPs"]; !ok {
		t.Errorf("expectIPs missing or misspelled: %v", first)
	}
	if first["skipFallback"] != true {
		t.Errorf("skipFallback: %v", first["skipFallback"])
	}
	if servers[1] != "8.8.8.8" {
		t.Errorf("fallback resolver: %#v", servers[1])
	}
	if dns["queryStrategy"] != "UseIPv4" {
		t.Errorf("queryStrategy: %v", dns["queryStrategy"])
	}
}

// The push carries the resolver next to the policy, and the adapter has to take
// it from there. On the inbound it would be ignored now, which is the point of
// the move: one process, one section, one place it can come from.
func TestTheNodeTakesItsResolverFromThePushAndNotFromAnInbound(t *testing.T) {
	a := dnsAdapter(t)
	if err := a.ApplyDns(json.RawMessage(`{"servers":[{"address":"77.88.8.8"}]}`)); err != nil {
		t.Fatalf("ApplyDns: %v", err)
	}
	if a.dns == nil || len(a.dns.Servers) != 1 || a.dns.Servers[0].Address != "77.88.8.8" {
		t.Fatalf("the node did not keep the resolver it was pushed: %#v", a.dns)
	}

	// The same value inside an inbound config reaches nothing: the field is off
	// the inbound wire shape, so an older panel that still sends it there is
	// ignored rather than half-obeyed.
	if err := a.ApplyInbound(443, []byte(`{
		"inboundId": "ib-1",
		"realityDest": "www.cloudflare.com:443",
		"realityServerNames": ["www.cloudflare.com"],
		"realityPrivateKey": "aGVsbG8td29ybGQtdGhpcy1pcy1hLWZha2Uta2V5MDA",
		"realityShortIds": ["0123456789abcdef"],
		"dns": {"servers":[{"address":"1.1.1.1"}]}
	}`)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.dns.Servers[0].Address != "77.88.8.8" {
		t.Errorf("an inbound overwrote the node's resolver: %#v", a.dns)
	}
}

// A repeated push must be a no-op. Without this every applyInbounds would look
// like a change and restart the core, dropping every live connection on the
// node for nothing.
func TestRepeatingTheSameResolverIsNotAChange(t *testing.T) {
	same := &dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}}
	other := &dto.DnsCfg{Servers: []dto.DnsServer{{Address: "1.1.1.1"}}}

	if !dnsEqual(same, &dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}}) {
		t.Errorf("the same resolver read as a change")
	}
	if dnsEqual(same, other) {
		t.Errorf("a different resolver read as no change")
	}
	if !dnsEqual(nil, nil) {
		t.Errorf("no resolver on either side read as a change")
	}
	if dnsEqual(nil, same) || dnsEqual(same, nil) {
		t.Errorf("naming and un-naming a resolver read as no change")
	}
}

// Removing it is a state, not "no news". Reading an absent resolver as "keep
// what you had" would leave the node answering through one the operator has
// just taken off it, with the panel showing none.
func TestAnAbsentResolverRemovesTheSection(t *testing.T) {
	a := dnsAdapter(t)
	if err := a.ApplyDns(json.RawMessage(`{"servers":[{"address":"8.8.8.8"}]}`)); err != nil {
		t.Fatalf("ApplyDns: %v", err)
	}
	if err := a.ApplyDns(nil); err != nil {
		t.Fatalf("ApplyDns(nil): %v", err)
	}
	if a.dns != nil {
		t.Errorf("the resolver survived being removed: %#v", a.dns)
	}
}

// An empty `servers` array is a config xray refuses, and it refuses configs
// WHOLE: accepting this would take the node's inbounds down with it. Refused
// where the reason can still be read.
func TestAResolverWithNoServersIsRefused(t *testing.T) {
	a := dnsAdapter(t)
	if err := a.ApplyDns(json.RawMessage(`{"servers":[]}`)); err == nil {
		t.Errorf("a dns section with no servers was accepted")
	}
	if a.dns != nil {
		t.Errorf("a refused resolver was stored anyway: %#v", a.dns)
	}
}

// The DNS-hijack rule is what sends the client's queries to the built-in
// resolver in the first place. F must not disturb the stages: this is the
// "нет" to whether the resolver touched the Policy stage.
func TestTheResolverDoesNotMoveTheRoutingStages(t *testing.T) {
	rules := renderedRules(t, nil, nil)
	before := len(rules)

	withDns, err := renderMultiConfig(
		[]InboundConfig{validInbound()}, policyUsers(), nil, 8080, nil,
		&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}},
	)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	var cfg struct {
		Routing struct {
			Rules []map[string]any `json:"rules"`
		} `json:"routing"`
	}
	if err := json.Unmarshal(withDns, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(cfg.Routing.Rules) != before {
		t.Fatalf("naming a resolver changed the rule count: %d -> %d", before, len(cfg.Routing.Rules))
	}
	// And the hijack rule is still first after the loopback management one.
	if cfg.Routing.Rules[1]["outboundTag"] != "dns-out" {
		t.Errorf("the DNS-hijack rule moved: %v", cfg.Routing.Rules[1])
	}
}
