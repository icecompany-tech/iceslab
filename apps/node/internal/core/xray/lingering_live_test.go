package xray

import (
	"context"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

/*
A-218, live, with the real core: a user taken off a running xray keeps the
connection they had open (rmu does not cut it, P6 keeps the core running),
and GetStats names them as lingering, by the email xray knows them by, until
that connection closes. Proven only by a live connection (CLAUDE.local).
Skipped without XRAY_BIN.
*/
func TestLiveARemovedUsersOpenConnectionIsLingeringUntilItCloses(t *testing.T) {
	bin := os.Getenv("XRAY_BIN")
	if bin == "" {
		t.Skip("XRAY_BIN not set: the core is not asked here")
	}
	socksPort, api := freePort(t), freePort(t)
	dir := t.TempDir()
	a := New(Config{
		ConfigPath: filepath.Join(dir, "config.json"),
		BinaryPath: bin,
		Inbound:    InboundConfig{ApiPort: api, ListenHost: "127.0.0.1"},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(func() { _ = a.Stop(context.Background()) })
	const aliceUUID = "5f0c9a3e-2b7d-4e51-9c8a-1d2e3f4a5b6c"
	const bobUUID = "6a1d0b4f-3c8e-4f62-8d9b-2e3f4a5b6c7d"
	// Bob stays, so the door keeps a user and the removal goes live.
	for _, u := range []core.User{
		{UserID: "u-alice", Username: "alice", XrayUUID: aliceUUID},
		{UserID: "u-bob", Username: "bob", XrayUUID: bobUUID},
	} {
		if err := a.AddUser(u); err != nil {
			t.Fatal(err)
		}
	}
	wire := []byte(`{"inboundId":"cccccccc-3333-4000-8000-000000000003","subprotocol":"socks","security":"none","network":"raw"}`)
	if err := a.ApplyInbound(socksPort, wire); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	echo, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer echo.Close()
	go func() {
		for {
			c, err := echo.Accept()
			if err != nil {
				return
			}
			go func() { _, _ = io.Copy(c, c); _ = c.Close() }()
		}
	}()

	// xray's online map leaves 127.0.0.1 out (app/stats/online_map.go), so
	// the client comes from another loopback address, as a real one would
	// from its own.
	from := &net.TCPAddr{IP: net.IPv4(127, 0, 0, 2)}
	var stream net.Conn
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
		if stream, err = socksDialFrom(from, socksPort, "alice", aliceUUID, echo.Addr().String()); err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("socks to the echo: %v", err)
	}
	defer stream.Close()
	roundTrip := func(msg string) error {
		_ = stream.SetDeadline(time.Now().Add(3 * time.Second))
		if _, err := stream.Write([]byte(msg)); err != nil {
			return err
		}
		buf := make([]byte, len(msg))
		_, err := io.ReadFull(stream, buf)
		return err
	}
	if err := roundTrip("before"); err != nil {
		t.Fatalf("stream before: %v", err)
	}

	lingering := func() []core.LingeringUser {
		t.Helper()
		st, err := a.GetStats()
		if err != nil || st.NoData {
			t.Fatalf("GetStats: %v %+v", err, st)
		}
		if st.Lingering == nil {
			t.Fatal("lingering not known: the online query did not answer")
		}
		return st.Lingering
	}
	if got := lingering(); len(got) != 0 {
		t.Fatalf("alice is still held, nobody lingers: %+v", got)
	}

	a.mu.Lock()
	proc := a.proc
	a.mu.Unlock()
	if err := a.RemoveUser("u-alice"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	a.mu.Lock()
	same := a.proc == proc && proc.Running()
	a.mu.Unlock()
	if !same {
		t.Fatal("the removal restarted the core: the open stream proves nothing then")
	}
	if err := roundTrip("after"); err != nil {
		t.Fatalf("the removed user's open stream broke, the fact A-218 rests on is gone: %v", err)
	}
	// A new connection is refused: the removal itself worked.
	if c, err := socksDial(socksPort, "alice", aliceUUID, echo.Addr().String()); err == nil {
		_ = c.Close()
		t.Fatal("a removed user opened a new connection")
	}

	got := lingering()
	if len(got) != 1 || got[0].Email != "alice" || got[0].Sessions < 1 {
		t.Fatalf("want alice (the socks login xray knows her by) with an open session, got %+v", got)
	}

	_ = stream.Close()
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(200 * time.Millisecond) {
		if len(lingering()) == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("alice still lingering after her connection closed: %+v", lingering())
		}
	}
	if raw, _ := os.ReadFile(filepath.Join(dir, "config.json")); !strings.Contains(string(raw), `"statsUserOnline": true`) {
		t.Fatal("the config does not ask xray for the online map")
	}
}
