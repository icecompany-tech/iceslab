package hysteria

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"log/slog"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// leafFor writes a certificate for host where certmagic keeps it in dir.
func leafFor(t *testing.T, dir, host string, notAfter time.Time) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: host},
		DNSNames:     []string{host},
		NotBefore:    notAfter.Add(-90 * 24 * time.Hour),
		NotAfter:     notAfter,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatal(err)
	}
	site := filepath.Join(dir, "certificates", "acme-v02.api.letsencrypt.org-directory", host)
	if err := os.MkdirAll(site, 0o700); err != nil {
		t.Fatal(err)
	}
	// certmagic stores the whole chain; the leaf comes first.
	body := append(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})...)
	if err := os.WriteFile(filepath.Join(site, host+".crt"), body, 0o600); err != nil {
		t.Fatal(err)
	}
}

func acmeAdapter(t *testing.T, acmeDir string) *Adapter {
	t.Helper()
	dir := t.TempDir()
	return New(Config{
		ConfigPath: filepath.Join(dir, "config.yaml"),
		ACMEDir:    acmeDir,
		RunCmd:     func(context.Context, string, ...string) error { return nil },
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

// The ACME certificate's end is reported like the self-signed pair's; with no
// certificate in the storage yet it is unknown (zero), not "none".
func TestTheACMECertificatesEndIsReportedAndUnknownUntilThere(t *testing.T) {
	store := t.TempDir()
	a := acmeAdapter(t, store)
	if err := a.ApplyInbound(443, pushed(t, map[string]any{"hostname": "Hy.Example.Net"})); err != nil {
		t.Fatal(err)
	}
	f := a.TLSFact()
	if f == nil || f.Source != "acme" || !f.NotAfter.IsZero() {
		t.Fatalf("before a certificate is obtained: %+v, want acme with no end", f)
	}

	end := time.Date(2027, 1, 25, 10, 0, 0, 0, time.UTC)
	leafFor(t, store, "hy.example.net", end)
	f = a.TLSFact()
	if f == nil || f.Source != "acme" || !f.NotAfter.Equal(end) {
		t.Fatalf("with the certificate stored: %+v, want acme ending %s", f, end)
	}
	if f.CertSha256 != "" {
		t.Fatalf("an ACME certificate carries no pin: %+v", f)
	}
}

// Where hysteria keeps its storage: HYSTERIA_ACME_DIR of the unit, else /acme
// (systemd runs the unit from "/"); a spawned process, the agent's own.
func TestTheACMEStorageIsFoundWhereHysteriaKeepsIt(t *testing.T) {
	unit := New(Config{ServiceUnit: "hysteria"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if got := unit.acmeDir(); got != "/acme" {
		t.Fatalf("unit with no HYSTERIA_ACME_DIR: %q, want /acme", got)
	}
	unit.noteUnitACMEDir([]string{"HYSTERIA_LOG_LEVEL=error", "HYSTERIA_ACME_DIR=/var/lib/hysteria/acme"})
	if got := unit.acmeDir(); got != "/var/lib/hysteria/acme" {
		t.Fatalf("unit with HYSTERIA_ACME_DIR: %q", got)
	}

	spawn := New(Config{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Setenv("HYSTERIA_ACME_DIR", "")
	wd, _ := os.Getwd()
	if got := spawn.acmeDir(); got != filepath.Join(wd, "acme") {
		t.Fatalf("spawned with no HYSTERIA_ACME_DIR: %q, want the agent's working directory", got)
	}
	t.Setenv("HYSTERIA_ACME_DIR", "/srv/acme")
	if got := spawn.acmeDir(); got != "/srv/acme" {
		t.Fatalf("spawned with HYSTERIA_ACME_DIR: %q", got)
	}
}
