package xray

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// The node-level policy: what this node does with traffic, decided here rather
// than by the client.
//
// The first thing that has to be true is that it changes NOTHING until the
// panel actually sends a rule. A contract shipped ahead of its producer is only
// safe if the empty case is provably inert, otherwise the plumbing commit
// silently rewrites every node's config and the change is attributed to
// whatever ships next.

const goldenPath = "testdata/render-empty-policy.json"

func policyUsers() []xrayClient {
	return []xrayClient{{ID: "11111111-2222-3333-4444-555555555555", Email: "alice"}}
}

// TestRenderWithoutPolicyMatchesGolden is the byte-identical proof.
//
// The golden was captured from the code as it stood BEFORE the policy field
// existed: `git stash` the change, regenerate with UPDATE_GOLDEN=1, restore.
// renderConfig's signature is untouched by this work, which is what makes the
// two runs comparable at all.
//
// Regenerating is deliberately behind an environment variable. A golden that
// rewrites itself when the output changes is not a test, it is a record of
// whatever happened last.
func TestRenderWithoutPolicyMatchesGolden(t *testing.T) {
	blob, err := renderConfig(validInbound(), policyUsers())
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}

	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.MkdirAll(filepath.Dir(goldenPath), 0o755); err != nil {
			t.Fatalf("mkdir testdata: %v", err)
		}
		if err := os.WriteFile(goldenPath, blob, 0o644); err != nil {
			t.Fatalf("write golden: %v", err)
		}
		t.Skip("golden regenerated")
	}

	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("read golden (regenerate with UPDATE_GOLDEN=1): %v", err)
	}
	if string(blob) != string(want) {
		t.Errorf("config with no policy differs from the pre-policy render\n--- want\n%s\n--- got\n%s", want, blob)
	}
}

// nil and an empty list are the same state and must not render differently:
// the panel may send either, and a node that restarted its core over the
// difference would drop every live connection for nothing.
func TestNilAndEmptyPolicyRenderTheSame(t *testing.T) {
	withNil, err := renderMultiConfig([]InboundConfig{validInbound()}, policyUsers(), nil, 8080, nil)
	if err != nil {
		t.Fatalf("render(nil): %v", err)
	}
	withEmpty, err := renderMultiConfig(
		[]InboundConfig{validInbound()}, policyUsers(), nil, 8080, []dto.NodePolicyRule{},
	)
	if err != nil {
		t.Fatalf("render(empty): %v", err)
	}
	if string(withNil) != string(withEmpty) {
		t.Errorf("nil and empty policy render differently")
	}
}

func renderedRules(t *testing.T, policy []dto.NodePolicyRule, cascade *CascadeFragments) []map[string]any {
	t.Helper()
	blob, err := renderMultiConfig([]InboundConfig{validInbound()}, policyUsers(), cascade, 8080, policy)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	var cfg struct {
		Routing struct {
			Rules []map[string]any `json:"rules"`
		} `json:"routing"`
	}
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return cfg.Routing.Rules
}

// Where the stage sits is the whole design, so it is pinned rather than
// described. Protection is ours and a policy rule must not be able to unblock
// what we block; the doors out come after, so "RU direct, the rest through the
// tunnel" beats a cascade entry's catch-all instead of never firing behind it.
func TestPolicySitsAfterProtectionAndBeforeTheDoorsOut(t *testing.T) {
	cascade := &CascadeFragments{
		RoutingRules: []json.RawMessage{
			json.RawMessage(`{"type":"field","inboundTag":["vless-in"],"outboundTag":"cascade-link-out-d1-0"}`),
		},
		Outbounds: []json.RawMessage{
			json.RawMessage(`{"tag":"cascade-link-out-d1-0","protocol":"vless"}`),
		},
	}
	policy := []dto.NodePolicyRule{{
		Match:  dto.NodePolicyMatch{Domain: []string{"geosite:category-ru"}},
		Action: dto.NodePolicyAction{Kind: dto.PolicyActionDirect},
	}}

	rules := renderedRules(t, policy, cascade)

	indexOf := func(pred func(map[string]any) bool) int {
		for i, r := range rules {
			if pred(r) {
				return i
			}
		}
		return -1
	}
	smtp := indexOf(func(r map[string]any) bool { return r["port"] == "25" })
	ours := indexOf(func(r map[string]any) bool {
		d, ok := r["domain"].([]any)
		return ok && len(d) == 1 && d[0] == "geosite:category-ru"
	})
	cascadeRule := indexOf(func(r map[string]any) bool {
		return r["outboundTag"] == "cascade-link-out-d1-0"
	})

	if smtp < 0 || ours < 0 || cascadeRule < 0 {
		t.Fatalf("missing a rule: smtp=%d policy=%d cascade=%d\n%v", smtp, ours, cascadeRule, rules)
	}
	if !(smtp < ours && ours < cascadeRule) {
		t.Errorf("order must be protection < policy < door out, got smtp=%d policy=%d cascade=%d",
			smtp, ours, cascadeRule)
	}
}

