package shadowsocks

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

// TestN1_AddUser_LivePathCallsAdu verifies N1-SS: when xray (which hosts the SS
// inbound) is RUNNING, AddUser adds the user live via `xray api adu` and does
// NOT restart. Injects a live stand-in process (/bin/sleep) so liveUpdateUser
// takes the live branch, and a mock RunCmd to capture the CLI call.
func TestN1_AddUser_LivePathCallsAdu(t *testing.T) {
	dir := t.TempDir()
	var calls [][]string
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{
		BinaryPath: "/usr/bin/xray",
		ConfigPath: filepath.Join(dir, "config.json"),
		Inbound: InboundConfig{
			Method:     "2022-blake3-aes-256-gcm",
			ServerPSK:  "BASE64-FAKE-SERVER-PSK==",
			ListenPort: 8388,
			ApiPort:    8081,
		},
		RunCmd: func(_ context.Context, name string, args ...string) ([]byte, error) {
			calls = append(calls, append([]string{name}, args...))
			return []byte("Added 1 user(s) in total. Removed 1 user(s) in total."), nil
		},
	}, logger)

	// Stand-in running process so proc.Running() is true and the adapter has
	// already started.
	a.proc = subprocess.New(subprocess.Config{
		Name: "ss-stub", Binary: "/bin/sleep", Args: []string{"30"}, Logger: logger,
	})
	if err := a.proc.Start(context.Background()); err != nil {
		t.Fatalf("start stub: %v", err)
	}
	defer func() { _ = a.proc.Stop(context.Background()) }()
	a.started = true

	if err := a.AddUser(core.User{UserID: "alice", XrayUUID: "uuid-a"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	foundAdu := false
	for _, c := range calls {
		joined := strings.Join(c, " ")
		if strings.Contains(joined, "api adu") {
			foundAdu = true
		}
		if strings.Contains(joined, "run -c") {
			t.Errorf("live path should NOT restart xray, but saw: %v", c)
		}
	}
	if !foundAdu {
		t.Errorf("expected `api adu` (live add), got calls: %v", calls)
	}
}

// TestN1_RemoveUser_LivePathCallsRmu mirrors the above for live removal.
func TestN1_RemoveUser_LivePathCallsRmu(t *testing.T) {
	dir := t.TempDir()
	var calls [][]string
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{
		BinaryPath: "/usr/bin/xray",
		ConfigPath: filepath.Join(dir, "config.json"),
		Inbound: InboundConfig{
			Method:     "2022-blake3-aes-256-gcm",
			ServerPSK:  "BASE64-FAKE-SERVER-PSK==",
			ListenPort: 8388,
			ApiPort:    8081,
		},
		RunCmd: func(_ context.Context, name string, args ...string) ([]byte, error) {
			calls = append(calls, append([]string{name}, args...))
			return []byte("Added 1 user(s) in total. Removed 1 user(s) in total."), nil
		},
	}, logger)
	// Pre-seed a tracked user (directly; AddUser would also work but we don't
	// want its adu call polluting `calls`).
	a.users["alice"] = ssClient{Password: "uuid-a", Email: "alice"}

	a.proc = subprocess.New(subprocess.Config{
		Name: "ss-stub", Binary: "/bin/sleep", Args: []string{"30"}, Logger: logger,
	})
	if err := a.proc.Start(context.Background()); err != nil {
		t.Fatalf("start stub: %v", err)
	}
	defer func() { _ = a.proc.Stop(context.Background()) }()
	a.started = true

	if err := a.RemoveUser("alice"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}

	foundRmu := false
	for _, c := range calls {
		joined := strings.Join(c, " ")
		if strings.Contains(joined, "api rmu") && strings.Contains(joined, "alice") {
			foundRmu = true
		}
	}
	if !foundRmu {
		t.Errorf("expected `api rmu ... alice` (live remove), got calls: %v", calls)
	}
}

