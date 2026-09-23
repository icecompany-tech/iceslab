package hysteria

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

/*
The engine's own verdict on what this adapter renders, phase 6.

hysteria has no `check` subcommand, so the only way to ask it is to START it:
a config it refuses dies with `FATAL failed to load server config`, one it
accepts logs `server up and running`. Both are answers, and this reads the log
for one or the other and then kills the process.

⚠ ONE BLOCK IS NOT ASKED, and it is named here rather than hidden: `acme`.
Measured 2026-09-23 against 2.12.3: started with the rendered `acme` block, the
binary goes to the REAL Let's Encrypt, registers an account, and dies FATAL on
"contact email has forbidden domain". A test that talks to a public CA on every
run is a test that fails on a rate limit, so the block is swapped for a local
`tls` pair before the file reaches the engine. Everything else goes as rendered:
auth, obfs, masquerade, bandwidth, trafficStats and, the point of the phase, the
chain hand-off. The acme block is also the one part of the render phase 6 did not
touch.

The same measurement found the binary writes an `acme/` directory into its
working directory, so it is started from a temp dir: from this package's own
directory it would have written into the repository.

Skipped without HYSTERIA_BIN, like the xray and sing-box checks. CI installs the
pinned 2.12.3 and sets it.
*/

var hysteriaBin = os.Getenv("HYSTERIA_BIN")

// verdict starts the engine on a config and says whether it came up.
func verdict(t *testing.T, yaml string) (up bool, log string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, hysteriaBin, "server", "-c", path)
	cmd.Dir = dir
	var out lockedBuffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Start(); err != nil {
		t.Fatalf("start %s: %v", hysteriaBin, err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		s := out.String()
		if strings.Contains(s, "server up and running") {
			return true, s
		}
		if strings.Contains(s, "FATAL") {
			return false, s
		}
		time.Sleep(50 * time.Millisecond)
	}
	return false, out.String() + "\n(no verdict within the deadline)"
}

// lockedBuffer is written by the child's pipes and read by the poll loop.
type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// forEngine turns a rendered config into one the engine can start here: a local
// TLS pair in place of acme, and free ports in place of the fixture ones.
func forEngine(t *testing.T, rendered []byte) string {
	t.Helper()
	cert, key := selfSigned(t)
	acme := regexp.MustCompile(`(?m)^acme:\n(?:  .*\n)+`)
	if !acme.Match(rendered) {
		t.Fatalf("the render has no acme block to swap, so this test no longer knows what it sends:\n%s", rendered)
	}
	out := acme.ReplaceAllString(string(rendered),
		fmt.Sprintf("tls:\n  cert: %s\n  key: %s\n", filepath.ToSlash(cert), filepath.ToSlash(key)))
	out = regexp.MustCompile(`(?m)^listen: :\d+$`).ReplaceAllString(out, fmt.Sprintf("listen: :%d", freeUDP(t)))
	out = regexp.MustCompile(`(?m)^  listen: 127\.0\.0\.1:\d+$`).
		ReplaceAllString(out, fmt.Sprintf("  listen: 127.0.0.1:%d", freeTCP(t)))
	return out
}

func selfSigned(t *testing.T) (certPath, keyPath string) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "iceslab-engine-test-not-a-secret"},
		DNSNames:     []string{"iceslab-engine-test-not-a-secret"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	certPath = filepath.Join(dir, "cert.pem")
	keyPath = filepath.Join(dir, "key.pem")
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	return certPath, keyPath
}

func freeUDP(t *testing.T) int {
	t.Helper()
	c, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	return c.LocalAddr().(*net.UDPAddr).Port
}

func freeTCP(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func TestEngineRefusesWhatItShouldRefuse(t *testing.T) {
	// The instrument first. A harness that reads "no FATAL" as "accepted" would
	// pass every config, including broken ones, and a green run would then mean
	// nothing. Measured refusal: an outbound type the engine does not know.
	if hysteriaBin == "" {
		t.Skip("HYSTERIA_BIN not set")
	}
	blob, err := renderConfig(goldenCfg, goldenInbound, nil)
	if err != nil {
		t.Fatal(err)
	}
	broken := forEngine(t, blob) + "\noutbounds:\n  - name: chain\n    type: socks6\n"
	up, log := verdict(t, broken)
	if up {
		t.Fatalf("the engine accepted an outbound type it does not have, so this harness cannot tell yes from no:\n%s", log)
	}
	if !strings.Contains(log, "unsupported outbound type") {
		t.Fatalf("refused, but not for the reason planted:\n%s", log)
	}
}

func TestEngineAcceptsTheRenderWithoutAChain(t *testing.T) {
	if hysteriaBin == "" {
		t.Skip("HYSTERIA_BIN not set")
	}
	blob, err := renderConfig(goldenCfg, goldenInbound, nil)
	if err != nil {
		t.Fatal(err)
	}
	if up, log := verdict(t, forEngine(t, blob)); !up {
		t.Fatalf("hysteria refused the render every non-entry node runs:\n%s", log)
	}
}

func TestEngineAcceptsTheChainHandoff(t *testing.T) {
	// The render of a hysteria entry: one socks5 outbound on loopback, no direct,
	// no acl. That the engine then routes users through it is a separate fact,
	// measured with real traffic on 2026-09-23 (first outbound is the default);
	// this asks only whether it loads.
	if hysteriaBin == "" {
		t.Skip("HYSTERIA_BIN not set")
	}
	blob, err := renderConfig(goldenCfg, goldenInbound, goldenHandoff)
	if err != nil {
		t.Fatal(err)
	}
	if up, log := verdict(t, forEngine(t, blob)); !up {
		t.Fatalf("hysteria refused the chain hand-off:\n%s", log)
	}
}
