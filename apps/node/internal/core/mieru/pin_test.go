package mieru

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Which mita a node installs is the version manifest's, with the release's
// sha256 per arch (the same drift as mtg: latest from GitHub, skipped when
// anything was installed). The script carries it as a generated block, held to
// the manifest by core-pins.test.ts in the backend; this checks the script USES
// the block and the checksum.
//
// ⚠ Reads a file outside the package: `go test -count=1` locally.
func TestBootstrapInstallsThePinnedCheckedRelease(t *testing.T) {
	path := filepath.Join("..", "..", "..", "scripts", "bootstrap-mieru.sh")
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	script := string(blob)

	if !strings.Contains(script, "# >>> core-pins:mita >>>") {
		t.Fatal("bootstrap-mieru.sh carries no generated mita block")
	}
	if !strings.Contains(script, `MIERU_VERSION="${MIERU_VERSION:-$MIERU_PINNED_VERSION}"`) {
		t.Error("the script does not default to the pin")
	}
	if strings.Contains(script, "releases/latest") {
		t.Error("bootstrap-mieru.sh still asks GitHub for the latest release")
	}
	if !strings.Contains(script, `DEB="${MIERU_PINNED_FILE[$M_ARCH]:-}"`) {
		t.Error("the download has to take its file name from the manifest block")
	}
	if !strings.Contains(script, "sha256sum") || !strings.Contains(script, "checksum mismatch") {
		t.Error("the package is not verified against the pinned sha256")
	}
}
