package xray

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

/*
Bk-170, live, with the real core: a connection whose other end has gone dead is
closed by the time the operator set, and without the setting it stays.

The peer dies by taking the loopback down, so nothing answers and nothing resets,
which is what a client that lost its network looks like from the server. That
needs a network namespace of its own: the test runs itself again inside one, and
the machine's own loopback is not touched. Skipped without XRAY_BIN, or where no
namespace can be made.
*/

const sockoptNetnsEnv = "ICESLAB_SOCKOPT_NETNS"

func TestLiveADeadConnectionClosesByTheSocketOptions(t *testing.T) {
	bin := os.Getenv("XRAY_BIN")
	if bin == "" {
		t.Skip("XRAY_BIN not set: the core is not asked here")
	}
	if os.Getenv(sockoptNetnsEnv) == "" {
		runInOwnNetns(t)
		return
	}
	setLoopback(t, "up")

	t.Run("tcpUserTimeout closes a connection with data in flight", func(t *testing.T) {
		gone := deadConnection(t, bin, `,"tcpUserTimeout":3000`, true, 15*time.Second)
		if gone < 0 {
			t.Fatal("still there 15 s after its peer died, with tcpUserTimeout at 3 s")
		}
		// The kernel counts from the first probe nobody answered, up to the
		// second before the peer died, so the floor is 3 s less that.
		if gone < time.Second {
			t.Fatalf("gone after %v, well before the 3 s it was given", gone)
		}
		t.Logf("closed %v after the peer died (tcpUserTimeout 3000 ms)", gone)
	})
	t.Run("without tcpUserTimeout it stays", func(t *testing.T) {
		if gone := deadConnection(t, bin, ``, true, 8*time.Second); gone >= 0 {
			t.Fatalf("closed %v after the peer died with nothing set: the test does not tell the two apart", gone)
		}
	})
	t.Run("keepalive closes an idle connection", func(t *testing.T) {
		// Idle 2 s, then the kernel's nine probes one second apart.
		gone := deadConnection(t, bin, `,"tcpKeepAliveIdle":2,"tcpKeepAliveInterval":1`, false, 20*time.Second)
		if gone < 0 {
			t.Fatal("still there 20 s after its peer died, with keepalive at 2 s and 1 s")
		}
		t.Logf("closed %v after the peer died (keepalive idle 2 s, interval 1 s)", gone)
	})
	t.Run("without keepalive an idle connection stays", func(t *testing.T) {
		if gone := deadConnection(t, bin, ``, false, 14*time.Second); gone >= 0 {
			t.Fatalf("closed %v after the peer died with nothing set: the test does not tell the two apart", gone)
		}
	})
}

// runInOwnNetns runs this test again in a new network namespace: as an
// unprivileged user where the system allows it, else through sudo without a
// password (a CI runner), else not at all.
func runInOwnNetns(t *testing.T) {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	args := []string{"-test.run=^TestLiveADeadConnectionClosesByTheSocketOptions$", "-test.v", "-test.count=1"}
	env := []string{sockoptNetnsEnv + "=1", "XRAY_BIN=" + os.Getenv("XRAY_BIN")}
	var cmd *exec.Cmd
	switch {
	case exec.Command("unshare", "-Urn", "true").Run() == nil:
		cmd = exec.Command("unshare", append([]string{"-Urn", self}, args...)...)
		cmd.Env = append(os.Environ(), env...)
	case exec.Command("sudo", "-n", "unshare", "-n", "true").Run() == nil:
		cmd = exec.Command("sudo", append(append([]string{"-n", "env"}, env...), append([]string{"unshare", "-n", self}, args...)...)...)
	default:
		t.Skip("no network namespace can be made here (unshare -Urn, sudo -n unshare -n)")
	}
	out, err := cmd.CombinedOutput()
	t.Logf("in its own namespace:\n%s", out)
	if err != nil {
		t.Fatalf("the run in its own namespace failed: %v", err)
	}
}

