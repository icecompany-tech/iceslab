package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// E31, 25.09 on nl-01 (Ubuntu 26.04): dpkg installed mita 3.37.0 into
// /usr/bin, and the smoke test asked /usr/local/bin/mita, which was never
// there: "installed mita reports 'nothing'". The version now comes from the
// package database and `mita version` only confirms, waited for. These run the
// script's own functions in bash against stand-ins for dpkg-query and mita.
//
// ⚠ Reads files outside the package: `go test -count=1` locally. Needs bash.

// mieruProbe is bootstrap-mieru.sh from mita_bin() to the end of
// binary_version(): the functions that say which mita is installed.
func mieruProbe(t *testing.T) string {
	t.Helper()
	s := readScript(t, "bootstrap-mieru.sh")
	start := strings.Index(s, "\nmita_bin() {")
	last := strings.Index(s, "\nbinary_version() {")
	if start == -1 || last == -1 {
		t.Fatal("the version probe of bootstrap-mieru.sh is not where this test looks")
	}
	end := strings.Index(s[last:], "\n}\n")
	return s[start : last+end+3]
}

// probe runs installed_version and binary_version with dpkg-query answering
// `dpkg` (exit 1 when empty: the package is not installed) and a mita on PATH
// that prints `says` to `mita version`.
func probe(t *testing.T, dpkg, says string) (installed, binary string) {
	t.Helper()
	bash := needBash(t)
	bin := t.TempDir()
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/sh\n"+body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if dpkg == "" {
		write("dpkg-query", "exit 1\n")
	} else {
		write("dpkg-query", "printf '%s' '"+dpkg+"'\n")
	}
	write("mita", "printf '%s' '"+says+"'\n")
	prog := "set -euo pipefail\nINSTALL_DIR=/nonexistent\nMITA_VERSION_WAIT=1\n" + mieruProbe(t) +
		"\necho \"installed=$(installed_version)\"\necho \"binary=$(binary_version)\"\n"
	cmd := exec.Command(bash, "-c", prog)
	cmd.Env = []string{"PATH=" + bin + ":/usr/bin:/bin"}
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	for _, line := range strings.Split(string(out), "\n") {
		if v, ok := strings.CutPrefix(line, "installed="); ok {
			installed = v
		}
		if v, ok := strings.CutPrefix(line, "binary="); ok {
			binary = v
		}
	}
	return installed, binary
}

func TestMitaVersionComesFromThePackageDatabase(t *testing.T) {
	// nl-01: the package is there and mita said nothing in time.
	if got, says := probe(t, "3.37.0", ""); got != "3.37.0" || says != "" {
		t.Errorf("dpkg 3.37.0, silent mita: installed %q, binary %q", got, says)
	}
	// Epoch and Debian revision are not part of the version.
	if got, _ := probe(t, "1:3.37.0-1ubuntu2", ""); got != "3.37.0" {
		t.Errorf("dpkg 1:3.37.0-1ubuntu2: %q", got)
	}
	// Not installed: empty, which the script reads as "install it".
	if got, _ := probe(t, "", ""); got != "" {
		t.Errorf("no package: %q", got)
	}
}

func TestMitaVersionIsReadOffWhateverTheBinaryPrints(t *testing.T) {
	for _, says := range []string{"3.37.0", "mieru version 3.37.0\n", "mita 3.37.0 (go1.25)\nbuilt ...\n"} {
		if _, got := probe(t, "3.37.0", says); got != "3.37.0" {
			t.Errorf("mita printing %q: %q", says, got)
		}
	}
}
