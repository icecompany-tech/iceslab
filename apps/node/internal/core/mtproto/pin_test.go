package mtproto

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Which mtg a node installs, pinned, with the release's sha256 per arch. The
// bootstrap used to take GitHub's latest and skip any node that already had
// some mtg, so the fleet held one release per install date.
//
// ⚠ Reads a file outside the package: `go test -count=1` locally, the cache
// keeps an old PASS across edits to the script.
const pinnedMtgVersion = "2.2.8"

func TestBootstrapPinsMtgWithChecksums(t *testing.T) {
	path := filepath.Join("..", "..", "..", "scripts", "bootstrap-mtg.sh")
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	script := string(blob)

	if !strings.Contains(script, `MTG_PINNED_VERSION="`+pinnedMtgVersion+`"`) {
		t.Fatalf("bootstrap-mtg.sh does not pin %s; if it moved on purpose, move pinnedMtgVersion too", pinnedMtgVersion)
	}
	if strings.Contains(script, "releases/latest") {
		t.Error("bootstrap-mtg.sh still asks GitHub for the latest release")
	}
	for _, arch := range []string{"amd64", "arm64", "armv7"} {
		re := regexp.MustCompile(`\[` + arch + `\]="[0-9a-f]{64}"`)
		if !re.MatchString(script) {
			t.Errorf("no sha256 pinned for %s", arch)
		}
	}
	// The checksum has to be CHECKED, not only written down.
	if !strings.Contains(script, "sha256sum") || !strings.Contains(script, "checksum mismatch") {
		t.Error("the tarball is not verified against the pinned sha256")
	}
}
