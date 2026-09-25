package xray

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

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// E37 tail, live: the direct outbound reaches a name that ONLY the core's own
// resolver knows. The name lives in the config's dns.hosts and nowhere on the
// host, which is the nl-01 situation seen from the other side: there the host's
// resolver was dead, here it simply has no answer, and either way a direct
// outbound that asks the host goes nowhere. Asked of the real xray, twice:
//
//   - the config as rendered: the request through socks reaches the local HTTP
//     server behind the name;
//   - the same config with direct put back to AsIs (the pre-fix render): the
//     request fails, so the first half is proof and not luck.
//
// Skipped without XRAY_BIN, like every test here that asks the core.
func TestTheDirectOutboundReachesANameOnlyTheCoreResolves(t *testing.T) {
	bin := os.Getenv("XRAY_BIN")
	if bin == "" {
		t.Skip("XRAY_BIN not set: the core is not asked here")
	}
	const name = "iceslab-direct.test"

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

	// The host has no answer for the name: nothing to prove otherwise.
	if _, err := net.DefaultResolver.LookupHost(context.Background(), name); err == nil {
		t.Fatalf("the host resolves %s, the test proves nothing here", name)
	}

	run := func(t *testing.T, asIs bool) (string, error) {
		t.Helper()
		socksPort, apiPort := freePort(t), freePort(t)
		in := plainIn("socks", socksPort)
		in.ListenHost = "127.0.0.1"
		blob, err := renderMultiConfig([]InboundConfig{in}, []xrayClient{alice}, nil, apiPort, nil,
			&dto.DnsCfg{Servers: []dto.DnsServer{{Address: "1.1.1.1"}}})
		if err != nil {
			t.Fatal(err)
		}
		var doc map[string]any
		if err := json.Unmarshal(blob, &doc); err != nil {
			t.Fatal(err)
		}
		doc["dns"].(map[string]any)["hosts"] = map[string]any{name: "127.0.0.1"}
		for _, o := range doc["outbounds"].([]any) {
			ob := o.(map[string]any)
			if ob["tag"] == "direct" && asIs {
				ob["settings"] = map[string]any{"domainStrategy": "AsIs"}
			}
		}
		blob, _ = json.Marshal(doc)
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

		proxy := &url.URL{Scheme: "socks5", User: url.UserPassword(alice.Login, alice.ID), Host: fmt.Sprintf("127.0.0.1:%d", socksPort)}
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

	if logs, err := run(t, false); err != nil {
		t.Fatalf("as rendered, the direct outbound did not reach %s: %v\n%s", name, err, logs)
	}
	if _, err := run(t, true); err == nil {
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
