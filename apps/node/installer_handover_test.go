package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// A-282: both installers hand over to the installer of the ref they are asked
// to install, before they touch anything. The handover is cut out of each
// installer and run in bash with curl replaced by a stand-in that serves the
// "other" installer (or fails), so nothing leaves the machine.
//
// ⚠ Reads files outside the package: `go test -count=1` locally. Needs bash.

var installers = map[string]string{
	"install-iceslab.sh":      "../../scripts/install-iceslab.sh",
	"install-iceslab-node.sh": "../../scripts/install-iceslab-node.sh",
}

// handoverSection is the installer from ICESLAB_SCRIPT_REF to the end of
// handover_to_ref: the version and the function, without the call.
func handoverSection(t *testing.T, path string) string {
	t.Helper()
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := string(blob)
	start := strings.Index(s, "\nICESLAB_SCRIPT_REF=")
	fn := strings.Index(s, "\nhandover_to_ref() {\n")
	if start == -1 || fn == -1 || fn < start {
		t.Fatalf("%s: the handover is not where this test looks", path)
	}
	end := strings.Index(s[fn:], "\n}\n")
	return s[start : fn+end+3]
}

type handoverRun struct {
	out, calls string
	err        error
}

// runHandover calls handover_to_ref of the installer at path with ref and
// repo, the arguments `--a "b c"`, ICESLAB_REF_SHA set and "hello" on stdin.
// curlExit and body are what the stand-in curl does.
func runHandover(t *testing.T, path, ref, repo, scriptPath string, curlExit int, body, extraEnv string) handoverRun {
	t.Helper()
	bash := needBash(t)
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	calls := filepath.Join(dir, "calls")
	served := filepath.Join(dir, "served")
	if err := os.WriteFile(served, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	curl := "#!/usr/bin/env bash\necho \"curl $*\" >>\"$CALLS\"\nout=''\nwhile [[ $# -gt 0 ]]; do [[ \"$1\" == -o ]] && { out=\"$2\"; shift; }; shift; done\n" +
		"[[ \"$CURL_EXIT\" == 0 ]] || exit \"$CURL_EXIT\"\ncp \"$SERVED\" \"$out\"\n"
	if err := os.WriteFile(filepath.Join(bin, "curl"), []byte(curl), 0o755); err != nil {
		t.Fatal(err)
	}
	prog := "set -euo pipefail\nlog() { echo \"log: $*\"; }\nfail() { echo \"fail: $*\"; exit 1; }\n" +
		handoverSection(t, path) + "\n" +
		"handover_to_ref '" + ref + "' '" + repo + "' " + scriptPath + " \"$@\"\necho continued\n"
	cmd := exec.Command(bash, "-c", prog, "installer", "--a", "b c")
	cmd.Env = []string{
		"PATH=" + bin + ":/usr/bin:/bin", "TMPDIR=" + dir, "CALLS=" + calls, "SERVED=" + served,
		"CURL_EXIT=" + strconv.Itoa(curlExit), "ICESLAB_REF_SHA=abc123", "ICESLAB_NODE_REF_SHA=def456",
	}
	if extraEnv != "" {
		cmd.Env = append(cmd.Env, extraEnv)
	}
	cmd.Stdin = strings.NewReader("hello\n")
	out, err := cmd.CombinedOutput()
	c, _ := os.ReadFile(calls)
	return handoverRun{out: string(out), calls: string(c), err: err}
}

// The installer served by the stand-in: says what it was given.
const otherInstaller = "#!/usr/bin/env bash\n" +
	"read -r line\n" +
	"echo \"handed marker=$ICESLAB_HANDOVER args=$1|$2 sha=$ICESLAB_REF_SHA/$ICESLAB_NODE_REF_SHA stdin=$line\"\n"

const repo = "https://github.com/icecompany-tech/iceslab.git"

func TestTheInstallerHandsOverToTheRefItIsAskedFor(t *testing.T) {
	for name, path := range installers {
		own := scriptRef(t, path)
		for _, ref := range []string{"v0.2.1", "main", "develop", "0123456789abcdef0123456789abcdef01234567"} {
			if ref == own {
				continue
			}
			r := runHandover(t, path, ref, repo, "scripts/"+name, 0, otherInstaller, "")
			if r.err != nil {
				t.Fatalf("%s %s: %v\n%s", name, ref, r.err, r.out)
			}
			wantURL := "https://raw.githubusercontent.com/icecompany-tech/iceslab/" + ref + "/scripts/" + name
			if !strings.Contains(r.calls, wantURL) {
				t.Errorf("%s %s: curl was asked for\n%s\nwant %s", name, ref, r.calls, wantURL)
			}
			for _, want := range []string{
				"log: Handing over to the installer of " + ref + " (" + wantURL + ")",
				// The same arguments, the marker, the SHA pins and the terminal.
				"handed marker=" + ref + " args=--a|b c sha=abc123/def456 stdin=hello",
			} {
				if !strings.Contains(r.out, want) {
					t.Errorf("%s %s: the output lacks %q:\n%s", name, ref, want, r.out)
				}
			}
			if strings.Contains(r.out, "continued") {
				t.Errorf("%s %s: this installer went on after handing over:\n%s", name, ref, r.out)
			}
		}
	}
}

func TestTheInstallerOfItsOwnRefAndTheHandedOverOneDoNotHandOver(t *testing.T) {
	for name, path := range installers {
		own := scriptRef(t, path)
		for label, c := range map[string]struct{ ref, env string }{
			"its own ref":    {own, ""},
			"the second run": {"v0.2.1", "ICESLAB_HANDOVER=v0.2.1"},
			"turned off":     {"v0.2.1", "ICESLAB_HANDOVER=off"},
		} {
			r := runHandover(t, path, c.ref, repo, "scripts/"+name, 0, otherInstaller, c.env)
			if r.err != nil || r.calls != "" || strings.TrimSpace(r.out) != "continued" {
				t.Errorf("%s, %s: want no handover, got %v, curl %q:\n%s", name, label, r.err, r.calls, r.out)
			}
		}
	}
}

func TestAnInstallerThatCannotBeFetchedStopsTheInstall(t *testing.T) {
	for name, path := range installers {
		for label, c := range map[string]struct {
			repo     string
			curlExit int
			body     string
			says     string
		}{
			"curl fails":   {repo, 22, "", "could not be fetched from https://raw.githubusercontent.com/icecompany-tech/iceslab/v0.2.1/scripts/" + name},
			"not a script": {repo, 0, "<!DOCTYPE html>404", "is not an installer script"},
			"not GitHub":   {"https://git.example.net/me/iceslab.git", 0, otherInstaller, "not a GitHub repository"},
		} {
			r := runHandover(t, path, "v0.2.1", c.repo, "scripts/"+name, c.curlExit, c.body, "")
			if r.err == nil {
				t.Errorf("%s, %s: exit 0:\n%s", name, label, r.out)
			}
			if !strings.Contains(r.out, "fail: ") || !strings.Contains(r.out, c.says) {
				t.Errorf("%s, %s: the refusal lacks %q:\n%s", name, label, c.says, r.out)
			}
			if strings.Contains(r.out, "continued") || strings.Contains(r.out, "handed") {
				t.Errorf("%s, %s: went on after the refusal:\n%s", name, label, r.out)
			}
		}
	}
	// A fork's URL in either spelling names the same repository.
	for _, spelt := range []string{"https://github.com/me/fork", "https://github.com/me/fork.git", "https://github.com/me/fork/"} {
		r := runHandover(t, installers["install-iceslab.sh"], "v0.2.1", spelt, "scripts/install-iceslab.sh", 0, otherInstaller, "")
		if !strings.Contains(r.calls, "https://raw.githubusercontent.com/me/fork/v0.2.1/scripts/install-iceslab.sh") {
			t.Errorf("%s: curl was asked for %q", spelt, r.calls)
		}
	}
}

// One function, one version, in both installers: they are released together.
// The version is the release's own (package.json on the tag, build metadata
// such as +dev left out), so a bump that forgets it fails here and not on
// every operator's install, where a stale one would hand over on each run.
func TestBothInstallersCarryTheSameHandoverAndTheReleaseVersion(t *testing.T) {
	a := handoverSection(t, installers["install-iceslab.sh"])
	b := handoverSection(t, installers["install-iceslab-node.sh"])
	fnA := a[strings.Index(a, "\nhandover_to_ref() {"):]
	fnB := b[strings.Index(b, "\nhandover_to_ref() {"):]
	if fnA != fnB {
		t.Error("handover_to_ref differs between the two installers")
	}
	refA, refB := scriptRef(t, installers["install-iceslab.sh"]), scriptRef(t, installers["install-iceslab-node.sh"])
	if refA != refB {
		t.Errorf("ICESLAB_SCRIPT_REF: panel installer %s, node installer %s", refA, refB)
	}
	for _, pkg := range []string{"../panel-backend/package.json", "../panel-frontend/package.json"} {
		blob, err := os.ReadFile(pkg)
		if err != nil {
			t.Fatal(err)
		}
		var p struct{ Version string }
		if err := json.Unmarshal(blob, &p); err != nil {
			t.Fatal(err)
		}
		release := "v" + strings.SplitN(p.Version, "+", 2)[0]
		if refA != release {
			t.Errorf("ICESLAB_SCRIPT_REF is %s, %s says %s (RELEASING §4b: bump both)", refA, pkg, release)
		}
	}
}

// The handover comes before the installer touches anything: the lock, apt,
// the bootstrap token.
func TestTheHandoverRunsBeforeAnythingIsTouched(t *testing.T) {
	for name, path := range installers {
		blob, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		s := string(blob)
		call := regexp.MustCompile(`(?m)^handover_to_ref "\$ICESLAB_(NODE_)?REF" "\$ICESLAB_(NODE_)?REPO" scripts/` + regexp.QuoteMeta(name) + ` "\$@"$`).FindStringIndex(s)
		if call == nil {
			t.Fatalf("%s: no handover call", name)
		}
		for _, later := range []string{"\nbanner\n", "\nexec 9>", "\nwait_for_apt\n", "apt-get"} {
			i := strings.Index(s, later)
			if i == -1 || i < call[0] {
				t.Errorf("%s: %q comes before the handover", name, strings.TrimSpace(later))
			}
		}
	}
}

func scriptRef(t *testing.T, path string) string {
	t.Helper()
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?m)^ICESLAB_SCRIPT_REF="([^"]+)"$`).FindSubmatch(blob)
	if m == nil {
		t.Fatalf("%s: no ICESLAB_SCRIPT_REF", path)
	}
	return string(m[1])
}
