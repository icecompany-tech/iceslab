package hysteria

import (
	"strings"
	"testing"
)

func TestValidateTrafficStatsListen_AcceptsEmpty(t *testing.T) {
	// Empty = stats disabled, not a config error.
	if err := validateTrafficStatsListen(""); err != nil {
		t.Errorf("empty should be allowed: %v", err)
	}
}

func TestValidateTrafficStatsListen_AcceptsLoopback(t *testing.T) {
	cases := []string{
		"127.0.0.1:9999",
		"127.0.0.1:8080",
		"[::1]:9999",
		":9999", // bare port, host is empty, treated as loopback by Go net
		"localhost:9999",
	}
	for _, listen := range cases {
		t.Run(listen, func(t *testing.T) {
			if err := validateTrafficStatsListen(listen); err != nil {
				t.Errorf("loopback should be allowed: %v", err)
			}
		})
	}
}

func TestValidateTrafficStatsListen_RejectsPublic(t *testing.T) {
	// Stats endpoint exposed publicly means anyone on the internet can
	// scrape per-user bytes with just the shared secret (and brute-force
	// it with no rate limit). Refuse to start.
	cases := []string{
		"0.0.0.0:9999",
		"8.8.8.8:9999",
		"203.0.113.1:9999",
		"[2001:db8::1]:9999",
	}
	for _, listen := range cases {
		t.Run(listen, func(t *testing.T) {
			err := validateTrafficStatsListen(listen)
			if err == nil {
				t.Errorf("public bind MISSED: %q accepted", listen)
			}
			if err != nil && !strings.Contains(err.Error(), "loopback") {
				t.Errorf("error msg should mention loopback: %v", err)
			}
		})
	}
}

func TestValidateTrafficStatsListen_RejectsMalformed(t *testing.T) {
	cases := []string{
		"not-a-host-port",
		"hostname.example.com:9999", // hostname is not an IP, we don't resolve
	}
	for _, listen := range cases {
		t.Run(listen, func(t *testing.T) {
			if err := validateTrafficStatsListen(listen); err == nil {
				t.Errorf("malformed should be rejected: %q", listen)
			}
		})
	}
}

func TestRandomHex_NonEmptyAndUnique(t *testing.T) {
	// randomHex is the auth-callback path generator; collisions would defeat
	// the defense. Sample 100 calls and ensure no duplicates, all hex.
	seen := make(map[string]bool, 100)
	for i := 0; i < 100; i++ {
		h := randomHex(16)
		if len(h) != 32 {
			t.Fatalf("len: got %d, want 32 (16 bytes * 2 hex chars)", len(h))
		}
		for _, c := range h {
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
				t.Fatalf("non-hex char %q in %q", c, h)
			}
		}
		if seen[h] {
			t.Fatalf("collision after %d samples: %s", i, h)
		}
		seen[h] = true
	}
}
