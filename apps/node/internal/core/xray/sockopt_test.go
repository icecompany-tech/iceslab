package xray

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

/*
Bk-170: an xray inbound sets tcpUserTimeout, tcpKeepAliveIdle and
tcpKeepAliveInterval, on any transport. What is not set is not drawn: the core
then does what it does (Xray-core v26.3.27, transport/internet/system_listener.go:
keepalive off on an inbound). The live proof is in sockopt_live_test.go.
*/

const sockoptGoldenPath = "testdata/render-sockopt.json"

// The agent's answer to "do you carry these out". xray says yes, and no other
// adapter speaks of it: sing-box serves the protocol `xray` too and refuses the
// options, so the answer has to hang on the adapter and not on a protocol's name.
func TestOnlyTheXrayAdapterSaysItDrawsTheSocketOptions(t *testing.T) {
	var a core.CoreAdapter = New(Config{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	r, ok := a.(core.SockoptRenderer)
	if !ok || !r.RendersSockopt() {
		t.Fatal("the xray adapter does not say it draws the socket options")
	}
	var claimants []string
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if bytes.Contains(src, []byte(") RendersSockopt() bool")) {
			claimants = append(claimants, filepath.ToSlash(path))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(claimants) != 1 || claimants[0] != "../xray/adapter.go" {
		t.Fatalf("adapters that claim it: %v", claimants)
	}
}

func withSockopt(c InboundConfig) InboundConfig {
	c.TCPUserTimeout = 15000
	c.TCPKeepAliveIdle = 30
	c.TCPKeepAliveInterval = 10
	return c
}

func TestSockoptIsDrawnOnEveryTransport(t *testing.T) {
	for _, network := range []string{"raw", "ws", "xhttp", "httpupgrade", "grpc", "kcp"} {
		t.Run(network, func(t *testing.T) {
			cfg := withSockopt(validInbound())
			cfg.Network = network
			got, ok := vlessStream(t, renderToMap(t, cfg))["sockopt"].(map[string]any)
			if !ok {
				t.Fatalf("streamSettings.sockopt is missing on %s", network)
			}
			want := map[string]float64{"tcpUserTimeout": 15000, "tcpKeepAliveIdle": 30, "tcpKeepAliveInterval": 10}
			if len(got) != len(want) {
				t.Fatalf("sockopt = %v, want exactly %v", got, want)
			}
			for k, v := range want {
				if got[k] != v {
					t.Errorf("%s = %v, want %v", k, got[k], v)
				}
			}
		})
	}
}

func TestOnlyTheSetValueIsDrawn(t *testing.T) {
	cases := []struct {
		name string
		set  func(*InboundConfig)
		key  string
	}{
		{"user timeout", func(c *InboundConfig) { c.TCPUserTimeout = 15000 }, "tcpUserTimeout"},
		{"keepalive idle", func(c *InboundConfig) { c.TCPKeepAliveIdle = 30 }, "tcpKeepAliveIdle"},
		{"keepalive interval", func(c *InboundConfig) { c.TCPKeepAliveInterval = 10 }, "tcpKeepAliveInterval"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validInbound()
			tc.set(&cfg)
			got, ok := vlessStream(t, renderToMap(t, cfg))["sockopt"].(map[string]any)
			if !ok || len(got) != 1 || got[tc.key] == nil {
				t.Fatalf("sockopt = %v, want only %s", got, tc.key)
			}
		})
	}
}

func TestEmptyIsNotDrawn(t *testing.T) {
	if s, ok := vlessStream(t, renderToMap(t, validInbound()))["sockopt"]; ok {
		t.Fatalf("a profile without the values drew sockopt: %v", s)
	}
	// A negative keepalive means "off" to xray; the panel does not offer it and
	// the agent does not pass it on.
	cfg := validInbound()
	cfg.TCPKeepAliveIdle, cfg.TCPKeepAliveInterval, cfg.TCPUserTimeout = -1, -1, -1
	if s, ok := vlessStream(t, renderToMap(t, cfg))["sockopt"]; ok {
		t.Fatalf("a negative value drew sockopt: %v", s)
	}
}

func sockoptWire(extra string) []byte {
	return []byte(`{"inboundId":"dddddddd-4444-4000-8000-000000000004","subprotocol":"socks","security":"none","network":"raw"` + extra + `}`)
}

func sockoptAdapter(t *testing.T) *Adapter {
	t.Helper()
	dir := t.TempDir()
	a := New(Config{
		ConfigPath: filepath.Join(dir, "config.json"),
		Inbound:    InboundConfig{ApiPort: 18080, ListenHost: "127.0.0.1"},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(func() { _ = a.Stop(context.Background()) })
	if err := a.AddUser(core.User{UserID: "u-alice", Username: "alice", XrayUUID: alice.ID}); err != nil {
		t.Fatal(err)
	}
	return a
}

func storedInbound(t *testing.T, a *Adapter) InboundConfig {
	t.Helper()
	a.mu.Lock()
	defer a.mu.Unlock()
	cur, ok := a.inbounds["dddddddd-4444-4000-8000-000000000004"]
	if !ok {
		t.Fatalf("the inbound is not stored: %v", a.inbounds)
	}
	return cur
}

// The fields travel the wire under the names transport.ts gives them, and a
// changed value is a change: inboundEqual has to see it for the core to take it.
func TestTheWireCarriesTheValuesAndAChangeIsAChange(t *testing.T) {
	a := sockoptAdapter(t)
	if err := a.ApplyInbound(1080, sockoptWire(`,"tcpUserTimeout":15000,"tcpKeepAliveIdle":30,"tcpKeepAliveInterval":10`)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	first := storedInbound(t, a)
	if first.TCPUserTimeout != 15000 || first.TCPKeepAliveIdle != 30 || first.TCPKeepAliveInterval != 10 {
		t.Fatalf("stored = %d %d %d", first.TCPUserTimeout, first.TCPKeepAliveIdle, first.TCPKeepAliveInterval)
	}
	if err := a.ApplyInbound(1080, sockoptWire(`,"tcpUserTimeout":20000,"tcpKeepAliveIdle":30,"tcpKeepAliveInterval":10`)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	second := storedInbound(t, a)
	if second.TCPUserTimeout != 20000 {
		t.Fatalf("TCPUserTimeout = %d after the second push, want 20000", second.TCPUserTimeout)
	}
	if inboundEqual(first, second) {
		t.Fatal("inboundEqual takes a changed tcpUserTimeout for no change")
	}
}

// An override may carry null (the panel's way of clearing a value): a Go decoder
// leaves the field at 0, which is not drawn.
func TestAbsentAndNullLeaveNothingToDraw(t *testing.T) {
	for name, extra := range map[string]string{
		"absent": ``,
		"null":   `,"tcpUserTimeout":null,"tcpKeepAliveIdle":null,"tcpKeepAliveInterval":null`,
	} {
		t.Run(name, func(t *testing.T) {
			a := sockoptAdapter(t)
			if err := a.ApplyInbound(1080, sockoptWire(extra)); err != nil {
				t.Fatalf("ApplyInbound: %v", err)
			}
			if s := buildInboundSockopt(storedInbound(t, a)); s != nil {
				t.Fatalf("drew %v", s)
			}
		})
	}
}

// With the fields empty a push is what it was before them: the same bytes on
// disk, and the adapter takes it for no change, so the core is not restarted.
// Absent and null alike, since a panel may send either.
func TestEmptyFieldsChangeNothingAndRestartNothing(t *testing.T) {
	var log bytes.Buffer
	a := New(Config{
		ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		BinaryPath: os.Getenv("XRAY_BIN"),
		Inbound:    InboundConfig{ApiPort: freePort(t), ListenHost: "127.0.0.1"},
	}, slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { _ = a.Stop(context.Background()) })
	if err := a.AddUser(core.User{UserID: "u-alice", Username: "alice", XrayUUID: alice.ID}); err != nil {
		t.Fatal(err)
	}
	port := freePort(t)
	if err := a.ApplyInbound(port, sockoptWire(``)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	before, err := os.ReadFile(a.cfg.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(before, []byte(`"tcpUserTimeout"`)) || bytes.Contains(before, []byte(`"tcpKeepAlive`)) {
		t.Fatalf("the config carries socket options with nothing set:\n%s", before)
	}
	a.mu.Lock()
	proc := a.proc
	a.mu.Unlock()
	for _, extra := range []string{``, `,"tcpUserTimeout":null,"tcpKeepAliveIdle":null,"tcpKeepAliveInterval":null`} {
		log.Reset()
		if err := a.ApplyInbound(port, sockoptWire(extra)); err != nil {
			t.Fatalf("ApplyInbound %q: %v", extra, err)
		}
		if !strings.Contains(log.String(), "config unchanged, skipping restart") {
			t.Errorf("push %q was not taken for no change:\n%s", extra, log.String())
		}
		after, err := os.ReadFile(a.cfg.ConfigPath)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(before, after) {
			t.Errorf("push %q changed the config", extra)
		}
		a.mu.Lock()
		same := a.proc == proc
		a.mu.Unlock()
		if !same {
			t.Errorf("push %q restarted the core", extra)
		}
	}
}

// TestSockoptRenderMatchesGolden pins the whole config of a REALITY inbound with
// all three values, byte for byte. Created on 2026-11-07 with the render that
// `xray run -test` accepted below. Regenerate per test only:
// UPDATE_GOLDEN=1 go test -run TestSockoptRenderMatchesGolden.
func TestSockoptRenderMatchesGolden(t *testing.T) {
	blob, err := renderMultiConfig([]InboundConfig{withSockopt(vlessIn())}, []xrayClient{alice}, nil, 8080, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile(sockoptGoldenPath, blob, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Skip("golden regenerated")
	}
	want, err := os.ReadFile(sockoptGoldenPath)
	if err != nil {
		t.Fatalf("read golden (regenerate with UPDATE_GOLDEN=1): %v", err)
	}
	if string(blob) != string(want) {
		t.Errorf("render differs from the golden\n--- want\n%s\n--- got\n%s", want, blob)
	}
}

// The core has the last word on the shape, on every transport. Skipped without
// XRAY_BIN.
func TestTheCoreAcceptsSockoptOnEveryTransport(t *testing.T) {
	bin := os.Getenv("XRAY_BIN")
	if bin == "" {
		t.Skip("XRAY_BIN not set: the shape is not asked of the real core here")
	}
	inbounds := map[string]InboundConfig{"reality over raw": withSockopt(vlessIn())}
	// Not kcp: xray 26.3.27 refuses the mKCP block this agent draws with or
	// without sockopt ("mkcp header & seed has been removed"), and the options
	// are TCP ones, which xray does not apply to kcp's UDP socket anyway.
	for _, network := range []string{"raw", "ws", "xhttp", "httpupgrade", "grpc"} {
		c := withSockopt(vlessIn())
		c.Security, c.Network, c.ServiceName = "none", network, "svc"
		inbounds["none over "+network] = c
	}
	for name, in := range inbounds {
		t.Run(name, func(t *testing.T) {
			blob, err := renderMultiConfig([]InboundConfig{in}, []xrayClient{alice}, nil, 8080, nil, nil)
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
		})
	}
}