// TestN1_BuildAduInbound verifies the `xray api adu` input JSON for a
// Shadowsocks inbound: tag + protocol=shadowsocks + settings carrying the
// method, server PSK, the one client (password+email), and network. A wrong
// shape would make every live add silently fall back to a restart.
func TestN1_BuildAduInbound(t *testing.T) {
	data, err := buildAduInbound(
		InboundConfig{Method: "2022-blake3-aes-256-gcm", ServerPSK: "server-psk", Tag: "ss-in"},
		ssClient{Password: "user-pw", Email: "alice"},
	)
	if err != nil {
		t.Fatalf("buildAduInbound: %v", err)
	}
	// adu input must be a full config with a top-level "inbounds" array.
	var doc struct {
		Inbounds []struct {
			Tag      string `json:"tag"`
			Protocol string `json:"protocol"`
			Settings struct {
				Method   string `json:"method"`
				Password string `json:"password"`
				Network  string `json:"network"`
				Clients  []struct {
					Password string `json:"password"`
					Email    string `json:"email"`
				} `json:"clients"`
			} `json:"settings"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, data)
	}
	if len(doc.Inbounds) != 1 {
		t.Fatalf("inbounds: got %d want 1\n%s", len(doc.Inbounds), data)
	}
	ib := doc.Inbounds[0]
	if ib.Tag != "ss-in" || ib.Protocol != "shadowsocks" {
		t.Errorf("tag/proto: got %q / %q", ib.Tag, ib.Protocol)
	}
	if ib.Settings.Method != "2022-blake3-aes-256-gcm" || ib.Settings.Password != "server-psk" {
		t.Errorf("method/serverPSK: got %q / %q", ib.Settings.Method, ib.Settings.Password)
	}
	wantPw := core.DeriveSsPassword("user-pw", "2022-blake3-aes-256-gcm")
	if len(ib.Settings.Clients) != 1 ||
		ib.Settings.Clients[0].Password != wantPw ||
		ib.Settings.Clients[0].Email != "alice" {
		t.Errorf("client: got %+v (want password %q)", ib.Settings.Clients, wantPw)
	}
}

// TestLiveOpSucceeded guards the adu/rmu success check: xray exits 0 even when
// it adds/removes nobody, so success is read from the "<verb> N user(s)" count.
func TestLiveOpSucceeded(t *testing.T) {
	cases := []struct {
		out  string
		verb string
		want bool
	}{
		{"Added 1 user(s) in total.", "Added", true},
		{"Added 0 user(s) in total.", "Added", false},
		{"Removed 1 user(s) in total.", "Removed", true},
		{"Removed 0 user(s) in total.", "Removed", false},
		{"garbage", "Added", false},
	}
	for _, c := range cases {
		if got := liveOpSucceeded([]byte(c.out), c.verb); got != c.want {
			t.Errorf("liveOpSucceeded(%q, %q) = %v, want %v", c.out, c.verb, got, c.want)
		}
	}
}

func newConfigOnlyAdapter(t *testing.T) *Adapter {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(Config{
		Inbound: InboundConfig{
			Method:     "2022-blake3-aes-256-gcm",
			ServerPSK:  "BASE64-FAKE-SERVER-PSK==",
			ListenPort: 8388,
			ApiPort:    8081,
		},
		// no BinaryPath, no ConfigPath → config-only mode
	}, logger)
}

func TestNameMatchesProtocol(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if a.Name() != Name {
		t.Errorf("Name: got %q want %q", a.Name(), Name)
	}
}

func TestAddUserStoresClient(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.AddUser(core.User{UserID: "u-1", XrayUUID: "uuid-1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 1 {
		t.Errorf("expected 1 user tracked, got %d", len(stats.Users))
	}
}

func TestAddUserSkipsWhenNoXrayUUID(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.AddUser(core.User{UserID: "u-1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 0 {
		t.Errorf("user without XrayUUID should not be tracked, got %d", len(stats.Users))
	}
}

func TestAddUserIsIdempotent(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	user := core.User{UserID: "u-1", XrayUUID: "uuid-1"}
	_ = a.AddUser(user)
	_ = a.AddUser(user)
	_ = a.AddUser(user)
	stats, _ := a.GetStats()
	if len(stats.Users) != 1 {
		t.Errorf("expected 1 user after 3x AddUser, got %d", len(stats.Users))
	}
}

func TestRemoveUser(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	_ = a.AddUser(core.User{UserID: "u-1", XrayUUID: "uuid-1"})
	if err := a.RemoveUser("u-1"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	stats, _ := a.GetStats()
	if len(stats.Users) != 0 {
		t.Errorf("user should be cleared after RemoveUser, got %d", len(stats.Users))
	}
}

// ───── ApplyInbound ─────

func TestApplyInbound_NoOpOnIdenticalConfig(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{
		"method":    "2022-blake3-aes-256-gcm",
		"serverPsk": "BASE64-FAKE-SERVER-PSK==",
	})
	// Wave-14 C1: port now participates in idempotency check; pass the
	// install-time port (8388 from newConfigOnlyAdapter) so the apply is
	// truly a no-op vs current state.
	if err := a.ApplyInbound(8388, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.started {
		t.Errorf("config-only adapter should not have started on no-op apply")
	}
}

func TestApplyInbound_MethodChangeRegenerates(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{
		"method":    "chacha20-ietf-poly1305",
		"serverPsk": "BASE64-FAKE-SERVER-PSK==",
	})
	if err := a.ApplyInbound(443, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.cfg.Inbound.Method != "chacha20-ietf-poly1305" {
		t.Errorf("method not updated, got %q", a.cfg.Inbound.Method)
	}
	if !a.started {
		t.Errorf("started should be true after regenerate")
	}
}

// Wave-14 C1 regression: panel-pushed port change triggers regenerate +
// updates InboundConfig.ListenPort so the next render emits the new port.
func TestApplyInbound_PortChangeRegenerates(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{
		"method":    "2022-blake3-aes-256-gcm",
		"serverPsk": "BASE64-FAKE-SERVER-PSK==",
	})
	// Same method/psk as install-time but different port → not a no-op.
	if err := a.ApplyInbound(9999, body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.cfg.Inbound.ListenPort != 9999 {
		t.Errorf("port not updated, got %d want 9999", a.cfg.Inbound.ListenPort)
	}
	if !a.started {
		t.Errorf("started should be true after port-driven regenerate")
	}
}

func TestApplyInbound_RejectsMissingServerPsk(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{"method": "2022-blake3-aes-256-gcm"})
	if err := a.ApplyInbound(443, body); err == nil ||
		!strings.Contains(err.Error(), "serverPsk is required") {
		t.Errorf("expected serverPsk-required error, got %v", err)
	}
}

func TestApplyInbound_RejectsMissingMethod(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{})
	if err := a.ApplyInbound(443, body); err == nil || !strings.Contains(err.Error(), "method is required") {
		t.Errorf("expected method-required error, got %v", err)
	}
}

func TestApplyInbound_RejectsMalformedJSON(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.ApplyInbound(443, []byte("{not json")); err == nil {
		t.Errorf("expected parse error")
	}
}

// ───── Stats query ─────

func TestParseStatName_AcceptsUserTraffic(t *testing.T) {
	uid, dir, ok := parseStatName("user>>>u-1>>>traffic>>>uplink")
	if !ok || uid != "u-1" || dir != "uplink" {
		t.Errorf("got (%q,%q,%v)", uid, dir, ok)
	}
}

func TestParseStatName_RejectsOtherShapes(t *testing.T) {
	for _, in := range []string{
		"inbound>>>x>>>traffic>>>uplink",
		"user>>>u-1>>>other>>>uplink",
		"user>>>u-1>>>traffic",
	} {
		if _, _, ok := parseStatName(in); ok {
			t.Errorf("should reject %q", in)
		}
	}
}

func TestQueryUserStats_AggregatesCounters(t *testing.T) {
	mockOutput := []byte(`{"stat":[
		{"name":"user>>>alice>>>traffic>>>uplink","value":"1000"},
		{"name":"user>>>alice>>>traffic>>>downlink","value":"2000"},
		{"name":"user>>>bob>>>traffic>>>uplink","value":"500"}
	]}`)
	run := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return mockOutput, nil
	}
	got, err := queryUserStats(context.Background(), run, "/usr/local/bin/xray", 8081)
	if err != nil {
		t.Fatalf("queryUserStats: %v", err)
	}
	if got["alice"].UplinkBytes != 1000 || got["alice"].DownlinkBytes != 2000 {
		t.Errorf("alice: %+v", got["alice"])
	}
	if got["bob"].UplinkBytes != 500 {
		t.Errorf("bob: %+v", got["bob"])
	}
}

func TestQueryUserStats_ErrorPropagates(t *testing.T) {
	run := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return []byte("connection refused"), errors.New("exit status 1")
	}
	if _, err := queryUserStats(context.Background(), run, "xray", 8081); err == nil {
		t.Errorf("expected error from failing run")
	}
}

func TestGetStats_SoftFailsToZeroCounters(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	failingRun := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return nil, errors.New("xray not running")
	}
	a := New(Config{
		BinaryPath: "/usr/local/bin/xray",
		Inbound:    InboundConfig{Method: "2022-blake3-aes-256-gcm", ApiPort: 8081},
		RunCmd:     failingRun,
	}, logger)
	_ = a.AddUser(core.User{UserID: "u-1", XrayUUID: "uuid-1"})

	stats, err := a.GetStats()
	if err != nil {
		t.Fatalf("GetStats should soft-fail, got error: %v", err)
	}
	if len(stats.Users) != 1 {
		t.Errorf("user list should still be reported, got %d", len(stats.Users))
	}
	if stats.Users[0].BytesIn != 0 || stats.Users[0].BytesOut != 0 {
		t.Errorf("counters should be zero on stats fail, got %+v", stats.Users[0])
	}
}
