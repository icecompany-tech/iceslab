package chain

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// A config that is never actually run: every test here stops at the door,
// because starting sing-box needs a binary and a network, and what this package
// owes is the DECISIONS around the process, not the process.
const goldenConfig = `{
  "log": { "level": "warn" },
  "inbounds": [
    {
      "type": "socks",
      "tag": "in-d1",
      "listen": "127.0.0.1",
      "listen_port": 26001,
      "users": [ { "username": "chain", "password": "chain-socks-fixture-password-0000" } ]
    }
  ],
  "outbounds": [ { "type": "direct", "tag": "direct" } ],
  "route": { "rules": [ { "action": "sniff" } ] }
}`

func quiet() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func block(cfg string) *dto.NodeChain {
	return &dto.NodeChain{
		Engine:        Engine,
		Config:        json.RawMessage(cfg),
		Socks:         []dto.ChainSocks{{Tag: 0, Port: 26000}, {Tag: 1, Port: 26001}},
		SocksPassword: "chain-socks-fixture-password-0000",
	}
}

// manager with a binary that "exists" and a check we drive from the test. The
// process is never spawned: `Start` on a path that is not executable fails, and
// every test below asserts on what happened BEFORE that point, or uses a
// manager whose apply is expected to fail at start.
func newTestManager(t *testing.T, check func() ([]byte, error)) (*Manager, string) {
	t.Helper()
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "chain", "config.json")
	m := New(Config{
		BinaryPath: filepath.Join(dir, "sing-box"),
		ConfigPath: cfgPath,
		Logger:     quiet(),
		Run: func(_ context.Context, _ string, args ...string) ([]byte, error) {
			if len(args) > 0 && args[0] == "version" {
				return []byte("sing-box version 1.13.14\n"), nil
			}
			return check()
		},
	})
	return m, cfgPath
}

func TestConfigOnDiskIsWhatWasPushed(t *testing.T) {
	// The golden of this package: bytes in, the same bytes on disk, 0600.
	// Verbatim matters. The panel renders the config and the tests there ask
	// sing-box whether it loads; if the agent reformatted or re-marshalled it,
	// what the engine was asked about and what it runs would be two documents.
	m, cfgPath := newTestManager(t, func() ([]byte, error) { return nil, nil })
	_ = m.Apply(context.Background(), block(goldenConfig))

	got, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("no config on disk: %v", err)
	}
	if string(got) != goldenConfig {
		t.Fatalf("the config on disk is not the one that was pushed:\nwant %s\ngot  %s",
			goldenConfig, got)
	}
	info, err := os.Stat(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	// It carries the socks password and the credentials of every leg out of
	// this node. Group-readable would hand them to anyone with a shell.
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("the chain config is %v, want 0600: it holds the socks password and every leg's credentials", perm)
	}
}

func TestARefusedConfigLeavesTheOldOneAlone(t *testing.T) {
	// The reason the check comes before the write. A config written first is a
	// config the process can be restarted onto, and then the node is dark for a
	// typo the panel could have refused in one sentence.
	m, cfgPath := newTestManager(t, func() ([]byte, error) { return nil, nil })
	_ = m.Apply(context.Background(), block(goldenConfig))
	first, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatal(err)
	}

	refuse := func() ([]byte, error) {
		return []byte("FATAL[0000] decode config at config.json: unknown field outbound"), errors.New("exit status 1")
	}
	m.cfg.Run = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if len(args) > 0 && args[0] == "version" {
			return []byte("sing-box version 1.13.14\n"), nil
		}
		return refuse()
	}

	err = m.Apply(context.Background(), block(`{"outbound": "nonsense"}`))
	if err == nil {
		t.Fatal("a config the engine refused was accepted")
	}
	// The engine's own words travel: they name the offending field, and that
	// sentence is the whole value of the refusal to the operator reading it in
	// the panel.
	if !strings.Contains(err.Error(), "unknown field outbound") {
		t.Fatalf("the engine's own words did not survive: %v", err)
	}

	after, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(first) {
		t.Fatal("a refused config replaced the one on disk")
	}

	// And the node says it is holding a chain that is not running, rather than
	// saying nothing: the panel asked for one here.
	st := m.Status()
	if st == nil {
		t.Fatal("a node with a refused chain reports no chain at all")
	}
	if st.Running || st.Error == "" {
		t.Fatalf("status does not describe the failure: %+v", st)
	}
}

func TestNoBlockStopsTheChainAndReleasesItsPorts(t *testing.T) {
	// Withdrawing the block is a NORMAL event, not a fault: it is how a
	// rollback to a panel that does not send the chain puts the node back on
	// drawing the cascade inside its core, with nobody logging in to the box.
	m, _ := newTestManager(t, func() ([]byte, error) { return nil, nil })
	_ = m.Apply(context.Background(), block(goldenConfig))
	if len(m.ReservedPorts()) != 2 {
		t.Fatalf("the two socks ports were not held: %+v", m.ReservedPorts())
	}
	if !m.Active() {
		t.Fatal("a chain was applied and the node does not consider it in force")
	}

	if err := m.Apply(context.Background(), nil); err != nil {
		t.Fatalf("withdrawing the chain failed: %v", err)
	}
	if got := m.ReservedPorts(); len(got) != 0 {
		t.Fatalf("the ports are still held after the chain was withdrawn: %+v", got)
	}
	if m.Active() {
		t.Fatal("the chain is still in force after it was withdrawn, so the cascade fragments stay ignored")
	}
	if m.Status() != nil {
		t.Fatal("a node with no chain must report nothing, not a chain that is down: reading absence as failure would turn the fleet red")
	}
}

