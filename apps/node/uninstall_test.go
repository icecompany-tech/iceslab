package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// E41, 25.09 on ru-01: --uninstall left xray, sing-box, hysteria and the AWG
// module on the machine, and the next install found them. --uninstall now stops
// the agent, stops every core, runs each bootstrap's --remove from the checkout
// while it is there, and only then removes the checkout. Run for real: the
// installer's uninstall functions in bash, against a fake checkout whose
// bootstraps note their call, with systemctl, ip, awg-quick, pkill and pgrep
// stubbed.
//
// ⚠ Reads files outside the package: `go test -count=1` locally. Needs bash.

// installerFunc is the definition of `name` in the installer.
func installerFunc(t *testing.T, name string) string {
	t.Helper()
	blob, err := os.ReadFile(installerPath)
	if err != nil {
		t.Fatal(err)
	}
	s := string(blob)
	start := strings.Index(s, "\n"+name+"() {")
	if start == -1 {
		t.Fatalf("the installer has no %s()", name)
	}
	end := strings.Index(s[start:], "\n}\n")
	return s[start : start+end+3]
}

type uninstallRun struct {
	out, calls string
	checkout   string
	err        error
}

// runUninstall: present is the cores core_present answers yes for; failCore's
// --remove exits 1; legacyCore's bootstrap predates --remove.
func runUninstall(t *testing.T, keepCores bool, present, failCore, legacyCore string) uninstallRun {
	t.Helper()
	bash := needBash(t)
	root := t.TempDir()
	checkout := filepath.Join(root, "opt", "iceslab-node")
	scripts := filepath.Join(checkout, "apps", "node", "scripts")
	if err := os.MkdirAll(scripts, 0o755); err != nil {
		t.Fatal(err)
	}
	calls := filepath.Join(root, "calls")
	for engine, name := range bootstraps {
		body := "#!/usr/bin/env bash\n# handles NODE_ENV_REMOVE\n"
		if engine == legacyCore {
			body = "#!/usr/bin/env bash\n# an old bootstrap: any flag is an install\n"
		}
		body += "if [ -d '" + checkout + "' ]; then c=yes; else c=no; fi\n" +
			"echo \"bootstrap " + engine + " $* checkout=$c\" >>'" + calls + "'\n" +
			"echo \"uninstall-flag " + engine + " ${ICESLAB_UNINSTALL:-unset}\" >>'" + calls + "'\n"
		if engine == failCore {
			body += "echo '" + engine + " is running: not removed' >&2; exit 1\n"
		}
		if err := os.WriteFile(filepath.Join(scripts, name), []byte(body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	note := `echo "$(basename "$0") $*" >>'` + calls + "'\n"
	bin := stubs(t, map[string]string{
		"systemctl": note,
		"awg-quick": note,
		"pkill":     note,
		"pgrep":     "exit 1\n",
		"ip":        note + `if [ "$1" = -o ]; then echo '7: awg0: <POINTOPOINT,NOARP,UP> mtu 1420'; echo '9: awg-l1: <POINTOPOINT,NOARP,UP> mtu 1420'; fi` + "\n",
	})
	keep := "0"
	if keepCores {
		keep = "1"
	}
	prog := "set -euo pipefail\n" +
		"log() { echo \"log: $*\"; echo \"log: $*\" >>'" + calls + "'; }\nwarn() { echo \"warn: $*\"; }\nfail() { echo \"fail: $*\"; exit 1; }\n" +
		"KNOWN_ENGINES=\"xray singbox hysteria amneziawg mtproto mieru naive\"\n" +
		"CORE_PROCESSES=\"xray sing-box hysteria mtg caddy-naive mita\"\n" +
		installerFunc(t, "bootstrap_of") + installerFunc(t, "stop_cores") + installerFunc(t, "remove_cores") +
		installerFunc(t, "do_uninstall") + installerFunc(t, "uninstall_all") +
		// After the installer's own: what is on this fake machine.
		"core_present() { [[ \" " + present + " \" == *\" $1 \"* ]]; }\n" +
		"ICESLAB_NODE_DIR='" + checkout + "'\nNODE_PORT=9443\nKEEP_CORES=" + keep + "\n" +
		"uninstall_all\n"
	cmd := exec.Command(bash, "-c", prog)
	cmd.Env = []string{"PATH=" + bin + ":/usr/bin:/bin"}
	out, err := cmd.CombinedOutput()
	c, _ := os.ReadFile(calls)
	return uninstallRun{out: string(out), calls: string(c), checkout: checkout, err: err}
}

// at is the line of the first call starting with prefix, -1 when none.
func at(calls, prefix string) int {
	for i, line := range strings.Split(calls, "\n") {
		if strings.HasPrefix(line, prefix) {
			return i
		}
	}
	return -1
}

func TestUninstallStopsThenRemovesThenDeletesTheCheckout(t *testing.T) {
	r := runUninstall(t, false, "xray hysteria amneziawg", "", "")
	if r.err != nil {
		t.Fatalf("%v\n%s", r.err, r.out)
	}
	order := []string{
		"systemctl stop iceslab-node",
		"systemctl stop hysteria",
		"awg-quick down awg0",
		"pkill -TERM -x xray",
		"bootstrap xray --remove",
		"log: Removing source checkout",
	}
	last := -1
	for _, step := range order {
		i := at(r.calls, step)
		if i == -1 || i < last {
			t.Fatalf("%q missing or out of order (line %d after %d):\n%s", step, i, last, r.calls)
		}
		last = i
	}
	// The cascade leg's tunnel comes down too, and a --remove never runs
	// without the checkout it lives in.
	if at(r.calls, "awg-quick down awg-l1") == -1 {
		t.Errorf("the cascade leg's interface was left up:\n%s", r.calls)
	}
	for _, line := range strings.Split(r.calls, "\n") {
		if strings.HasPrefix(line, "bootstrap ") && !strings.HasSuffix(line, "--remove checkout=yes") {
			t.Errorf("a bootstrap ran without --remove or without its checkout: %q", line)
		}
	}
	// Every bootstrap is asked, present or not: a --remove of nothing sweeps
	// what an older install left.
	for engine := range bootstraps {
		if at(r.calls, "bootstrap "+engine+" --remove") == -1 {
			t.Errorf("%s's --remove did not run", engine)
		}
	}
	// Each --remove knows it is part of a whole uninstall, so it keeps quiet
	// about the cores that are about to go anyway.
	for engine := range bootstraps {
		if at(r.calls, "uninstall-flag "+engine+" 1") == -1 {
			t.Errorf("%s's --remove ran without ICESLAB_UNINSTALL=1:\n%s", engine, r.calls)
		}
	}
	if _, err := os.Stat(r.checkout); !os.IsNotExist(err) {
		t.Errorf("the checkout is still there: %v", err)
	}
	if !strings.Contains(r.out, "Removed: agent, xray, hysteria, amneziawg; kept: none") {
		t.Errorf("summary:\n%s", r.out)
	}
}

func TestUninstallSaysWhichCoreStayedAndWhy(t *testing.T) {
	r := runUninstall(t, false, "xray hysteria singbox", "hysteria", "singbox")
	if r.err != nil {
		t.Fatalf("a refused --remove ended the uninstall: %v\n%s", r.err, r.out)
	}
	// A bootstrap from before --remove would take the flag for an install.
	if at(r.calls, "bootstrap singbox") != -1 {
		t.Errorf("an old bootstrap was run, it would have installed the core again:\n%s", r.calls)
	}
	want := "Removed: agent, xray; kept: singbox (the checkout predates --remove), hysteria (its --remove refused, see above)"
	if !strings.Contains(r.out, want) {
		t.Errorf("summary, want %q:\n%s", want, r.out)
	}
}

func TestKeepCoresTouchesNoCore(t *testing.T) {
	r := runUninstall(t, true, "xray hysteria", "", "")
	if r.err != nil {
		t.Fatalf("%v\n%s", r.err, r.out)
	}
	for _, not := range []string{"bootstrap ", "pkill ", "awg-quick "} {
		if at(r.calls, not) != -1 {
			t.Errorf("--keep-cores ran %q:\n%s", not, r.calls)
		}
	}
	if at(r.calls, "log: Removing source checkout") == -1 {
		t.Errorf("--keep-cores skipped the agent's own uninstall:\n%s", r.calls)
	}
	if !strings.Contains(r.out, "Removed: agent; kept: every core (--keep-cores)") {
		t.Errorf("summary:\n%s", r.out)
	}
}
