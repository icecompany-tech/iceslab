package amneziawg

import (
	"os"
	"path/filepath"
	"testing"
)

// The version on the card is the kernel module's: it speaks the protocol, and
// its tag carries the generation (v1 against v3). Read from the file modinfo
// reads, so no exec on every poll.
func TestCoreVersionIsTheModulesVersion(t *testing.T) {
	file := filepath.Join(t.TempDir(), "version")
	if err := os.WriteFile(file, []byte("1.0.20260611\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	prev := moduleVersionPath
	moduleVersionPath = file
	t.Cleanup(func() { moduleVersionPath = prev })

	a := &Adapter{}
	if got := a.CoreVersion(); got != "1.0.20260611" {
		t.Fatalf("CoreVersion = %q", got)
	}

	moduleVersionPath = filepath.Join(t.TempDir(), "absent")
	if got := a.CoreVersion(); got != "" {
		t.Fatalf("no module, but CoreVersion = %q", got)
	}
}
