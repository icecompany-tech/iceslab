package xray

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

// socks and http, the Telegram entries (2026-09-23). Everything here was read
// off Xray-core v26.3.27 before the code was written: neither is a user manager
// (proxy/proxy.go:77), socks defaults to NO_AUTH (infra/conf/socks.go:40-48),
// an http inbound without accounts asks for no password (proxy/http/server.go:
// 125), and both key their per-user counters by the login
// (proxy/socks/protocol.go:162, proxy/http/server.go:131).

func vlessIn() InboundConfig {
	c := validInbound()
	c.Tag = "in-vless"
	c.ListenPort = 443
	c.RealityPrivateKey = "aGVsbG8td29ybGQtdGhpcy1pcy1hLWZha2Uta2V5MDA"
	return c
}

func plainIn(sub string, port int) InboundConfig {
	return InboundConfig{Tag: "in-" + sub, ListenPort: port, Subprotocol: sub, Security: "none", Network: "raw"}
}

var (
	alice = xrayClient{ID: "11111111-1111-4111-8111-111111111111", Email: "u-alice", Login: "alice"}
	bob   = xrayClient{ID: "22222222-2222-4222-8222-222222222222", Email: "u-bob", Login: "bob"}
	// A user from a panel that does not send the username: no socks account.
	nameless = xrayClient{ID: "33333333-3333-4333-8333-333333333333", Email: "u-nameless"}
)

func renderedInboundByTag(t *testing.T, ins []InboundConfig, users []xrayClient) map[string]map[string]any {
	t.Helper()
	blob, err := renderMultiConfig(ins, users, nil, 8080, nil, nil)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	var cfg struct {
		Inbounds []map[string]any `json:"inbounds"`
	}
	if err := json.Unmarshal(blob, &cfg); err != nil {
		t.Fatal(err)
	}
	out := map[string]map[string]any{}
	for _, ib := range cfg.Inbounds {
		out[ib["tag"].(string)] = ib
	}
	return out
}

func TestSocksAsksForAPasswordInSoManyWords(t *testing.T) {
	// Without "auth": "password" xray builds a NO_AUTH socks server: an open
	// proxy. Pinned, so nobody "simplifies" the key away as a default.
	got := renderedInboundByTag(t, []InboundConfig{plainIn("socks", 1080)}, []xrayClient{alice, nameless})
	ib := got["in-socks"]
	if ib == nil {
		t.Fatal("socks inbound not rendered")
	}
	if ib["protocol"] != "socks" {
		t.Errorf("protocol = %v", ib["protocol"])
	}
	s := ib["settings"].(map[string]any)
	if s["auth"] != "password" {
		t.Errorf("auth = %v, want password", s["auth"])
	}
	if s["udp"] != false {
		t.Errorf("udp = %v, want false", s["udp"])
	}
	accounts := s["accounts"].([]any)
	if len(accounts) != 1 {
		t.Fatalf("want one account (the user without a login gets none), got %v", accounts)
	}
	acc := accounts[0].(map[string]any)
	if acc["user"] != "alice" || acc["pass"] != alice.ID {
		t.Errorf("account = %v, want alice / her xrayUuid", acc)
	}
	stream := ib["streamSettings"].(map[string]any)
	if stream["security"] != "none" || stream["network"] != "raw" {
		t.Errorf("stream = %v, want none over raw", stream)
	}
}

func TestHTTPIsNeverTransparentAndAlwaysHasAccounts(t *testing.T) {
	got := renderedInboundByTag(t, []InboundConfig{plainIn("http", 3128)}, []xrayClient{alice, bob})
	ib := got["in-http"]
	if ib == nil || ib["protocol"] != "http" {
		t.Fatalf("http inbound = %v", ib)
	}
	s := ib["settings"].(map[string]any)
	if s["allowTransparent"] != false {
		t.Errorf("allowTransparent = %v, want false", s["allowTransparent"])
	}
	if n := len(s["accounts"].([]any)); n != 2 {
		t.Errorf("accounts = %d, want 2", n)
	}
}

func TestAPlainInboundWithNobodyOnItIsNotRendered(t *testing.T) {
	// An http inbound with no accounts asks for no password at all
	// (proxy/http/server.go:125): an open proxy on the internet. No accounts,
	// no inbound, for socks as well, so the rule is one rule.
	for _, users := range [][]xrayClient{nil, {nameless}} {
		got := renderedInboundByTag(t,
			[]InboundConfig{vlessIn(), plainIn("socks", 1080), plainIn("http", 3128)}, users)
		if got["in-socks"] != nil || got["in-http"] != nil {
			t.Errorf("users %v: a socks/http inbound with no accounts was rendered", users)
		}
		if got["in-vless"] == nil {
			t.Errorf("users %v: the vless inbound went missing with them", users)
		}
	}
}

