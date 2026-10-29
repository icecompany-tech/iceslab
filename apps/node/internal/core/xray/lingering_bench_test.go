//go:build benchonline && linux

package xray

import (
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

/*
A-218, the cost of statsUserOnline, measured rather than guessed. Not part of
any regular run: build tag benchonline.

The flag costs on a connection's open and close (AddIP/RemoveIP under the
user's online map mutex, xray app/stats/online_map.go), so the measure is
short connections per second and the core's CPU per 10 000 of them, plus
the core's memory with many held open. The same agent render, the same
binary, once with the flag and once without; clients come from
127.0.0.2..250 so the map holds many addresses.

	cd apps/node && XRAY_BIN=/usr/local/bin/xray go test -tags benchonline -run TestBenchStatsUserOnline -count=1 -v ./internal/core/xray/

BENCH_SECONDS (default 30), BENCH_WORKERS (32), BENCH_HOLD (2000) and
BENCH_ROUNDS (3) change the load. Everything is on loopback with a core of its own: the node's xray is
not touched.
*/
func TestBenchStatsUserOnline(t *testing.T) {
	bin := os.Getenv("XRAY_BIN")
	if bin == "" {
		t.Skip("XRAY_BIN not set")
	}
	seconds := envInt("BENCH_SECONDS", 30)
	workers := envInt("BENCH_WORKERS", 32)
	hold := envInt("BENCH_HOLD", 2000)
	raiseFileLimit(t, uint64(hold)*4+1024)

	// The agent's own render: one socks door, one user.
	socksPort, api := freePort(t), freePort(t)
	dir := t.TempDir()
	a := New(Config{
		ConfigPath: filepath.Join(dir, "agent.json"),
		Inbound:    InboundConfig{ApiPort: api, ListenHost: "127.0.0.1"},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	const uuid = "5f0c9a3e-2b7d-4e51-9c8a-1d2e3f4a5b6c"
	if err := a.AddUser(core.User{UserID: "u-bench", Username: "bench", XrayUUID: uuid}); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(socksPort, []byte(`{"inboundId":"cccccccc-3333-4000-8000-000000000003","subprotocol":"socks","security":"none","network":"raw"}`)); err != nil {
		t.Fatal(err)
	}
	rendered, err := os.ReadFile(filepath.Join(dir, "agent.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(rendered, []byte(`"statsUserOnline": true`)) {
		t.Fatal("the render does not carry the flag this measures")
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

	// Rounds alternate the two, a fresh core each time, and the medians are
	// compared: a single pair is mostly warm-up and order (seen locally,
	// the second run faster whichever it was).
	rounds := envInt("BENCH_ROUNDS", 3)
	paths := map[bool]string{}
	for _, on := range []bool{false, true} {
		cfg := rendered
		if !on {
			cfg = bytes.Replace(rendered, []byte(`"statsUserOnline": true`), []byte(`"statsUserOnline": false`), 1)
		}
		paths[on] = filepath.Join(dir, fmt.Sprintf("bench-%v.json", on))
		if err := os.WriteFile(paths[on], cfg, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("load: %d rounds, %d s each, %d workers, %d held", rounds, seconds, workers, hold)
	t.Logf("%-5s | %5s | %9s | %15s | %9s | %9s", "flag", "round", "conn/s", "cpu-s/10k conn", "RSS idle", "RSS held")
	all := map[bool][]benchResult{}
	for r := 0; r < rounds; r++ {
		order := []bool{false, true}
		if r%2 == 1 {
			order = []bool{true, false}
		}
		for _, on := range order {
			res := benchOnce(t, bin, paths[on], socksPort, uuid, echo.Addr().String(), seconds, workers, hold)
			all[on] = append(all[on], res)
			t.Logf("%-5v | %5d | %9.0f | %15.3f | %6d KB | %6d KB", on, r+1, res.connPerSec, res.cpuPer10k, res.rssIdle, res.rssHeld)
		}
	}
	off, on := medianOf(all[false]), medianOf(all[true])
	t.Logf("median off | %9.0f conn/s | %7.3f cpu-s/10k | %6d KB held", off.connPerSec, off.cpuPer10k, off.rssHeld)
	t.Logf("median on  | %9.0f conn/s | %7.3f cpu-s/10k | %6d KB held", on.connPerSec, on.cpuPer10k, on.rssHeld)
	t.Logf("on vs off  | conn/s %+.1f%% | cpu/conn %+.1f%% | RSS held %+.1f%%",
		pct(on.connPerSec, off.connPerSec), pct(on.cpuPer10k, off.cpuPer10k), pct(float64(on.rssHeld), float64(off.rssHeld)))
}

// medianOf takes each measure's median on its own.
func medianOf(rs []benchResult) benchResult {
	med := func(get func(benchResult) float64) float64 {
		v := make([]float64, len(rs))
		for i, r := range rs {
			v[i] = get(r)
		}
		sort.Float64s(v)
		return v[len(v)/2]
	}
	return benchResult{
		connPerSec: med(func(r benchResult) float64 { return r.connPerSec }),
		cpuPer10k:  med(func(r benchResult) float64 { return r.cpuPer10k }),
		rssIdle:    int64(med(func(r benchResult) float64 { return float64(r.rssIdle) })),
		rssHeld:    int64(med(func(r benchResult) float64 { return float64(r.rssHeld) })),
	}
}

func pct(on, off float64) float64 {
	if off == 0 {
		return 0
	}
	return (on - off) / off * 100
}

type benchResult struct {
	connPerSec, cpuPer10k float64
	rssIdle, rssHeld      int64
}

func benchOnce(t *testing.T, bin, cfg string, socksPort int, pass, target string, seconds, workers, hold int) benchResult {
	t.Helper()
	cmd := exec.Command(bin, "run", "-c", cfg)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	pid := cmd.Process.Pid

	from := func(i int) net.Addr { return &net.TCPAddr{IP: net.IPv4(127, 0, 0, byte(2+i%249))} }
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(100 * time.Millisecond) {
		c, err := socksDialFrom(from(0), socksPort, "bench", pass, target)
		if err == nil {
			_ = c.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("xray did not come up: %v", err)
		}
	}
	time.Sleep(500 * time.Millisecond)
	rssIdle := procRSS(t, pid)

	payload := bytes.Repeat([]byte("x"), 1024)
	var conns atomic.Int64
	cpu0 := procCPU(t, pid)
	stop := time.Now().Add(time.Duration(seconds) * time.Second)
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			buf := make([]byte, len(payload))
			for i := w; time.Now().Before(stop); i += workers {
				c, err := socksDialFrom(from(i), socksPort, "bench", pass, target)
				if err != nil {
					continue
				}
				_ = c.SetDeadline(time.Now().Add(3 * time.Second))
				if _, err := c.Write(payload); err == nil {
					if _, err := io.ReadFull(c, buf); err == nil {
						conns.Add(1)
					}
				}
				_ = c.Close()
			}
		}(w)
	}
	wg.Wait()
	cpu := procCPU(t, pid) - cpu0
	n := conns.Load()
	if n == 0 {
		t.Fatal("no connection went through: nothing was measured")
	}

	held := make([]net.Conn, 0, hold)
	for i := 0; i < hold; i++ {
		c, err := socksDialFrom(from(i), socksPort, "bench", pass, target)
		if err != nil {
			t.Fatalf("held %d of %d: %v", i, hold, err)
		}
		held = append(held, c)
	}
	time.Sleep(time.Second)
	rssHeld := procRSS(t, pid)
	for _, c := range held {
		_ = c.Close()
	}
	return benchResult{
		connPerSec: float64(n) / float64(seconds),
		cpuPer10k:  cpu / float64(n) * 10000,
		rssIdle:    rssIdle,
		rssHeld:    rssHeld,
	}
}

// procCPU: the process's user+system CPU in seconds (/proc/<pid>/stat,
// fields 14 and 15 in clock ticks; 100 per second on every Linux we run).
func procCPU(t *testing.T, pid int) float64 {
	t.Helper()
	raw, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		t.Fatal(err)
	}
	// The command name may hold spaces; the fields start after its ')'.
	f := strings.Fields(string(raw[bytes.LastIndexByte(raw, ')')+2:]))
	ut, _ := strconv.ParseFloat(f[11], 64)
	st, _ := strconv.ParseFloat(f[12], 64)
	return (ut + st) / 100
}

func procRSS(t *testing.T, pid int) int64 {
	t.Helper()
	raw, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			n, _ := strconv.ParseInt(strings.Fields(line)[1], 10, 64)
			return n
		}
	}
	return 0
}

func envInt(name string, def int) int {
	if n, err := strconv.Atoi(os.Getenv(name)); err == nil && n > 0 {
		return n
	}
	return def
}

// raiseFileLimit: held connections are two descriptors here and two in the core.
func raiseFileLimit(t *testing.T, want uint64) {
	t.Helper()
	var lim syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &lim); err != nil {
		return
	}
	if lim.Cur >= want {
		return
	}
	lim.Cur = min(want, lim.Max)
	_ = syscall.Setrlimit(syscall.RLIMIT_NOFILE, &lim)
	if lim.Cur < want {
		t.Logf("file limit %d is below %d: lower BENCH_HOLD or raise ulimit -n", lim.Cur, want)
	}
}
