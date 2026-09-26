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

// Ф7.1: both generations' modules say 1.0.0 (Ф7.0 on se-02). The version the
// bootstrap installed is reported, from the env, only while the loaded module
// is that build by srcversion; a swapped module falls back to what /sys says.
func TestCoreVersionIsWhatTheBootstrapBuiltWhileItIsLoaded(t *testing.T) {
	dir := t.TempDir()
	version := filepath.Join(dir, "version")
	src := filepath.Join(dir, "srcversion")
	if err := os.WriteFile(version, []byte("1.0.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src, []byte("7EB84CCAD4C5015BF2AF6A1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	pv, ps := moduleVersionPath, moduleSrcVersionPath
	moduleVersionPath, moduleSrcVersionPath = version, src
	t.Cleanup(func() { moduleVersionPath, moduleSrcVersionPath = pv, ps })

	a := &Adapter{cfg: Config{ModuleVersion: "3.1.20260906", ModuleSrcVersion: "7EB84CCAD4C5015BF2AF6A1"}}
	if got := a.CoreVersion(); got != "3.1.20260906" {
		t.Fatalf("CoreVersion = %q, want the installed 3.1.20260906", got)
	}
	// The 1.x build loaded instead (another srcversion): not the 3.1 claim.
	if err := os.WriteFile(src, []byte("228EEA4FFBDDD0F66070E02\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := a.CoreVersion(); got != "1.0.0" {
		t.Fatalf("a module that is not the build: CoreVersion = %q, want the /sys 1.0.0", got)
	}
	// A node from before Ф7.1: no env, what /sys says.
	if got := (&Adapter{}).CoreVersion(); got != "1.0.0" {
		t.Fatalf("no env: CoreVersion = %q", got)
	}
}

// t07-1: the generation is the major number of the reported module version,
// and 1.0.0 (a raw build of either generation) tells nothing.
func TestAwgProtocolIsTheModulesGeneration(t *testing.T) {
	for _, c := range []struct {
		version string
		want    int
	}{
		{"3.1.20260906", 3}, // the bootstrap's tag, attested by srcversion
		{"3.1.20260812", 3}, // what the DKMS 3.1 build writes to /sys
		{"1.0.20260611", 1}, // the 1.x fleet (ru-01, se-01)
		{"v1.0.20260611", 1},
		{"1.0.0", 0}, // raw build of either generation, and ru-02
		{"2.0.1", 0}, // nothing measured it
		{"", 0},
		{"garbage", 0},
	} {
		if got := awgProtocolOf(c.version); got != c.want {
			t.Errorf("awgProtocolOf(%q) = %d, want %d", c.version, got, c.want)
		}
	}

	file := filepath.Join(t.TempDir(), "version")
	if err := os.WriteFile(file, []byte("1.0.20260611\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	prev := moduleVersionPath
	moduleVersionPath = file
	t.Cleanup(func() { moduleVersionPath = prev })
	if got := (&Adapter{}).AwgProtocol(); got != 1 {
		t.Fatalf("AwgProtocol on a 1.x module = %d", got)
	}
}
