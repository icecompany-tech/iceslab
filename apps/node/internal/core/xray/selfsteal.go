package xray

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"time"
)

// K9-B: REALITY self-steal local TLS fallback.
//
// Problem (field 2026-06-11): our REALITY default is "steal-from-others" -
// dest = an external site (cloudflare/samsung), serverName = that same site.
// The client sends the external site's SNI but connects to the NODE's IP, which
// doesn't belong to that site -> SNI-IP mismatch -> RU-DPI mangles the
// handshake ("failed to read client hello"). REALITY is useless in RU this way.
//
// Fix (steal-from-yourself): dest = 127.0.0.1:8443 (a TLS endpoint on the node
// itself) + serverNames = the node's own domain (which resolves to the node IP
// -> SNI and IP are consistent). This server is that local endpoint. xray
// forwards any non-REALITY (prober) handshake to it, so a prober sees a real
// TLS 1.3 site on the node's domain instead of a mismatch.
//
// The cert is self-signed for the domain (sanctioned by BACKLOG K9: "nginx/
// caddy с LE-сертом ... ИЛИ self-signed"). Self-signed is a weaker masquerade
// than a real LE cert (a prober sees an untrusted cert) but it fully fixes the
// SNI-IP-mismatch detection vector, which is the one RU-DPI actually uses. An
// operator wanting stronger probe-resistance can point dest at a real
// nginx+LE site instead; this is the zero-install default.

// selfStealAddr is where the local TLS fallback listens. Loopback only - it's
// reachable solely by the node's own xray process (REALITY's dest dial), never
// exposed externally.
const selfStealAddr = "127.0.0.1:8443"

// selfStealModeValue is the RealityMode wire value that turns this on.
const selfStealModeValue = "self-steal"

// selfStealLandingHTML is the benign page a prober sees. Deliberately generic -
// a plain default-install landing page, nothing that screams "proxy".
const selfStealLandingHTML = `<!DOCTYPE html>
<html>
<head><title>Welcome</title></head>
<body>
<h1>It works!</h1>
<p>This is the default web page for this server.</p>
</body>
</html>
`

// selfStealServer is the running local TLS fallback. domain is tracked so the
// adapter can detect a domain change and restart with a fresh cert.
type selfStealServer struct {
	srv    *http.Server
	domain string
}

// generateSelfSignedCert builds an ECDSA P-256 self-signed leaf for `domain`,
// valid ~10y. Used as the local fallback's TLS identity.
func generateSelfSignedCert(domain string) (tls.Certificate, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("gen key: %w", err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("gen serial: %w", err)
	}
	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: domain},
		DNSNames:              []string{domain},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &priv.PublicKey, priv)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("create cert: %w", err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: priv}, nil
}

// startSelfSteal launches the local TLS 1.3 fallback on `addr` presenting a
// self-signed cert for `domain`. MinVersion is pinned to TLS 1.3 because
// REALITY requires its dest to negotiate 1.3 (a 1.2 fallback would make the
// borrowed handshake detectable). The handler serves a generic landing page.
//
// `listenTLS` is injectable so tests can bind an ephemeral port.
func startSelfSteal(addr, domain string, logger *slog.Logger) (*selfStealServer, error) {
	cert, err := generateSelfSignedCert(domain)
	if err != nil {
		return nil, fmt.Errorf("self-steal cert: %w", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Server", "nginx")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, selfStealLandingHTML)
	})
	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
		TLSConfig: &tls.Config{
			MinVersion:   tls.VersionTLS13,
			Certificates: []tls.Certificate{cert},
		},
		ReadHeaderTimeout: 5 * time.Second,
	}
	ln, err := selfStealListen(addr)
	if err != nil {
		return nil, err
	}
	go func() {
		logger.Info("xray self-steal TLS fallback listening", "addr", addr, "domain", domain)
		// Certs are supplied via TLSConfig, so the cert/key file args are empty.
		if err := srv.ServeTLS(ln, "", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("xray self-steal fallback failed", "err", err)
		}
	}()
	return &selfStealServer{srv: srv, domain: domain}, nil
}

// selfStealListen is split out so tests can swap in an ephemeral listener.
var selfStealListen = func(addr string) (net.Listener, error) {
	return net.Listen("tcp", addr)
}

func (s *selfStealServer) stop(ctx context.Context) error {
	if s == nil || s.srv == nil {
		return nil
	}
	shutCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return s.srv.Shutdown(shutCtx)
}
