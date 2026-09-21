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
	// It is a real risk and not a theoretical one: HYSTERIA_VERSION next door
	// is deliberately empty, and copying that shape here would undo this.
	if regexp.MustCompile(`XRAY_VERSION=\$\{XRAY_VERSION:-\}`).MatchString(script) {
		t.Error("XRAY_VERSION defaults to empty, which the installer reads as latest")
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
