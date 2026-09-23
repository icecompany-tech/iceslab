package hysteria

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Which hysteria a node runs is the version manifest's
// (packages/shared/src/core-versions.ts): both installers and CI carry it as a
// generated block or a checked line, and core-pins.test.ts in the backend holds
// all three to it. From phase 6 on this adapter renders a config shape that was
// MEASURED against that release (the socks5 outbound that hands users to the
// chain, with no acl); the manifest's `why` says so, and moving the pin means
// adding a release there with the measurement run again.
//
// What stays here is what the manifest cannot see: that the scripts USE the pin
// and check the checksum.
//
// ⚠ These read files outside the package, so `go test` caches their PASS across
// edits to those files. Run them with -count=1 locally; CI has no cache.

func readScript(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(parts...)
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(blob)
}

func TestBootstrapInstallsThePinnedCheckedRelease(t *testing.T) {
	script := readScript(t, "..", "..", "..", "scripts", "bootstrap-hysteria.sh")

	if !strings.Contains(script, "# >>> core-pins:hysteria >>>") {
		t.Fatal("bootstrap-hysteria.sh carries no generated hysteria block")
	}
	if !strings.Contains(script, `HYSTERIA_VERSION="${HYSTERIA_VERSION:-$HYSTERIA_PINNED_VERSION}"`) {
		t.Error("the script declares a pin but does not default to it")
	}
	// GitHub is not asked what is latest: a release resolved on the day has no
	// checksum to be held to.
	if strings.Contains(script, "releases/latest") {
		t.Error("bootstrap-hysteria.sh still asks GitHub for the latest release")
	}
	// The file name comes from the manifest. Built by hand it asked for
	// hysteria-linux-armv7, which upstream does not publish (its armv7 build is
	// hysteria-linux-arm), and every armv7 install died on a 404.
	if !strings.Contains(script, `ASSET="${HYSTERIA_PINNED_FILE[$HY_ARCH]:-}"`) ||
		strings.Contains(script, "hysteria-linux-${HY_ARCH}") {
		t.Error("the download has to take its file name from the manifest block")
	}
	if !strings.Contains(script, "sha256sum") || !strings.Contains(script, "checksum mismatch") {
		t.Error("the binary is not verified against the pinned sha256")
	}
}

// The OTHER road to the same binary: a node built with --protocol hysteria
// never runs bootstrap-hysteria.sh. The main installer hands upstream's
// install_server.sh a file it downloaded and checked itself, with --local;
// given --version instead, the script downloads on its own and checks nothing.
func TestNodeInstallerHandsUpstreamTheCheckedBinary(t *testing.T) {
	script := readScript(t, "..", "..", "..", "..", "..", "scripts", "install-iceslab-node.sh")

	if !strings.Contains(script, "# >>> core-pins:hysteria >>>") {
		t.Fatal("install-iceslab-node.sh carries no generated hysteria block")
	}
	if !strings.Contains(script, `fetch_hysteria "$HY_BIN"`) ||
		!strings.Contains(script, `bash "$HY_TMP" --local "$HY_BIN"`) {
		t.Error("the installer must download and check hysteria itself, then install it with --local")
	}
	if strings.Contains(script, `bash "$HY_TMP" --version`) {
		t.Error("the installer still lets upstream's script download hysteria unchecked")
	}
}
