package xray

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Which xray a new node installs, pinned.
//
// The INSTALLER was pinned to a commit; the CORE it downloads was not. Both
// call sites ran `bash "$XR_TMP" install`, which takes the latest release on
// the day the node happens to be built, so two nodes installed a week apart
// run different cores and the panel has no way to know. sing-box and the
// AmneziaWG module were closed the same way on 2026-09-21; xray was the last
// one left open.
//
// v26.3.27 is what the four stand nodes already run, confirmed 2026-09-11, so
// this default changes nothing about the fleet. What it removes is the drift.
const (
	pinnedXrayVersion = "v26.3.27"
	installerRelPath  = "../../../../../scripts/install-iceslab-node.sh"
)

func readInstaller(t *testing.T) string {
	t.Helper()
	blob, err := os.ReadFile(filepath.Clean(installerRelPath))
	if err != nil {
		t.Fatalf("read %s: %v", installerRelPath, err)
	}
	return string(blob)
}

func TestInstallerPinsXrayVersion(t *testing.T) {
	script := readInstaller(t)

	if !strings.Contains(script, `XRAY_VERSION=${XRAY_VERSION:-`+pinnedXrayVersion+`}`) {
		t.Errorf("XRAY_VERSION is not pinned to %s.\n"+
			"If the pin moved on purpose, move the constant here too. Check the stand\n"+
			"first: a core older than v25.9.5 rejects the vlessRoute auth the cascade\n"+
			"entry needs, so the pin is not a free-floating number.", pinnedXrayVersion)
	}

	// An empty default would mean "latest", which is the thing being closed.
	// It was a real risk and not a theoretical one: HYSTERIA_VERSION next door
	// sat empty until phase 6 pinned it too, and copying that shape here would
	// undo this.
	if regexp.MustCompile(`XRAY_VERSION=\$\{XRAY_VERSION:-\}`).MatchString(script) {
		t.Error("XRAY_VERSION defaults to empty, which the installer reads as latest")
	}
}

// xrayCeiling is the highest xray the fleet may run until one pair is MEASURED.
//
// Recorded 2026-09-23 from primary sources (docs/plan/recon-2026-09-23.md):
// XTLS/REALITY 8cdf7bf, shipped in xray 26.9.8, makes the server refuse a
// ClientHello without X25519MLKEM768 ahead of X25519. Our inter-hop legs are a
// sing-box dialler into an xray listener on the transitional fleet, and
// sing-box's uTLS does not send MLKEM for chrome (SagerNet/sing-box #4520, no
// fix as of 19.09) while firefox is untested (Xray #6482). A pin above this
// line is a fleet whose legs may fail the handshake with every config loading
// cleanly, so it is refused here until the pair has been asked.
const xrayCeiling = "v26.7.28"

// TestXrayPinStaysBelowTheRealityMLKEMChange guards the ceiling above.
//
// Separate from the exact pin on purpose: a bump of the exact pin is caught
// anyway, but this is the test that says WHY the next bump must not cross it,
// in the place the next person bumping it will be looking.
func TestXrayPinStaysBelowTheRealityMLKEMChange(t *testing.T) {
	if compareVersions(pinnedXrayVersion, xrayCeiling) > 0 {
		t.Fatalf("xray is pinned to %s, above %s.\n"+
			"XTLS/REALITY 8cdf7bf (xray 26.9.8+) refuses a ClientHello without\n"+
			"X25519MLKEM768; our legs dial from sing-box, whose uTLS does not send it\n"+
			"for chrome (sing-box #4520) and is untested for firefox (Xray #6482).\n"+
			"Measure a sing-box -> xray leg on the new version first, then move\n"+
			"xrayCeiling with the result written beside it.", pinnedXrayVersion, xrayCeiling)
	}
}

// compareVersions compares dotted versions with an optional leading v:
// -1, 0 or 1. Missing or non-numeric parts count as 0.
func compareVersions(a, b string) int {
	parse := func(s string) []int {
		parts := strings.Split(strings.TrimPrefix(s, "v"), ".")
		out := make([]int, len(parts))
		for i, p := range parts {
			n := 0
			for _, c := range p {
				if c < '0' || c > '9' {
					break
				}
				n = n*10 + int(c-'0')
			}
			out[i] = n
		}
		return out
	}
	x, y := parse(a), parse(b)
	for i := 0; i < len(x) || i < len(y); i++ {
		var p, q int
		if i < len(x) {
			p = x[i]
		}
		if i < len(y) {
			q = y[i]
		}
		if p != q {
			if p < q {
				return -1
			}
			return 1
		}
	}
	return 0
}

func TestCompareVersionsOrdersTheReleasesThatMatter(t *testing.T) {
	// The comparison the ceiling rests on, pinned with the actual releases in
	// question: string order would put "26.10.0" below "26.9.8".
	cases := []struct {
		a, b string
		want int
	}{
		{"v26.3.27", "v26.7.28", -1},
		{"v26.7.28", "v26.7.28", 0},
		{"v26.9.8", "v26.7.28", 1},
		{"v26.10.0", "v26.9.8", 1},
		{"26.7.28", "v26.7.28", 0},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

// TestInstallerPassesTheVersionAtEveryCallSite is the half that actually holds.
//
// A pin sitting in a variable nothing reads is decoration. There are TWO sites,
// because shadowsocks runs inside xray-core and installs it separately, and a
// fix applied to one of them leaves half the fleet unpinned in a way nothing
// else would show.
func TestInstallerPassesTheVersionAtEveryCallSite(t *testing.T) {
	script := readInstaller(t)

	bare := regexp.MustCompile(`(?m)^\s*bash "\$XR_TMP" install\s*$`)
	if bare.MatchString(script) {
		t.Error("an xray install still runs without --version; that call takes whatever " +
			"release is latest on the day the node is built")
	}

	pinned := strings.Count(script, `bash "$XR_TMP" install --version "$XRAY_VERSION"`)
	if pinned != 2 {
		t.Errorf("expected both xray install sites (the xray protocol and shadowsocks, "+
			"which runs inside xray-core) to pass the pinned version, found %d", pinned)
	}
}
