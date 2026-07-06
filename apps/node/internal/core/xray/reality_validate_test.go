package xray

import (
	"testing"
)

func TestValidateRealityDest_Accepts(t *testing.T) {
	cases := []string{
		"www.cloudflare.com:443",
		"www.microsoft.com:443",
		"example.com:8443",
		"speedtest.net:443",
		// IPv4 public, fine.
		"8.8.8.8:443",
	}
	for _, dest := range cases {
		t.Run(dest, func(t *testing.T) {
			if err := validateRealityDest(dest); err != nil {
				t.Errorf("unexpected reject: %v", err)
			}
		})
	}
}

func TestValidateRealityDest_RejectsBadShape(t *testing.T) {
	// We don't pin the exact error message, net.SplitHostPort produces its
	// own wording for some cases ("missing port in address") and our explicit
	// check fires for others. Just assert the call returns SOME error.
	cases := []string{
		"",
		"www.cloudflare.com",
		":443",
		"www.cloudflare.com:",
	}
	for _, in := range cases {
		t.Run(in, func(t *testing.T) {
			if err := validateRealityDest(in); err == nil {
				t.Errorf("expected reject for %q", in)
			}
		})
	}
}

func TestValidateRealityDest_RejectsInternalIPs(t *testing.T) {
	// Closing the SSRF hole: panel can't point REALITY at the node's own
	// loopback / private-LAN to turn the node into a port scanner via
	// REALITY's fallback connect.
	cases := []string{
		"127.0.0.1:22",      // loopback v4
		"10.0.0.1:443",      // RFC1918
		"172.16.0.1:443",    // RFC1918
		"192.168.1.1:443",   // RFC1918
		"169.254.169.254:80", // link-local (AWS/GCP metadata!)
		"0.0.0.0:443",       // unspecified
		"[::1]:443",         // loopback v6
		"[fe80::1]:443",     // link-local v6
		"[fc00::1]:443",     // ULA v6
	}
	for _, dest := range cases {
		t.Run(dest, func(t *testing.T) {
			err := validateRealityDest(dest)
			if err == nil {
				t.Errorf("SSRF guard MISSED: %q accepted", dest)
			}
		})
	}
}
