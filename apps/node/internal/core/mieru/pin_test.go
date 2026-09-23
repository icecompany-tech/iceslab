package mieru

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Which mita a node installs, pinned, with the release's sha256 per arch (the
// same drift as mtg: latest from GitHub, skipped when anything was installed).
//
// ⚠ Reads a file outside the package: `go test -count=1` locally.
const pinnedMieruVersion = "3.37.0"

func TestBootstrapPinsMitaWithChecksums(t *testing.T) {
	path := filepath.Join("..", "..", "..", "scripts", "bootstrap-mieru.sh")
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	script := string(blob)

	if !strings.Contains(script, `MIERU_PINNED_VERSION="`+pinnedMieruVersion+`"`) {
		t.Fatalf("bootstrap-mieru.sh does not pin %s; if it moved on purpose, move pinnedMieruVersion too", pinnedMieruVersion)
	}
	if strings.Contains(script, "releases/latest") {
		t.Error("bootstrap-mieru.sh still asks GitHub for the latest release")
	}
	// Upstream ships mita for amd64 and arm64 only.
	for _, arch := range []string{"amd64", "arm64"} {
		re := regexp.MustCompile(`\[` + arch + `\]="[0-9a-f]{64}"`)
		if !re.MatchString(script) {
			t.Errorf("no sha256 pinned for %s", arch)
		}
	}
	if !strings.Contains(script, "sha256sum") || !strings.Contains(script, "checksum mismatch") {
		t.Error("the package is not verified against the pinned sha256")
	}
}
