package hysteria

import (
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"time"
)

/*
When the ACME certificate hysteria obtained runs out, read from where hysteria
keeps it, so the panel can show it as it shows the self-signed pair's.

hysteria app/v2.12.3 hands certmagic a FileStorage at HYSTERIA_ACME_DIR, or the
relative "acme" when that is unset (app/cmd/server.go:1012-1019; the variable
at app/cmd/root.go:27). Relative means to the process's working directory:
the unit bootstrap-hysteria.sh writes has no WorkingDirectory, so systemd runs
it from "/" and the storage is /acme (seen on the stand). The spawned process
inherits the agent's working directory.

certmagic v0.25.4 keeps a site's certificate at
certificates/<issuer key>/<domain>/<domain>.crt (storage.go:220-234), and the
issuer key of Let's Encrypt's production directory, the only CA we render, is
acme-v02.api.letsencrypt.org-directory.
*/

const acmeEnvDir = "HYSTERIA_ACME_DIR"

const letsEncryptIssuerKey = "acme-v02.api.letsencrypt.org-directory"

// noteUnitACMEDir keeps HYSTERIA_ACME_DIR from the unit's environment.
func (a *Adapter) noteUnitACMEDir(env []string) {
	dir := ""
	for _, kv := range env {
		if v, ok := strings.CutPrefix(kv, acmeEnvDir+"="); ok {
			dir = v
		}
	}
	a.mu.Lock()
	a.unitACMEDir = dir
	a.mu.Unlock()
}

// acmeDir is the storage the running hysteria uses.
func (a *Adapter) acmeDir() string {
	if a.cfg.ACMEDir != "" {
		return a.cfg.ACMEDir
	}
	a.mu.RLock()
	unitDir := a.unitACMEDir
	a.mu.RUnlock()
	if a.cfg.ServiceUnit != "" {
		if unitDir != "" {
			return unitDir
		}
		return "/acme"
	}
	if dir := os.Getenv(acmeEnvDir); dir != "" {
		return dir
	}
	if wd, err := os.Getwd(); err == nil {
		return filepath.Join(wd, "acme")
	}
	return "acme"
}

// acmeNotAfter reads the leaf of the certificate certmagic stored for host.
// false: no certificate there (not obtained yet, or another storage), which
// is "unknown", never "none".
func acmeNotAfter(dir, host string) (time.Time, bool) {
	domain := strings.ToLower(strings.TrimSpace(host))
	blob, err := os.ReadFile(filepath.Join(dir, "certificates", letsEncryptIssuerKey, domain, domain+".crt"))
	if err != nil {
		return time.Time{}, false
	}
	block, _ := pem.Decode(blob)
	if block == nil || block.Type != "CERTIFICATE" {
		return time.Time{}, false
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return time.Time{}, false
	}
	return cert.NotAfter, true
}
