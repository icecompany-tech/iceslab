package xray

import (
	"encoding/json"
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

func dnsInbound(cfg *dto.DnsCfg) InboundConfig {
	in := validInbound()
	in.Dns = cfg
	return in
}

func renderedDns(t *testing.T, inbounds []InboundConfig) (map[string]any, error) {
	t.Helper()
	blob, err := renderMultiConfig(inbounds, policyUsers(), nil, 8080, nil)
	if err != nil {
		return nil, err
	}
	var cfg struct {
		Dns map[string]any `json:"dns"`
	}
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return cfg.Dns, nil
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
	dns, err := renderedDns(t, []InboundConfig{
		dnsInbound(&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}}),
	})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	servers, ok := dns["servers"].([]any)
	if !ok || len(servers) != 1 {
		t.Fatalf("servers: %v", dns["servers"])
	}
	if servers[0] != "8.8.8.8" {
		t.Errorf("plain resolver rendered as %#v, want the bare string", servers[0])
	}
}

func TestAScopedResolverKeepsItsScope(t *testing.T) {
	dns, err := renderedDns(t, []InboundConfig{
		dnsInbound(&dto.DnsCfg{
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
		}),
	})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
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

// The section is process-wide while the setting is per profile. Two profiles
// asking for different resolvers has no correct answer here, and picking one
// would leave the operator reading "resolver X" on a profile whose users are
// answered by Y.
func TestTwoProfilesDisagreeingAboutTheResolverIsRefused(t *testing.T) {
	a := dnsInbound(&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}})
	a.Tag = "in-a"
	b := dnsInbound(&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "1.1.1.1"}}})
	b.Tag = "in-b"
	b.ListenPort = 8443

	if _, err := renderedDns(t, []InboundConfig{a, b}); err == nil {
		t.Errorf("two different resolvers on one node were accepted")
	}
}

func TestTwoProfilesAgreeingIsFine(t *testing.T) {
	a := dnsInbound(&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}})
	a.Tag = "in-a"
	b := dnsInbound(&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}})
	b.Tag = "in-b"
	b.ListenPort = 8443

	dns, err := renderedDns(t, []InboundConfig{a, b})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if len(dns["servers"].([]any)) != 1 {
		t.Errorf("servers: %v", dns["servers"])
	}
}

func TestOneProfileNamingAResolverIsEnoughForTheNode(t *testing.T) {
	// The other inbound simply has no opinion; that is not a disagreement.
	a := dnsInbound(&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}})
	a.Tag = "in-a"
	b := validInbound()
	b.Tag = "in-b"
	b.ListenPort = 8443

	dns, err := renderedDns(t, []InboundConfig{a, b})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if dns == nil {
		t.Errorf("the resolver one profile asked for was dropped")
	}
}

// Changing only the resolver still has to reach the node: without this the
// switch saves in the panel and the core keeps the old section forever.
func TestChangingOnlyTheResolverCountsAsAChange(t *testing.T) {
	a := dnsInbound(&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}})
	b := dnsInbound(&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "1.1.1.1"}}})
	if inboundEqual(a, b) {
		t.Errorf("a new resolver read as no change")
	}
	if !inboundEqual(a, dnsInbound(&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}})) {
		t.Errorf("the same resolver read as a change, which would restart the core on every push")
	}
	if !inboundEqual(validInbound(), validInbound()) {
		t.Errorf("no resolver on either side read as a change")
	}
}

// The DNS-hijack rule is what sends the client's queries to the built-in
// resolver in the first place. F must not disturb the stages: this is the
// "нет" to whether the resolver touched the Policy stage.
func TestTheResolverDoesNotMoveTheRoutingStages(t *testing.T) {
	rules := renderedRules(t, nil, nil)
	before := len(rules)

	withDns, err := renderMultiConfig(
		[]InboundConfig{dnsInbound(&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "8.8.8.8"}}})},
		policyUsers(), nil, 8080, nil,
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
