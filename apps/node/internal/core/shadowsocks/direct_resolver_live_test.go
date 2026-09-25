package shadowsocks

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The goldens are rendered on whatever machine runs them, and the family
// choice follows its IPv6. Pinned for the package; the test that asks about
// IPv6 sets it itself and puts it back.
func init() { nodeHasIPv6 = func() bool { return false } }

// E37: the direct outbound of this second xray process resolves names through
// the core's own section, with the same family choice as the xray adapter.
func TestTheSsDirectOutboundResolvesThroughTheCore(t *testing.T) {
	defer func(f func() bool) { nodeHasIPv6 = f }(nodeHasIPv6)
	for _, c := range []struct {
		ipv6 bool
		want string
	}{{false, "UseIPv4"}, {true, "UseIP"}} {
		nodeHasIPv6 = func() bool { return c.ipv6 }
		m := renderToMap(t, ssInbound(ssCases[1].method, ssCases[1].psk), ssUsers)
		dns, _ := m["dns"].(map[string]any)
		servers, _ := dns["servers"].([]any)
		if len(servers) != 3 || servers[0] != "1.1.1.1" || servers[1] != "8.8.8.8" || servers[2] != "localhost" {
			t.Errorf("ipv6=%v: dns servers %v", c.ipv6, dns["servers"])
		}
		if dns["queryStrategy"] != c.want {
			t.Errorf("ipv6=%v: queryStrategy %v, want %s", c.ipv6, dns["queryStrategy"], c.want)
		}
		got := "<no direct>"
		for _, o := range m["outbounds"].([]any) {
			ob := o.(map[string]any)
			if ob["tag"] == "direct" {
				s, _ := ob["settings"].(map[string]any)
				got, _ = s["domainStrategy"].(string)
			}
		}
		if got != c.want {
			t.Errorf("ipv6=%v: direct domainStrategy %q, want %q", c.ipv6, got, c.want)
		}
	}
}

// Live, the same proof as the xray adapter's
// TestTheDirectOutboundReachesANameOnlyTheCoreResolves: a name that only the
// config's dns.hosts knows is reached through the direct outbound as rendered,
// and not with direct put back to AsIs. A socks inbound is added to the render
// to carry the request in (a Shadowsocks client is not what is under test: the
// outbound is); dns and outbounds stay as rendered. Skipped without XRAY_BIN.
func TestTheSsDirectOutboundReachesANameOnlyTheCoreResolves(t *testing.T) {
	bin := os.Getenv("XRAY_BIN")
	if bin == "" {
		t.Skip("XRAY_BIN not set: the core is not asked here")
	}
	const name = "iceslab-ss-direct.test"

	target, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "reached")
	})}
	go func() { _ = srv.Serve(target) }()
	t.Cleanup(func() { _ = srv.Close() })
	targetPort := target.Addr().(*net.TCPAddr).Port

	if _, err := net.DefaultResolver.LookupHost(context.Background(), name); err == nil {
		t.Fatalf("the host resolves %s, the test proves nothing here", name)
	}

	run := func(asIs bool) (string, error) {
		ssPort, apiPort, socksPort := freePort(t), freePort(t), freePort(t)
		in := ssInbound(ssCases[1].method, ssCases[1].psk)
		in.ListenPort, in.ApiPort, in.ListenHost = ssPort, apiPort, "127.0.0.1"
		m := renderToMap(t, in, ssUsers)
		m["dns"].(map[string]any)["hosts"] = map[string]any{name: "127.0.0.1"}
		m["inbounds"] = append(m["inbounds"].([]any), map[string]any{
			"tag": "test-socks", "listen": "127.0.0.1", "port": socksPort, "protocol": "socks",
			"settings": map[string]any{"auth": "noauth", "udp": false},
		})
		if asIs {
			for _, o := range m["outbounds"].([]any) {
				if ob := o.(map[string]any); ob["tag"] == "direct" {
					ob["settings"] = map[string]any{"domainStrategy": "AsIs"}
				}
			}
		}
		blob, _ := json.Marshal(m)
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, blob, 0o600); err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(bin, "run", "-c", path)
		var logs strings.Builder
		cmd.Stdout, cmd.Stderr = &logs, &logs
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
		if !waitListening(fmt.Sprintf("127.0.0.1:%d", socksPort), 5*time.Second) {
			t.Fatalf("xray did not listen:\n%s", logs.String())
		}
		proxy := &url.URL{Scheme: "socks5", Host: fmt.Sprintf("127.0.0.1:%d", socksPort)}
		client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: http.ProxyURL(proxy)}}
		resp, err := client.Get(fmt.Sprintf("http://%s:%d/", name, targetPort))
		if err != nil {
			return logs.String(), err
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if string(body) != "reached" {
			return logs.String(), fmt.Errorf("answer %q", body)
		}
		return logs.String(), nil
	}

	if logs, err := run(false); err != nil {
		t.Fatalf("as rendered, the direct outbound did not reach %s: %v\n%s", name, err, logs)
	}
	if _, err := run(true); err == nil {
		t.Fatalf("with direct on AsIs the request went through too: the test does not tell the two apart")
	}
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func waitListening(addr string, within time.Duration) bool {
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if c, err := net.DialTimeout("tcp", addr, 200*time.Millisecond); err == nil {
			_ = c.Close()
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return false
}
