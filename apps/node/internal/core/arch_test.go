package core

import "testing"

// The names are the manifest's (CORE_ARCHES in packages/shared), and the
// scripts map `uname -m` onto the same three. Anything else is unnamed rather
// than guessed.
func TestArchNameUsesTheManifestNames(t *testing.T) {
	cases := []struct{ goarch, machine, want string }{
		{"amd64", "", "amd64"},
		{"arm64", "", "arm64"},
		{"arm", "armv7l", "armv7"},
		{"arm", "armv6l", ""},
		{"arm", "", ""},
		{"386", "", ""},
		{"riscv64", "", ""},
	}
	for _, c := range cases {
		if got := archName(c.goarch, c.machine); got != c.want {
			t.Errorf("archName(%q, %q) = %q, want %q", c.goarch, c.machine, got, c.want)
		}
	}
}