func TestPlainTakesNoneOverRawOnly(t *testing.T) {
	for _, mut := range []func(*InboundConfig){
		func(c *InboundConfig) { c.Security = "" }, // "" is REALITY in this agent
		func(c *InboundConfig) { c.Security = "tls" },
		func(c *InboundConfig) { c.Network = "ws" },
	} {
		c := plainIn("socks", 1080)
		mut(&c)
		if err := c.validate(); err == nil {
			t.Errorf("accepted %+v", c)
		}
	}
	if c := plainIn("http", 3128); c.validate() != nil {
		t.Errorf("refused a correct http inbound: %v", c.validate())
	}
}

// liveAdapter: an adapter with a running stand-in core and a recording RunCmd,
// holding vless + socks + http, so a user change goes down the live path.
type liveCall struct {
	args []string
	file string // contents of the payload file, when the call took one
}

func liveAdapter(t *testing.T, users ...xrayClient) (*Adapter, *[]liveCall, *bytes.Buffer) {
	t.Helper()
	var calls []liveCall
	logs := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logs, nil))
	a := New(Config{
		BinaryPath: "/usr/bin/xray",
		ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		Inbound:    vlessIn(),
		RunCmd: func(_ context.Context, _ string, args ...string) ([]byte, error) {
			c := liveCall{args: args}
			if last := args[len(args)-1]; strings.HasSuffix(last, ".json") {
				if b, err := os.ReadFile(last); err == nil {
					c.file = string(b)
				}
			}
			calls = append(calls, c)
			return []byte("Added 1 user(s) in total.\nRemoved 1 user(s) in total."), nil
		},
	}, logger)
	a.inbounds = map[string]InboundConfig{"v": vlessIn(), "s": plainIn("socks", 1080), "h": plainIn("http", 3128)}
	for _, u := range users {
		a.users[u.Email] = u
	}
	a.proc = subprocess.New(subprocess.Config{Name: "xray-stub", Binary: "/bin/sleep", Args: []string{"30"}, Logger: logger})
	if err := a.proc.Start(context.Background()); err != nil {
		t.Skipf("no /bin/sleep to stand in for the core: %v", err)
	}
	t.Cleanup(func() { _ = a.proc.Stop(context.Background()) })
	return a, &calls, logs
}

func verbs(calls []liveCall) []string {
	var out []string
	for _, c := range calls {
		if len(c.args) >= 2 && c.args[0] == "api" {
			out = append(out, c.args[1])
		}
		if len(c.args) >= 1 && c.args[0] == "run" {
			out = append(out, "RESTART")
		}
	}
	return out
}

// The test asked for on 23.09: a node with vless and socks, a user is added,
// vless gets adu and socks is replaced by rmi + adi, and nothing restarts.
func TestAddingAUserChangesVlessByAduAndSocksByReplacement(t *testing.T) {
	a, calls, logs := liveAdapter(t, bob)

	if err := a.AddUser(core.User{UserID: alice.Email, XrayUUID: alice.ID, Username: alice.Login}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	got := verbs(*calls)
	want := []string{"adu", "rmi", "adi", "rmi", "adi"} // vless once; socks and http each replaced
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("calls = %v, want %v", got, want)
	}
	if strings.Contains(logs.String(), "falling back to restart") {
		t.Fatalf("the live path fell back to a restart:\n%s", logs.String())
	}
	for _, c := range *calls {
		switch c.args[1] {
		case "adu":
			// adu covers the user managers only: asking it about socks/http is
			// what used to come back short of "Added N" and restart the core.
			if !strings.Contains(c.file, `"in-vless"`) || strings.Contains(c.file, "in-socks") || strings.Contains(c.file, "in-http") {
				t.Errorf("adu payload must name the vless inbound only: %s", c.file)
			}
		case "adi":
			// The replacement carries both people: bob, who was there, and alice.
			if !strings.Contains(c.file, `"alice"`) || !strings.Contains(c.file, `"bob"`) {
				t.Errorf("adi payload lost an account: %s", c.file)
			}
		case "rmi":
			if tag := c.args[len(c.args)-1]; tag != "in-socks" && tag != "in-http" {
				t.Errorf("rmi of %q", tag)
			}
		}
	}
}

