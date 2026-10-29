package xray

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

/*
A-134, 22.10: a change that touched the routing alone (a policy rule, a
cascade's entry rules) restarted the core, and every open connection on the
node dropped for it. It is now handed to the running core with
`xray api adrules` (replace, not append), after `xray -test` of the full
config, and only when everything but the routing is what the core runs.
*/

func TestARoutingOnlyChangeIsTold(t *testing.T) {
	base := `{"inbounds":[1],"outbounds":[2],"routing":{"domainStrategy":"IPIfNonMatch","rules":[{"inboundTag":["api-in"],"outboundTag":"api"}]}}`
	newRules := `{"inbounds":[1],"outbounds":[2],"routing":{"domainStrategy":"IPIfNonMatch","rules":[{"inboundTag":["api-in"],"outboundTag":"api"},{"port":"25","outboundTag":"blocked"}]}}`
	if r, ok := routingOnlyChange([]byte(base), []byte(newRules)); !ok || !keepsAPIRule(r) {
		t.Fatal("a rules-only change was not recognised")
	}
	inboundToo := strings.Replace(newRules, `"inbounds":[1]`, `"inbounds":[9]`, 1)
	if _, ok := routingOnlyChange([]byte(base), []byte(inboundToo)); ok {
		t.Fatal("a change outside routing was taken as routing-only")
	}
	strategy := strings.Replace(newRules, "IPIfNonMatch", "AsIs", 1)
	if _, ok := routingOnlyChange([]byte(base), []byte(strategy)); ok {
		t.Fatal("a domainStrategy change was taken live; adrules does not reload it")
	}
	if _, ok := routingOnlyChange([]byte(base), []byte(base)); ok {
		t.Fatal("no change was taken as a change")
	}
	noAPI := `{"rules":[{"port":"25","outboundTag":"blocked"}]}`
	if keepsAPIRule(json.RawMessage(noAPI)) {
		t.Fatal("a routing without the API rule passed")
	}
}

// With a fake core: a policy change on a running core goes through adrules
// and the process is not replaced.
func TestAPolicyChangeOnARunningCoreIsNotARestart(t *testing.T) {
	c := &fakeCore{}
	a, path := validatingAdapter(t, c)
	if err := a.ApplyInbound(443, inboundWire(t, "aaaaaaaa-1111-4000-8000-000000000001", 443)); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	before := a.proc
	a.mu.Unlock()

	rule := json.RawMessage(`{"rules":[{"match":{"port":"25"},"action":{"kind":"block"}}]}`)
	if err := a.ApplyPolicy(rule); err != nil {
		t.Fatalf("ApplyPolicy: %v", err)
	}
	a.mu.Lock()
	after := a.proc
	a.mu.Unlock()
	if after != before {
		t.Fatal("a routing-only change restarted the core")
	}
	sawAdrules := false
	for _, call := range c.calls {
		if len(call) > 1 && call[0] == "api" && call[1] == "adrules" {
			sawAdrules = true
		}
	}
	if !sawAdrules {
		t.Fatalf("adrules was not called: %v", c.calls)
	}
	blob, _ := os.ReadFile(path)
	if !strings.Contains(string(blob), `"port": "25"`) {
		t.Fatal("the new rule did not reach the file on disk")
	}
}