func TestEachActionNamesTheRightOutbound(t *testing.T) {
	cases := []struct {
		action dto.NodePolicyAction
		want   string
	}{
		{dto.NodePolicyAction{Kind: dto.PolicyActionDirect}, "direct"},
		{dto.NodePolicyAction{Kind: dto.PolicyActionBlock}, "blocked"},
		{dto.NodePolicyAction{Kind: dto.PolicyActionWarp}, "warp"},
		{dto.NodePolicyAction{Kind: dto.PolicyActionCascade, Exit: "cascade-link-out-d2-0"}, "cascade-link-out-d2-0"},
	}
	for _, c := range cases {
		got, err := policyOutboundTag(c.action)
		if err != nil {
			t.Fatalf("%s: %v", c.action.Kind, err)
		}
		if got != c.want {
			t.Errorf("%s -> %q, want %q", c.action.Kind, got, c.want)
		}
	}
}

// An action this core cannot name is refused, not dropped. A policy that
// silently loses a line is the worst outcome available: the rule is visible in
// the panel, the node reports success, and traffic goes somewhere else.
func TestAnUnrenderableActionIsRefusedRatherThanSkipped(t *testing.T) {
	for _, action := range []dto.NodePolicyAction{
		{Kind: "elsewhere"},
		{Kind: ""},
		{Kind: dto.PolicyActionCascade}, // no exit named
	} {
		if _, err := buildPolicyRules([]dto.NodePolicyRule{{Action: action}}); err == nil {
			t.Errorf("action %+v was accepted", action)
		}
	}
}

func policyAdapter(t *testing.T) *Adapter {
	t.Helper()
	return New(Config{
		ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		Inbound:    validInbound(),
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestApplyPolicyStoresAndClears(t *testing.T) {
	a := policyAdapter(t)

	if err := a.ApplyPolicy(nil); err != nil {
		t.Fatalf("nil policy: %v", err)
	}
	if len(a.policy) != 0 {
		t.Fatalf("nil policy stored %d rules", len(a.policy))
	}

	raw := json.RawMessage(`{"rules":[{"match":{"ip":["geoip:ru"]},"action":{"kind":"direct"}}]}`)
	if err := a.ApplyPolicy(raw); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(a.policy) != 1 {
		t.Fatalf("policy not stored: %+v", a.policy)
	}

	// An empty policy is how a policy is REMOVED. Treating it as "no news"
	// would leave the last one running forever.
	if err := a.ApplyPolicy(json.RawMessage(`{"rules":[]}`)); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if len(a.policy) != 0 {
		t.Errorf("empty policy did not clear the stored one: %+v", a.policy)
	}
}

// A push that repeats the same policy has to be a no-op. Every applyInbounds
// carries it, so comparing wrongly would restart the core on every push and
// drop every live connection on the node.
func TestRepeatingTheSamePolicyIsANoOp(t *testing.T) {
	a := policyAdapter(t)
	raw := json.RawMessage(`{"rules":[{"match":{"domain":["geosite:category-ads-all"]},"action":{"kind":"block"}}]}`)
	if err := a.ApplyPolicy(raw); err != nil {
		t.Fatalf("first: %v", err)
	}
	first := a.policy
	if err := a.ApplyPolicy(raw); err != nil {
		t.Fatalf("second: %v", err)
	}
	if !policyEqual(first, a.policy) {
		t.Errorf("identical policies compared unequal")
	}
}

func TestABadPolicyDoesNotReplaceTheRunningOne(t *testing.T) {
	a := policyAdapter(t)
	good := json.RawMessage(`{"rules":[{"match":{"ip":["geoip:ru"]},"action":{"kind":"direct"}}]}`)
	if err := a.ApplyPolicy(good); err != nil {
		t.Fatalf("good: %v", err)
	}

	bad := json.RawMessage(`{"rules":[{"match":{},"action":{"kind":"sideways"}}]}`)
	if err := a.ApplyPolicy(bad); err == nil {
		t.Fatalf("a policy this core cannot render was accepted")
	}
	if len(a.policy) != 1 || a.policy[0].Action.Kind != dto.PolicyActionDirect {
		t.Errorf("the running policy was replaced by one that cannot render: %+v", a.policy)
	}
}

func TestMalformedPolicyJsonIsAnError(t *testing.T) {
	a := policyAdapter(t)
	if err := a.ApplyPolicy(json.RawMessage(`{"rules":`)); err == nil {
		t.Errorf("truncated policy JSON was accepted")
	}
}