func TestTheFirstAccountArrivesByAdiAloneAndTheLastLeavesByRmiAlone(t *testing.T) {
	// No accounts, no inbound in the running core: nothing to rmi first.
	a, calls, _ := liveAdapter(t)
	if err := a.AddUser(core.User{UserID: alice.Email, XrayUUID: alice.ID, Username: alice.Login}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(verbs(*calls), " "); got != "adu adi adi" {
		t.Fatalf("first account: calls = %q, want adu adi adi", got)
	}

	*calls = nil
	if err := a.RemoveUser(alice.Email); err != nil {
		t.Fatal(err)
	}
	// And the last one leaves nothing behind to add back.
	if got := strings.Join(verbs(*calls), " "); got != "rmu rmi rmi" {
		t.Fatalf("last account: calls = %q, want rmu rmi rmi", got)
	}
}

func TestARenameReplacesTheAccountsAndLeavesVlessAlone(t *testing.T) {
	a, calls, _ := liveAdapter(t, alice)
	renamed := core.User{UserID: alice.Email, XrayUUID: alice.ID, Username: "alice-new"}
	if err := a.AddUser(renamed); err != nil {
		t.Fatal(err)
	}
	// adu of a user vless already has would fail as a duplicate and restart
	// the core; a rename touches only the logins.
	if got := strings.Join(verbs(*calls), " "); got != "rmi adi rmi adi" {
		t.Fatalf("calls = %q, want rmi adi rmi adi", got)
	}
}

// The test asked for on 23.09: two users on socks, each one's traffic lands in
// their own counter, alongside whatever they did over vless.
func TestSocksTrafficLandsInEachUsersOwnCounter(t *testing.T) {
	a, _, _ := liveAdapter(t, alice, bob)
	a.cfg.RunCmd = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if strings.Contains(strings.Join(args, " "), "-pattern user") {
			return []byte(`{"stat":[
				{"name":"user>>>u-alice>>>traffic>>>uplink","value":"100"},
				{"name":"user>>>alice>>>traffic>>>uplink","value":"10"},
				{"name":"user>>>alice>>>traffic>>>downlink","value":"20"},
				{"name":"user>>>bob>>>traffic>>>downlink","value":"7"}
			]}`), nil
		}
		return []byte(`{"stat":[]}`), nil
	}
	stats, err := a.GetStats()
	if err != nil {
		t.Fatal(err)
	}
	by := map[string]core.UserStats{}
	for _, u := range stats.Users {
		by[u.UserID] = u
	}
	if got := by["u-alice"]; got.BytesIn != 110 || got.BytesOut != 20 {
		t.Errorf("alice = in %d out %d, want 110 / 20 (vless plus socks)", got.BytesIn, got.BytesOut)
	}
	if got := by["u-bob"]; got.BytesIn != 0 || got.BytesOut != 7 {
		t.Errorf("bob = in %d out %d, want 0 / 7: nothing of alice's", got.BytesIn, got.BytesOut)
	}
}

const plainGoldenPath = "testdata/render-telegram-plain.json"

// TestTelegramEntriesRenderMatchesGolden pins the whole config with vless,
// socks and http side by side, byte for byte. Created on 2026-09-23 with the
// render that `xray run -test` accepted in the test below; a change to it is a
// change to every node carrying a Telegram entry and has to be seen in review.
// Regenerate per test only: UPDATE_GOLDEN=1 go test -run TestTelegramEntriesRenderMatchesGolden.
func TestTelegramEntriesRenderMatchesGolden(t *testing.T) {
	blob, err := renderMultiConfig(
		[]InboundConfig{vlessIn(), plainIn("socks", 1080), plainIn("http", 3128)},
		[]xrayClient{alice, bob, nameless}, nil, 8080, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile(plainGoldenPath, blob, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Skip("golden regenerated")
	}
	want, err := os.ReadFile(plainGoldenPath)
	if err != nil {
		t.Fatalf("read golden (regenerate with UPDATE_GOLDEN=1): %v", err)
	}
	if string(blob) != string(want) {
		t.Errorf("render differs from the golden\n--- want\n%s\n--- got\n%s", want, blob)
	}
}

// The core itself has the last word on the shape: `xray run -test` on a config
// carrying vless, socks and http side by side. Skipped without XRAY_BIN.
func TestTheCoreAcceptsSocksAndHTTPBesideVless(t *testing.T) {
	bin := os.Getenv("XRAY_BIN")
	if bin == "" {
		t.Skip("XRAY_BIN not set: the shape is not asked of the real core here")
	}
	blob, err := renderMultiConfig(
		[]InboundConfig{vlessIn(), plainIn("socks", 1080), plainIn("http", 3128)},
		[]xrayClient{alice, bob, nameless}, nil, 8080, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, blob, 0o600); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command(bin, "run", "-test", "-c", path).CombinedOutput()
	if err != nil {
		t.Fatalf("xray refused the config: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "Configuration OK") {
		t.Fatalf("xray did not say OK:\n%s", out)
	}
}