func setLoopback(t *testing.T, state string) {
	t.Helper()
	if out, err := exec.Command("ip", "link", "set", "lo", state).CombinedOutput(); err != nil {
		t.Fatalf("ip link set lo %s: %v\n%s", state, err, out)
	}
}

// serverSideOpen says whether the core still holds a connection on its port:
// a /proc/net/tcp row with that local port which is not the listener. The kernel
// is asked rather than the core, since closing the socket is the whole claim.
func serverSideOpen(t *testing.T, port int) bool {
	t.Helper()
	raw, err := os.ReadFile("/proc/net/tcp")
	if err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprintf(":%04X", port)
	for _, line := range strings.Split(string(raw), "\n")[1:] {
		f := strings.Fields(line)
		if len(f) > 3 && strings.HasSuffix(f[1], want) && f[3] != "0A" {
			return true
		}
	}
	return false
}

// deadConnection brings a socks inbound up with the given extra config, opens a
// connection through it, kills the peer and returns how long the core held on,
// or -1 if it still does after wait.
func deadConnection(t *testing.T, bin, extra string, inFlight bool, wait time.Duration) time.Duration {
	t.Helper()
	setLoopback(t, "up")
	socksPort, api := freePort(t), freePort(t)
	a := New(Config{
		ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		BinaryPath: bin,
		Inbound:    InboundConfig{ApiPort: api, ListenHost: "127.0.0.1"},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer func() {
		setLoopback(t, "up")
		_ = a.Stop(context.Background())
	}()
	if err := a.AddUser(core.User{UserID: "u-alice", Username: "alice", XrayUUID: alice.ID}); err != nil {
		t.Fatal(err)
	}
	wire := `{"inboundId":"eeeeeeee-5555-4000-8000-000000000005","subprotocol":"socks","security":"none","network":"raw"` + extra + `}`
	if err := a.ApplyInbound(socksPort, []byte(wire)); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if raw, err := os.ReadFile(a.cfg.ConfigPath); err != nil {
		t.Fatal(err)
	} else if extra != "" && !strings.Contains(string(raw), `"tcpUserTimeout"`) && !strings.Contains(string(raw), `"tcpKeepAliveIdle"`) {
		t.Fatalf("the config the core runs does not carry the value:\n%s", raw)
	}

	target, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	go serveTarget(target, inFlight)

	var stream net.Conn
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
		if stream, err = socksDial(socksPort, "alice", alice.ID, target.Addr().String()); err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("socks to the target: %v", err)
	}
	defer stream.Close()
	buf := make([]byte, 64<<10)
	if _, err := io.ReadAtLeast(stream, buf, 1); err != nil {
		t.Fatalf("nothing came through: %v", err)
	}
	// With data in flight the client stops reading, so the core's send queue is
	// full when the peer dies. TCP_USER_TIMEOUT counts only what waits for an
	// answer: a client that went on reading could leave the queue empty at that
	// moment on a busy machine, and then nothing would be waiting.
	time.Sleep(time.Second)
	if !serverSideOpen(t, socksPort) {
		t.Fatal("no connection on the core's port before the peer died")
	}

	setLoopback(t, "down")
	died := time.Now()
	for time.Since(died) < wait {
		if !serverSideOpen(t, socksPort) {
			return time.Since(died)
		}
		time.Sleep(100 * time.Millisecond)
	}
	return -1
}

// serveTarget answers each connection with one chunk, and with stream set goes
// on writing so the core always has something to send.
func serveTarget(l net.Listener, stream bool) {
	chunk := []byte(strings.Repeat("x", 64<<10))
	for {
		c, err := l.Accept()
		if err != nil {
			return
		}
		go func(c net.Conn) {
			defer c.Close()
			if _, err := c.Write(chunk[:1]); err != nil {
				return
			}
			if !stream {
				_, _ = io.Copy(io.Discard, c)
				return
			}
			for {
				if _, err := c.Write(chunk); err != nil {
					return
				}
			}
		}(c)
	}
}
