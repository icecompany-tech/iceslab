package hysteria

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"
)

// E30a, 25.09: a node addressed by IP gets the PANEL's self-signed pair, pushed
// as tlsCertPem/tlsKeyPem. The adapter writes it beside its config, renders
// `tls:` instead of `acme:`, needs neither a hostname nor an ACME email, and
// reports the certificate's sha256 so the panel can compare it with the one it
// minted and clients pin.

// pemPair mints a pair the way the panel does: one self-signed leaf for an IP.
func pemPair(t *testing.T) (certPEM, keyPEM, sum string) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: "46.149.66.235"},
		IPAddresses:  []net.IP{net.ParseIP("46.149.66.235"), net.ParseIP("127.0.0.1")},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256(der)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})),
		string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})),
		hex.EncodeToString(h[:])
}

func selfSignedAdapter(t *testing.T) (*Adapter, string) {
	t.Helper()
	dir := t.TempDir()
	a := New(Config{
		ConfigPath: filepath.Join(dir, "config.yaml"),
		RunCmd:     func(context.Context, string, ...string) error { return nil },
		// No Hostname and no ACMEEmail: a node on an IP has neither.
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return a, dir
}

func pushed(t *testing.T, cfg map[string]any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestSelfSignedRendersTLSInsteadOfACME(t *testing.T) {
	certPEM, keyPEM, _ := pemPair(t)
	dir := t.TempDir()
	blob, err := renderConfig(Config{ConfigPath: filepath.Join(dir, "config.yaml")},
		InboundConfig{Port: 443, TLSCertPEM: certPEM, TLSKeyPEM: keyPEM}, nil)
	if err != nil {
		t.Fatalf("a node on an IP with the panel's pair needs no hostname or email: %v", err)
	}
	s := string(blob)
	want := fmt.Sprintf("tls:\n  cert: %s\n  key: %s\n", filepath.Join(dir, "iceslab-tls.crt"), filepath.Join(dir, "iceslab-tls.key"))
	if !strings.Contains(s, want) {
		t.Errorf("no tls block pointing beside the config:\n%s", s)
	}
	if strings.Contains(s, "acme:") {
		t.Errorf("tls and acme together, which hysteria refuses:\n%s", s)
	}
	if strings.Contains(s, "PRIVATE KEY") {
		t.Errorf("the key went into the config itself:\n%s", s)
	}
}

func TestApplyInboundWritesThePairAndReportsItsFingerprint(t *testing.T) {
	certPEM, keyPEM, sum := pemPair(t)
	a, dir := selfSignedAdapter(t)
	if f := a.TLSFact(); f != nil {
		t.Fatalf("a fact before anything was written: %+v", f)
	}
	if err := a.ApplyInbound(443, pushed(t, map[string]any{"tlsCertPem": certPEM, "tlsKeyPem": keyPEM})); err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]string{"iceslab-tls.crt": certPEM, "iceslab-tls.key": keyPEM} {
		got, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || string(got) != want {
			t.Errorf("%s: %v, content matches: %v", name, err, string(got) == want)
		}
	}
	if st, err := os.Stat(filepath.Join(dir, "iceslab-tls.key")); err == nil && st.Mode().Perm() != 0o600 && runtime.GOOS != "windows" {
		t.Errorf("the key is %v, want 0600", st.Mode().Perm())
	}
	f := a.TLSFact()
	if f == nil || f.Source != "self-signed" || f.CertSha256 != sum || f.NotAfter.IsZero() {
		t.Fatalf("fact %+v, want self-signed %s", f, sum)
	}

	// The node gets a domain: ACME again, and the fact says so.
	a.cfg.ACMEEmail = "ops@example.com"
	if err := a.ApplyInbound(443, pushed(t, map[string]any{"hostname": "hy.example.com"})); err != nil {
		t.Fatal(err)
	}
	if f := a.TLSFact(); f == nil || f.Source != "acme" || f.CertSha256 != "" {
		t.Fatalf("fact after moving to a domain: %+v", f)
	}
}

func TestApplyInboundRefusesAPairThatDoesNotBelongTogether(t *testing.T) {
	certA, _, _ := pemPair(t)
	_, keyB, _ := pemPair(t)
	a, dir := selfSignedAdapter(t)
	err := a.ApplyInbound(443, pushed(t, map[string]any{"tlsCertPem": certA, "tlsKeyPem": keyB}))
	if err == nil || !strings.Contains(err.Error(), "do not make a pair") {
		t.Fatalf("want a refusal in words, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "config.yaml")); !os.IsNotExist(err) {
		t.Errorf("a config was written for a refused pair")
	}
	if a.TLSFact() != nil {
		t.Errorf("a fact for a refused pair")
	}
}

// The engine itself on the render with the panel's pair, as it will run: no
// acme to swap here, the render is the file. Skipped without HYSTERIA_BIN.
func TestEngineServesThePanelsSelfSignedPair(t *testing.T) {
	if hysteriaBin == "" {
		t.Skip("HYSTERIA_BIN not set")
	}
	certPEM, keyPEM, _ := pemPair(t)
	dir := t.TempDir()
	cfg := Config{ConfigPath: filepath.Join(dir, "config.yaml")}
	if err := writeTLSPair(cfg.ConfigPath, certPEM, keyPEM); err != nil {
		t.Fatal(err)
	}
	blob, err := renderConfig(cfg, InboundConfig{Port: 443, TLSCertPEM: certPEM, TLSKeyPEM: keyPEM}, nil)
	if err != nil {
		t.Fatal(err)
	}
	out := regexp.MustCompile(`(?m)^listen: :\d+$`).ReplaceAllString(string(blob), fmt.Sprintf("listen: :%d", freeUDP(t)))
	out = regexp.MustCompile(`(?m)^  listen: 127\.0\.0\.1:\d+$`).ReplaceAllString(out, fmt.Sprintf("  listen: 127.0.0.1:%d", freeTCP(t)))
	if up, log := verdict(t, out); !up {
		t.Fatalf("hysteria refused the render with the panel's pair:\n%s\n%s", out, log)
	}
}