// Live, with the real core: a socks door, a long stream through it, then a
// policy rule that blocks another target. The stream keeps going, the user's
// counters keep counting from where they were (a restart would zero them),
// the process is the same, and the new rule acts on the next connection.
// Skipped without XRAY_BIN.
func TestLiveRoutingChangeKeepsOpenStreamsAndActs(t *testing.T) {
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
	const uuid = "5f0c9a3e-2b7d-4e51-9c8a-1d2e3f4a5b6c"
	if err := a.AddUser(core.User{UserID: "alice", Username: "alice", XrayUUID: uuid}); err != nil {
		t.Fatal(err)
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
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "reachable")
	}))
	defer target.Close()
	_, targetPort, _ := net.SplitHostPort(target.Listener.Addr().String())

	var stream net.Conn
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
		if stream, err = socksDial(socksPort, "alice", uuid, echo.Addr().String()); err == nil {
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
		if _, err := io.ReadFull(stream, buf); err != nil {
			return err
		}
		if string(buf) != msg {
			return fmt.Errorf("echo %q", buf)
		}
		return nil
	}
	if err := roundTrip(strings.Repeat("a", 4096)); err != nil {
		t.Fatalf("stream before: %v", err)
	}
	if body, err := socksHTTPGet(socksPort, "alice", uuid, target.Listener.Addr().String()); err != nil || body != "reachable" {
		t.Fatalf("target before the rule: %q %v", body, err)
	}
	before := userBytes(t, a, "alice")
	if before == 0 {
		t.Fatal("no counted traffic before the change: the counters prove nothing")
	}
	a.mu.Lock()
	proc := a.proc
	a.mu.Unlock()

	rule := json.RawMessage(`{"rules":[{"match":{"port":"` + targetPort + `"},"action":{"kind":"block"}}]}`)
	if err := a.ApplyPolicy(rule); err != nil {
		t.Fatalf("ApplyPolicy: %v", err)
	}

	a.mu.Lock()
	same := a.proc == proc && proc.Running()
	a.mu.Unlock()
	if !same {
		t.Fatal("the routing change restarted the core")
	}
	if err := roundTrip(strings.Repeat("b", 4096)); err != nil {
		t.Fatalf("the open stream broke on a routing change: %v", err)
	}
	if body, err := socksHTTPGet(socksPort, "alice", uuid, target.Listener.Addr().String()); err == nil && body == "reachable" {
		t.Fatal("the new block rule does not act on a new connection")
	}
	if after := userBytes(t, a, "alice"); after <= before {
		t.Fatalf("counters went from %d to %d: reset or not counting", before, after)
	}
}

func userBytes(t *testing.T, a *Adapter, id string) int64 {
	t.Helper()
	st, err := a.GetStats()
	if err != nil || st.NoData {
		t.Fatalf("GetStats: %v %+v", err, st)
	}
	for _, u := range st.Users {
		if u.UserID == id {
			return u.BytesIn + u.BytesOut
		}
	}
	return 0
}

// socksDial opens a SOCKS5 CONNECT with username/password auth (RFC 1929).
func socksDial(port int, user, pass, target string) (net.Conn, error) {
	return socksDialFrom(nil, port, user, pass, target)
}

// socksDialFrom is socksDial from a given local address: xray's online map
// leaves 127.0.0.1 out (A-218), so a test that reads it comes from another.
func socksDialFrom(local net.Addr, port int, user, pass, target string) (net.Conn, error) {
	d := net.Dialer{Timeout: time.Second, LocalAddr: local}
	c, err := d.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return nil, err
	}
	fail := func(e error) (net.Conn, error) { _ = c.Close(); return nil, e }
	_ = c.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := c.Write([]byte{5, 1, 2}); err != nil {
		return fail(err)
	}
	g := make([]byte, 2)
	if _, err := io.ReadFull(c, g); err != nil || g[1] != 2 {
		return fail(fmt.Errorf("method %v %v", g, err))
	}
	auth := append([]byte{1, byte(len(user))}, user...)
	auth = append(append(auth, byte(len(pass))), pass...)
	if _, err := c.Write(auth); err != nil {
		return fail(err)
	}
	if _, err := io.ReadFull(c, g); err != nil || g[1] != 0 {
		return fail(fmt.Errorf("auth %v %v", g, err))
	}
	host, ps, _ := net.SplitHostPort(target)
	var p int
	fmt.Sscanf(ps, "%d", &p)
	req := append([]byte{5, 1, 0, 1}, net.ParseIP(host).To4()...)
	req = binary.BigEndian.AppendUint16(req, uint16(p))
	if _, err := c.Write(req); err != nil {
		return fail(err)
	}
	reply := make([]byte, 10)
	if _, err := io.ReadFull(c, reply); err != nil || reply[1] != 0 {
		return fail(fmt.Errorf("connect %v %v", reply, err))
	}
	_ = c.SetDeadline(time.Time{})
	return c, nil
}

func socksHTTPGet(port int, user, pass, target string) (string, error) {
	c, err := socksDial(port, user, pass, target)
	if err != nil {
		return "", err
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := fmt.Fprintf(c, "GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", target); err != nil {
		return "", err
	}
	resp, err := http.ReadResponse(bufio.NewReader(c), nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return string(b), err
}
