package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Ф7.1: bootstrap-amneziawg installs the 3.1 module and records what it built,
// because both module generations call themselves 1.0.0 (Ф7.0 on se-02).
//
// ⚠ Reads files outside the package: `go test -count=1` locally. Needs bash.

func TestTheAmneziawgBlockCarriesTheModuleTheBootstrapBuilt(t *testing.T) {
	bash := needBash(t)
	dir := t.TempDir()
	env := filepath.Join(dir, "env")
	marker := filepath.Join(dir, "amneziawg-module")
	body := wiring(t, readScript(t, "bootstrap-amneziawg.sh"))

	run := func() string {
		if err := os.WriteFile(env, []byte("NODE_PAYLOAD=x\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		lib, _ := filepath.Abs(filepath.Join("scripts", "lib", "node-env.sh"))
		prog := "set -euo pipefail\nlog() { :; }\nwarn() { :; }\n. '" + lib + "'\n" + body + "\nwire_env\n"
		cmd := exec.Command(bash, "-c", prog)
		cmd.Env = []string{"PATH=/usr/bin:/bin", "ICESLAB_NODE_ENV=" + env, "AWG_MODULE_MARKER=" + marker}
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, out)
		}
		b, _ := os.ReadFile(env)
		return string(b)
	}

	// A node from before Ф7.1: no marker, the two binaries only.
	got := run()
	if strings.Contains(got, "AMNEZIAWG_MODULE_") {
		t.Errorf("no build recorded, yet the block claims a module:\n%s", got)
	}

	if err := os.WriteFile(marker, []byte("v3.1.20260906 7EB84CCAD4C5015BF2AF6A1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got = run()
	for _, want := range []string{
		"AMNEZIAWG_MODULE_VERSION=3.1.20260906\n",
		"AMNEZIAWG_MODULE_SRCVERSION=7EB84CCAD4C5015BF2AF6A1\n",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the block lacks %q:\n%s", want, got)
		}
	}
}

func TestSecureBootIsRefusedBeforeAnythingIsBuilt(t *testing.T) {
	fn := shellFunc(t, "bootstrap-amneziawg.sh", "secure_boot_on")
	for _, c := range []struct {
		name, mokutil string
		efi           bool
		on            bool
	}{
		{"no EFI at all", "", false, false},
		{"mokutil says enabled", "SecureBoot enabled\n", true, true},
		{"mokutil says disabled", "SecureBoot disabled\n", true, false},
	} {
		efi := filepath.Join(t.TempDir(), "efi")
		if c.efi {
			if err := os.MkdirAll(filepath.Join(efi, "efivars"), 0o755); err != nil {
				t.Fatal(err)
			}
		}
		stubsDir := stubs(t, map[string]string{"mokutil": "printf '" + strings.ReplaceAll(c.mokutil, "\n", `\n`) + "'\n"})
		out, err := runBash(t, stubsDir, "set -euo pipefail\nEFI_DIR='"+efi+"'\n"+fn+"\nif secure_boot_on; then echo ON; else echo OFF; fi\n")
		if err != nil {
			t.Fatalf("%s: %v\n%s", c.name, err, out)
		}
		if got := strings.TrimSpace(out) == "ON"; got != c.on {
			t.Errorf("%s: secure_boot_on = %v, want %v", c.name, got, c.on)
		}
	}
	// And the check stands before the build, with words that say what to do.
	script := readScript(t, "bootstrap-amneziawg.sh")
	sb := strings.Index(script, "if secure_boot_on; then")
	build := strings.Index(script, `dkms build "amneziawg/`)
	if sb == -1 || build == -1 || sb > build {
		t.Error("the Secure Boot check does not come before the module build")
	}
	if !strings.Contains(script, "Secure Boot is on: the amneziawg module this script builds is unsigned") {
		t.Error("the Secure Boot refusal lost its words")
	}
}
