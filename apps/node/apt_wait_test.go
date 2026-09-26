package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// 26.09 on ru-01: every --uninstall printed four "stale apt lock ... removing"
// lines on a machine where apt never ran. The four files always exist; apt and
// dpkg lock them with fcntl, and the old check deleted any file `fuser` named
// no holder for, which on a machine without psmisc was every file, a running
// unattended-upgrades' included. The lock files are never touched now: the
// installers wait while apt is busy and fail in words when it outlasts the
// wait. Both installers carry the same two functions.
//
// ⚠ Reads files outside the package: `go test -count=1` locally. Needs bash.

var aptInstallers = map[string]string{
	"node":  installerPath,
	"panel": "../../scripts/install-iceslab.sh",
}

func scriptFunc(t *testing.T, path, name string) string {
	t.Helper()
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := string(blob)
	start := strings.Index(s, "\n"+name+"() {")
	if start == -1 {
		t.Fatalf("%s has no %s()", path, name)
	}
	end := strings.Index(s[start:], "\n}\n")
	return s[start : start+end+3]
}

type aptRun struct {
	out, calls string
	err        error
	locks      []string
}

// runAptWait: busyProc is a process pgrep finds; locked is how many calls of
// lslocks list the first lock file (-1: every call); holder is what fuser
// names for it.
func runAptWait(t *testing.T, installer, busyProc string, locked int, holder string) aptRun {
	t.Helper()
	bash := needBash(t)
	dir := t.TempDir()
	calls := filepath.Join(dir, "calls")
	count := filepath.Join(dir, "lslocks-count")
	var locks []string
	for _, n := range []string{"lock-frontend", "lock", "lists-lock", "archives-lock"} {
		p := filepath.Join(dir, n)
		if err := os.WriteFile(p, nil, 0o640); err != nil {
			t.Fatal(err)
		}
		locks = append(locks, p)
	}
	note := `echo "$(basename "$0") $*" >>'` + calls + "'\n"
	bin := stubs(t, map[string]string{
		"pgrep": note + `[ "$2" = '` + busyProc + `' ] && exit 0; exit 1` + "\n",
		"lslocks": `n=$(cat '` + count + `' 2>/dev/null || echo 0); n=$((n+1)); echo $n >'` + count + "'\n" +
			`if [ ` + strconv.Itoa(locked) + ` -lt 0 ] || [ $n -le ` + strconv.Itoa(locked) + ` ]; then echo '` + locks[0] + "'; fi\n",
		"fuser": `[ "$1" = '` + locks[0] + `' ] && [ -n '` + holder + `' ] && echo ' ` + holder + "'; exit 0\n",
		"sleep": note,
		"dpkg":  note,
		"rm":    note,
	})
	prog := "set -euo pipefail\nlog() { echo \"log: $*\"; }\nfail() { echo \"fail: $*\"; exit 1; }\n" +
		"APT_LOCKS='" + strings.Join(locks, " ") + "'\nAPT_WAIT_SECONDS=10\n" +
		scriptFunc(t, aptInstallers[installer], "apt_busy") + scriptFunc(t, aptInstallers[installer], "wait_for_apt") +
		"wait_for_apt\necho DONE\n"
	cmd := exec.Command(bash, "-c", prog)
	cmd.Env = []string{"PATH=" + bin + ":/usr/bin:/bin"}
	out, err := cmd.CombinedOutput()
	c, _ := os.ReadFile(calls)
	return aptRun{out: string(out), calls: string(c), err: err, locks: locks}
}

func assertLocksKept(t *testing.T, r aptRun) {
	t.Helper()
	for _, l := range r.locks {
		if _, err := os.Stat(l); err != nil {
			t.Errorf("a lock file was removed: %s", l)
		}
	}
	if strings.Contains(r.calls, "rm ") {
		t.Errorf("rm ran:\n%s", r.calls)
	}
}

func TestAnUnheldAptLockIsLeftAloneAndDpkgFinishesItsWork(t *testing.T) {
	for name := range aptInstallers {
		r := runAptWait(t, name, "", 0, "")
		if r.err != nil || !strings.Contains(r.out, "DONE") {
			t.Fatalf("%s: %v\n%s", name, r.err, r.out)
		}
		assertLocksKept(t, r)
		if strings.Contains(r.out, "stale") || strings.Contains(r.out, "busy") {
			t.Errorf("%s: a quiet machine got a lock message:\n%s", name, r.out)
		}
		if !strings.Contains(r.calls, "dpkg --configure -a") {
			t.Errorf("%s: dpkg --configure -a did not run on a quiet machine:\n%s", name, r.calls)
		}
	}
}

func TestAHeldAptLockIsWaitedForAndNeverRemoved(t *testing.T) {
	for name := range aptInstallers {
		for _, c := range []struct {
			what, proc, holder string
			locked             int
			says               string
		}{
			{"lslocks", "", "", -1, "lock-frontend is locked"},
			{"a running unattended-upgrades", "unattended-upgr", "", 0, "unattended-upgr is running"},
			{"fuser", "", "4242", 0, "is held by pid 4242"},
		} {
			r := runAptWait(t, name, c.proc, c.locked, c.holder)
			if r.err == nil || !strings.Contains(r.out, "fail: apt busy") || !strings.Contains(r.out, c.says) {
				t.Errorf("%s, %s: want a refusal naming %q, got %v\n%s", name, c.what, c.says, r.err, r.out)
			}
			assertLocksKept(t, r)
			if strings.Contains(r.calls, "dpkg ") {
				t.Errorf("%s, %s: dpkg ran beside a busy apt:\n%s", name, c.what, r.calls)
			}
			if !strings.Contains(r.calls, "sleep 5") {
				t.Errorf("%s, %s: no wait before the refusal:\n%s", name, c.what, r.calls)
			}
		}
	}
}

func TestAnAptThatFinishesWhileWaitedForLetsTheInstallGoOn(t *testing.T) {
	for name := range aptInstallers {
		r := runAptWait(t, name, "", 1, "") // locked on the first look only
		if r.err != nil || !strings.Contains(r.out, "DONE") || !strings.Contains(r.out, "waiting up to 10s") {
			t.Fatalf("%s: %v\n%s", name, r.err, r.out)
		}
		assertLocksKept(t, r)
		if !strings.Contains(r.calls, "dpkg --configure -a") {
			t.Errorf("%s: dpkg did not run after apt finished:\n%s", name, r.calls)
		}
	}
}
