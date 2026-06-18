package firewall

import (
	"fmt"
	"testing"
)

// TestParseUfwStatus checks the G4 ufw-status parser: single-port v4 allows are
// extracted, the v6 dupes ufw prints are collapsed, and port-range / bare-port
// rules are skipped (the panel can't compare those, so we don't report them).
func TestParseUfwStatus(t *testing.T) {
	out := `Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
443/udp                    ALLOW       Anywhere
1337/tcp                   ALLOW       203.0.113.5
8080/tcp                   ALLOW       Anywhere
22/tcp (v6)                ALLOW       Anywhere (v6)
443/tcp (v6)               ALLOW       Anywhere (v6)
20000:50000/udp            ALLOW       Anywhere
`
	got := parseUfwStatus(out)
	want := map[string]bool{
		"22/tcp": true, "443/tcp": true, "443/udp": true,
		"1337/tcp": true, "8080/tcp": true,
	}
	if len(got) != len(want) {
		t.Fatalf("got %d ports, want %d: %+v", len(got), len(want), got)
	}
	for _, p := range got {
		key := fmt.Sprintf("%d/%s", p.Port, p.Proto)
		if !want[key] {
			t.Errorf("unexpected port %s (v6 dupes + ranges should be excluded)", key)
		}
	}
}

func TestParseUfwStatus_InactiveOrEmpty(t *testing.T) {
	if got := parseUfwStatus("Status: inactive\n"); len(got) != 0 {
		t.Errorf("inactive ufw should yield no ports, got %+v", got)
	}
	if got := parseUfwStatus(""); len(got) != 0 {
		t.Errorf("empty output should yield no ports, got %+v", got)
	}
}

// TestIsLiteralSource: a bare IP or CIDR is something `ufw allow from <x>`
// accepts verbatim; a hostname (or junk) is not and must be resolved first.
func TestIsLiteralSource(t *testing.T) {
	literal := []string{"45.151.102.209", "10.0.0.0/8", "::1", "2001:db8::/32"}
	notLiteral := []string{"aeza-rus-01.icepath.tech", "", "not an ip", "1.2.3"}
	for _, s := range literal {
		if !isLiteralSource(s) {
			t.Errorf("isLiteralSource(%q) = false, want true", s)
		}
	}
	for _, s := range notLiteral {
		if isLiteralSource(s) {
			t.Errorf("isLiteralSource(%q) = true, want false", s)
		}
	}
}
