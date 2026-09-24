package xray

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// How xray gets onto a node: one script, bootstrap-xray.sh, for a fresh install
// (the xray and the shadowsocks protocol) and for moving a live node.
//
// WHICH xray, and the ceiling it must stay under (26.9.8 and later refuse every
// leg a sing-box chain dials, REALITY wants X25519MLKEM768), live in the version
// manifest, packages/shared/src/core-versions.ts, and reach the script as a
// generated block; apps/panel-backend/src/lib/util/core-pins.test.ts holds the
// block to the manifest. This test used to keep its own copy of the pin and of
// the ceiling, a second place to forget. What is left here is what the manifest
// cannot see: that the script USES the pin and checks what it installs, and that
// nothing else installs xray.
//
// ⚠ Reads files outside the package: `go test -count=1` locally.
const (
	installerRelPath = "../../../../../scripts/install-iceslab-node.sh"
	bootstrapRelPath = "../../../scripts/bootstrap-xray.sh"
)

func readFile(t *testing.T, rel string) string {
	t.Helper()
	blob, err := os.ReadFile(filepath.Clean(rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(blob)
}

func TestBootstrapDefaultsToTheManifestPin(t *testing.T) {
	script := readFile(t, bootstrapRelPath)
	if !strings.Contains(script, "# >>> core-pins:xray >>>") {
		t.Fatal("bootstrap-xray.sh carries no generated xray block")
	}
	// An empty default would mean "latest", which is the thing being closed.
	if !strings.Contains(script, `XRAY_VERSION="${XRAY_VERSION:-$XRAY_PINNED_VERSION}"`) {
		t.Error("XRAY_VERSION does not default to the pin from the generated block")
	}
	for _, pair := range []string{
		"pair_or_fail XRAY_VERSION XRAY_SHA256",
		"pair_or_fail XRAY_INSTALLER_REF XRAY_INSTALLER_SHA",
	} {
		if !strings.Contains(script, pair) {
			t.Errorf("an override without its checksum is not refused: %q is gone", pair)
		}
	}
}

// Both files are checked: the release zip against the manifest's sha256, and
// upstream's install-release.sh against the sha256 of the pinned commit. Then
// the checked zip goes in through --local; left to itself, `install --version`
// fetches whatever that version resolves to.
func TestBootstrapInstallsOnlyCheckedFiles(t *testing.T) {
	script := readFile(t, bootstrapRelPath)
	for _, want := range []string{
		`ZIP_NAME="${XRAY_PINNED_FILE[$XR_ARCH]:-}"`,
		`[[ "$GOT_SHA" == "$WANT_SHA" ]]`,
		`[[ "$GOT_SHA" == "$XRAY_INSTALLER_SHA" ]]`,
		`install --local "$TMP/xray.zip" </dev/null`,
	} {
		if !strings.Contains(script, want) {
			t.Errorf("bootstrap-xray.sh lost %q", want)
		}
	}
	if regexp.MustCompile(`install --version`).MatchString(script) {
		t.Error("bootstrap-xray.sh lets upstream download xray unchecked")
	}
	if !regexp.MustCompile(`XRAY_INSTALLER_PINNED_SHA="[0-9a-f]{64}"`).MatchString(script) {
		t.Error("the pinned install-release.sh has no sha256")
	}
}

// On a live node upstream's script reads the agent's running xray as its own
// service and starts xray.service again at the end, on the config the agent's
// xray holds the ports of. The agent is stopped for the install and brought
// back by the trap, whatever happens; and the script's exit status is not
// trusted, the binary is asked.
func TestBootstrapIsSafeOnALiveNode(t *testing.T) {
	script := readFile(t, bootstrapRelPath)
	for _, want := range []string{
		"systemctl stop iceslab-node",
		"trap cleanup EXIT",
		"systemctl start iceslab-node",
		"systemctl disable xray.service",
		`[[ "$VERSION" == "$XRAY_VERSION" ]]`,
	} {
		if !strings.Contains(script, want) {
			t.Errorf("bootstrap-xray.sh lost %q", want)
		}
	}
	// The node's identity is not the bootstrap's to touch. Since E20 it writes
	// its own block of the agent's env, through lib/node-env.sh and nothing
	// else: no payload, no keys, no line of the env file by hand.
	if strings.Contains(script, "NODE_PAYLOAD") ||
		regexp.MustCompile(`>>?\s*"?(/etc/iceslab-node|\$ICESLAB_NODE_ENV)`).MatchString(script) {
		t.Error("bootstrap-xray.sh writes into /etc/iceslab-node by hand")
	}
	if !strings.Contains(script, "node_env_block xray") {
		t.Error("bootstrap-xray.sh no longer wires xray into the agent's env")
	}
}

// One road: the main installer puts xray on through the bootstrap, for the
// xray protocol and for shadowsocks, which runs inside xray-core, and nothing
// in the installer installs xray by itself.
func TestInstallerChainsTheBootstrapAtBothSites(t *testing.T) {
	script := readFile(t, installerRelPath)
	for _, want := range []string{
		"xray|shadowsocks)                       echo xray ;;",
		"xray)      echo bootstrap-xray.sh ;;",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("the installer lost %q: xray and shadowsocks go through bootstrap-xray.sh", want)
		}
	}
	if strings.Contains(script, "install-release.sh") && regexp.MustCompile(`bash "\$XR_TMP"`).MatchString(script) {
		t.Error("the installer still runs install-release.sh itself")
	}
	if strings.Contains(script, "core-pins:xray") {
		t.Error("the installer carries its own xray pin block; the bootstrap is the one place")
	}
}
