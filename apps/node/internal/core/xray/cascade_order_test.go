package xray

import (
	"encoding/json"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// Where the node policy sits INSIDE the cascade fragments.
//
// The stage order was settled one level up (protection, policy, the doors out)
// and then turned out to be too coarse. The fragments a cascade entry ships are
// not all doors: the A4 grants among them name a user AND a set of domains, and
// they were landing below a policy rule that names neither. The narrow rule
// never fired.
//
// That is not an abstract ordering problem. An A4 grant is something the
// operator SOLD to a squad; it dies silently, on a node that reports success
// and keeps passing traffic out through the other door.

// entryFragments is the shape buildTopologyFragmentsForNode prints for a
// cascade ENTRY that carries one A4 policy: the QUIC block, the grant, the
// per-direction selector, and the catch-all that ends the list.
func entryFragments() *CascadeFragments {
	return &CascadeFragments{
		RoutingRules: []json.RawMessage{
			json.RawMessage(`{"type":"field","network":"udp","port":"443","outboundTag":"blocked"}`),
			json.RawMessage(`{"type":"field","vlessRoute":"257","domain":["domain:ads.example.com"],"outboundTag":"blocked"}`),
			json.RawMessage(`{"type":"field","vlessRoute":"257","domain":["geosite:category-ru"],"outboundTag":"direct"}`),
			json.RawMessage(`{"type":"field","vlessRoute":"1,257","outboundTag":"cascade-link-out-d1-0"}`),
			json.RawMessage(`{"type":"field","network":"tcp,udp","outboundTag":"cascade-link-out-d1-0"}`),
		},
		Outbounds: []json.RawMessage{
			json.RawMessage(`{"tag":"cascade-link-out-d1-0","protocol":"vless"}`),
		},
	}
}

func indexOfRule(rules []map[string]any, pred func(map[string]any) bool) int {
	for i, r := range rules {
		if pred(r) {
			return i
		}
	}
	return -1
}

// The case the architect named: the grant and the policy argue about one
// domain. Before the cut the policy stood above and answered for everybody,
// including the subscriber who had paid for the other answer.
func TestAGrantAimedAtOneUserBeatsAPolicyAimedAtEverybody(t *testing.T) {
	policy := []dto.NodePolicyRule{{
		Match:  dto.NodePolicyMatch{Domain: []string{"geosite:category-ru"}},
		Action: dto.NodePolicyAction{Kind: dto.PolicyActionCascade, Exit: "cascade-link-out-d1-0"},
	}}
	rules := renderedRules(t, policy, entryFragments())

	hasDomain := func(want string) func(map[string]any) bool {
		return func(r map[string]any) bool {
			d, ok := r["domain"].([]any)
			return ok && len(d) == 1 && d[0] == want
		}
	}
	smtp := indexOfRule(rules, func(r map[string]any) bool { return r["port"] == "25" })
	quic := indexOfRule(rules, func(r map[string]any) bool { return r["port"] == "443" })
	// The grant and the policy rule carry the SAME domain, so the grant is the
	// one that also names a user.
	grant := indexOfRule(rules, func(r map[string]any) bool {
		return hasDomain("geosite:category-ru")(r) && r["vlessRoute"] != nil
	})
	policyRule := indexOfRule(rules, func(r map[string]any) bool {
		return hasDomain("geosite:category-ru")(r) && r["vlessRoute"] == nil
	})
	selector := indexOfRule(rules, func(r map[string]any) bool {
		return r["vlessRoute"] == "1,257"
	})
	catchAll := indexOfRule(rules, func(r map[string]any) bool {
		return r["network"] == "tcp,udp" && r["domain"] == nil
	})

	if smtp < 0 || quic < 0 || grant < 0 || policyRule < 0 || selector < 0 || catchAll < 0 {
		t.Fatalf("missing a rule: smtp=%d quic=%d grant=%d policy=%d selector=%d catchAll=%d\n%v",
			smtp, quic, grant, policyRule, selector, catchAll, rules)
	}
	// Protection first and immovable, then everything that names a destination,
	// then the operator's policy, then the ways out.
	if !(smtp < quic && quic < grant && grant < policyRule && policyRule < selector && selector < catchAll) {
		t.Errorf("order must be protection < quic < grant < policy < selector < catch-all, got %d %d %d %d %d %d",
			smtp, quic, grant, policyRule, selector, catchAll)
	}
}

// The panel's own order inside the fragments is never touched. This is what
// makes the cut safe to apply to a shape we deliberately keep opaque: with no
// policy the two halves are the original list again, so a cascade node with no
// policy renders exactly what it rendered before.
func TestTheCutNeverReordersTheFragments(t *testing.T) {
	lists := [][]json.RawMessage{
		entryFragments().RoutingRules,
		// A narrow rule AFTER a door. It is already dead (the door matched
		// first), and the prefix cut leaves it where the panel put it rather
		// than hoisting it past the door and changing what the node does.
		{
			json.RawMessage(`{"type":"field","inboundTag":["cascade-link-in"],"outboundTag":"direct"}`),
			json.RawMessage(`{"type":"field","domain":["example.com"],"outboundTag":"blocked"}`),
		},
		// Nothing but doors (a transit, a direction's node).
		{json.RawMessage(`{"type":"field","inboundTag":["cascade-link-in"],"outboundTag":"cascade-link-out-d1-0"}`)},
		nil,
	}
	for _, list := range lists {
		head, tail := cutCascadeRulesAtTheFirstDoor(list)
		joined := append(append([]json.RawMessage{}, head...), tail...)
		if len(joined) != len(list) {
			t.Fatalf("the cut lost or grew rules: %d -> %d", len(list), len(joined))
		}
		for i := range list {
			if string(joined[i]) != string(list[i]) {
				t.Errorf("rule %d changed place: %s", i, list[i])
			}
		}
	}
}

// Which side of the policy a fragment lands on, stated as a table so the answer
// is read rather than inferred from the renderer.
func TestARuleThatSaysNothingAboutTheDestinationIsADoor(t *testing.T) {
	cases := []struct {
		name string
		rule string
		door bool
	}{
		{"entry catch-all", `{"type":"field","network":"tcp,udp","outboundTag":"cascade-link-out"}`, true},
		{"direction selector", `{"type":"field","vlessRoute":"1,257","outboundTag":"cascade-link-out-d1-0"}`, true},
		{"balancer", `{"type":"field","vlessRoute":"65281","network":"tcp,udp","balancerTag":"auto"}`, true},
		{"transit by credential", `{"type":"field","user":["lnk-d1-abcd1234"],"outboundTag":"cascade-link-out-d1-0"}`, true},
		{"a direction's node", `{"type":"field","inboundTag":["cascade-link-in"],"outboundTag":"direct"}`, true},
		{"A4 grant", `{"type":"field","vlessRoute":"257","domain":["geosite:category-ru"],"outboundTag":"direct"}`, false},
		{"QUIC block", `{"type":"field","network":"udp","port":"443","outboundTag":"blocked"}`, false},
		{"by address", `{"type":"field","ip":["geoip:ru"],"outboundTag":"direct"}`, false},
		{"by sniffed protocol", `{"type":"field","protocol":["bittorrent"],"outboundTag":"blocked"}`, false},
		// Unreadable: treated as a door, which is where every fragment went
		// before the cut existed. The core's own -test has the last word.
		{"not an object", `["nonsense"]`, true},
	}
	for _, c := range cases {
		if got := isDoorRule(json.RawMessage(c.rule)); got != c.door {
			t.Errorf("%s: door=%v, want %v", c.name, got, c.door)
		}
	}
}