func TestPortsAreReportedUnderOneKey(t *testing.T) {
	m, _ := newTestManager(t, func() ([]byte, error) { return nil, nil })
	_ = m.Apply(context.Background(), block(goldenConfig))
	for _, p := range m.ReservedPorts() {
		if p.Owner != PortOwner {
			t.Fatalf("port %d is reported as %q, want %q", p.Port, p.Owner, PortOwner)
		}
		// Socks is TCP, and it is SENT rather than left for the panel to
		// assume: the panel compares it with a binding's transport, and 443/TCP
		// and 443/UDP are different sockets.
		if p.Transport != "tcp" {
			t.Fatalf("port %d is reported as %q, want tcp", p.Port, p.Transport)
		}
	}
	// The ports come from the WIRE, not from a second copy of the tag formula
	// on this side: two copies are two things to keep in step by hand.
	want := map[int]bool{26000: true, 26001: true}
	for _, p := range m.ReservedPorts() {
		delete(want, p.Port)
	}
	if len(want) != 0 {
		t.Fatalf("these pushed ports were not reported: %v", want)
	}
}

// The tproxy listener of an AmneziaWG entry: 25000 on TCP and UDP, measured
// on se-02 (sing-box binds both), taken from the hand-off on the wire, and let
// go with the chain.
func TestTheTProxyListenerIsHeldOnBothTransports(t *testing.T) {
	m, _ := newTestManager(t, func() ([]byte, error) { return nil, nil })
	b := block(goldenConfig)
	b.UserCore = &dto.ChainUserCore{Engine: "amneziawg", TProxy3: &dto.ChainUserCoreTProxy{Port: 25000, Mark: 65536 + 51830}}
	_ = m.Apply(context.Background(), b)

	got := map[string]bool{}
	for _, p := range m.ReservedPorts() {
		if p.Owner == PortOwnerTProxy {
			got[p.Transport] = p.Port == 25000
		}
	}
	if !got["tcp"] || !got["udp"] || len(got) != 2 {
		t.Fatalf("tproxy ports held: %+v", m.ReservedPorts())
	}
	// Still two socks ports beside it, under their own key.
	if n := len(m.ReservedPorts()); n != 4 {
		t.Fatalf("held %d ports, want 2 socks + 2 tproxy: %+v", n, m.ReservedPorts())
	}

	// A block with no awg hand-off holds no tproxy port.
	_ = m.Apply(context.Background(), block(goldenConfig))
	for _, p := range m.ReservedPorts() {
		if p.Owner == PortOwnerTProxy {
			t.Fatalf("the tproxy port outlived the hand-off: %+v", m.ReservedPorts())
		}
	}
	_ = m.Apply(context.Background(), b)
	_ = m.Apply(context.Background(), nil)
	if len(m.ReservedPorts()) != 0 {
		t.Fatalf("ports held after the chain was withdrawn: %+v", m.ReservedPorts())
	}
}

func TestAnEngineItDoesNotKnowIsRefused(t *testing.T) {
	// Refused rather than attempted: the config is the engine's own JSON, so
	// guessing means handing sing-box syntax to something that is not sing-box
	// and then reading the crash as ours.
	m, cfgPath := newTestManager(t, func() ([]byte, error) { return nil, nil })
	b := block(goldenConfig)
	b.Engine = "xray"
	err := m.Apply(context.Background(), b)
	if err == nil {
		t.Fatal("a chain block naming an unknown engine was accepted")
	}
	if !strings.Contains(err.Error(), "xray") {
		t.Fatalf("the refusal does not name the engine it was given: %v", err)
	}
	if _, statErr := os.Stat(cfgPath); statErr == nil {
		t.Fatal("a block for an engine we cannot run still wrote a config")
	}
}

func TestTheIgnoreLineIsWrittenOncePerProcess(t *testing.T) {
	// It is the first line somebody looks for when a chain misbehaves, and a
	// line repeated on every push is a line nobody can find.
	var sb strings.Builder
	m := New(Config{
		BinaryPath: "sing-box",
		ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		Logger:     slog.New(slog.NewTextHandler(&sb, nil)),
	})
	m.NoteCascadeIgnored()
	m.NoteCascadeIgnored()
	m.NoteCascadeIgnored()
	if n := strings.Count(sb.String(), "chain block present, xray cascade fragments ignored"); n != 1 {
		t.Fatalf("the line was written %d times, want exactly 1", n)
	}
}
