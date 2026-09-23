package mtproto

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Which mtg a node installs is the version manifest's
// (packages/shared/src/core-versions.ts), with the release's sha256 per arch,
// carried by the script as a generated block and held to the manifest by
// core-pins.test.ts in the backend. The bootstrap used to take GitHub's latest
// and skip any node that already had some mtg, so the fleet held one release per
// install date. This checks the script USES the block and the checksum.
//
// ⚠ Reads a file outside the package: `go test -count=1` locally, the cache
// keeps an old PASS across edits to the script.
func TestBootstrapInstallsThePinnedCheckedRelease(t *testing.T) {
	path := filepath.Join("..", "..", "..", "scripts", "bootstrap-mtg.sh")
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	script := string(blob)

	if !strings.Contains(script, "# >>> core-pins:mtg >>>") {
		t.Fatal("bootstrap-mtg.sh carries no generated mtg block")
	}
	if !strings.Contains(script, `MTG_VERSION="${MTG_VERSION:-$MTG_PINNED_VERSION}"`) {
		t.Error("the script does not default to the pin")
	}
	if strings.Contains(script, "releases/latest") {
		t.Error("bootstrap-mtg.sh still asks GitHub for the latest release")
	}
	if !strings.Contains(script, `TARBALL="${MTG_PINNED_FILE[$MTG_ARCH]:-}"`) {
		t.Error("the download has to take its file name from the manifest block")
	}
	// The checksum has to be CHECKED, not only written down.
	if !strings.Contains(script, "sha256sum") || !strings.Contains(script, "checksum mismatch") {
		t.Error("the tarball is not verified against the pinned sha256")
	}
}
