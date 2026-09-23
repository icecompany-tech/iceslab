package hysteria

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The version a node runs is pinned in bootstrap-hysteria.sh, and from phase 6
// on this adapter renders a config shape that was MEASURED against exactly that
// release: the socks5 outbound that hands users to the chain, with no acl, is
// taken as the default only because 2.12.3 was asked on 2026-09-23 and routed
// through the first outbound in the array. The two have to be told about each
// other, or the pin moves and nobody re-asks the binary.
const pinnedHysteriaVersion = "v2.12.3"

// TestBootstrapPinsTheVersion keeps the installer honest.
//
// It resolved `latest` from the GitHub API, and it was the only engine installer
// here that still did after sing-box and xray were pinned. A fleet installed
// across two weeks ended up on two hysteria releases, and a rendered config
// could be correct on one node and refused on the next.
//
// ⚠ This test reads a file outside its package, so `go test` caches its PASS
// across edits to that file. Run it with -count=1 locally; CI has no cache.
func TestBootstrapPinsTheVersion(t *testing.T) {
	path := filepath.Join("..", "..", "..", "scripts", "bootstrap-hysteria.sh")
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	script := string(blob)

	want := `HYSTERIA_PINNED_VERSION="` + pinnedHysteriaVersion + `"`
	if !strings.Contains(script, want) {
		t.Fatalf("installer does not pin %s.\n"+
			"If the pin moved on purpose, move pinnedHysteriaVersion here too and\n"+
			"re-ask the new binary what the chain hand-off needs (which outbound it\n"+
			"takes without an acl): this constant is the only thing tying the two\n"+
			"together.", pinnedHysteriaVersion)
	}

	// The default has to BE the pin. A script that declares the pin and then
	// resolves latest anyway is the old behaviour with a comment on top.
	if !strings.Contains(script, `HYSTERIA_VERSION="${HYSTERIA_VERSION:-$HYSTERIA_PINNED_VERSION}"`) {
		t.Fatal("installer declares a pin but does not default to it")
	}

	// GitHub is asked only when somebody passes the literal `latest`. Checked by
	// position: the API call must sit after the branch that tests for it, or a
	// refactor could hoist it back to the top and resolve latest on every run.
	api := strings.Index(script, "api.github.com/repos/apernet/hysteria/releases/latest")
	branch := strings.Index(script, `if [[ "$HYSTERIA_VERSION" == "latest" ]]`)
	if api == -1 || branch == -1 || api < branch {
		t.Fatal("the latest-release lookup must live inside the explicit `latest` branch, and only there")
	}
}

// TestCIAsksThePinnedEngine holds the third copy of the number: the binary CI
// downloads to ask whether this adapter's render loads. A CI on another release
// would answer for an engine no node runs, which is the same drift one step
// removed: green in CI, refused on the fleet.
func TestCIAsksThePinnedEngine(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "..", ".github", "workflows", "ci.yml")
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	want := "releases/download/app%2F" + pinnedHysteriaVersion + "/hysteria-linux-amd64"
	if !strings.Contains(string(blob), want) {
		t.Fatalf("ci.yml does not install hysteria %s for the engine tests", pinnedHysteriaVersion)
	}
}

// TestNodeInstallerPinsTheSameVersion holds the OTHER road to the same binary.
//
// A node built with --protocol hysteria never runs bootstrap-hysteria.sh: the
// main installer fetches upstream's install_server.sh and passes it
// HYSTERIA_VERSION, which defaulted to EMPTY, and upstream reads empty as
// latest. So pinning only the bootstrap script would have pinned the path used
// when a core is added later and left every freshly built hysteria node on
// whatever GitHub said that day. Two files, one release, one constant here.
func TestNodeInstallerPinsTheSameVersion(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "..", "scripts", "install-iceslab-node.sh")
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	want := `HYSTERIA_VERSION=${HYSTERIA_VERSION:-` + pinnedHysteriaVersion + `}`
	if !strings.Contains(string(blob), want) {
		t.Fatalf("install-iceslab-node.sh does not default HYSTERIA_VERSION to %s.\n"+
			"An empty default is read by upstream's install_server.sh as latest,\n"+
			"which is exactly the drift the pin in bootstrap-hysteria.sh closes.",
			pinnedHysteriaVersion)
	}
}
