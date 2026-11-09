package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The first admin of a fresh panel (Бк-40): created from inside the backend
// container before the only published port opens, its password in a mode 600
// file and never on stdout or stderr, which the install usually sends through
// tee. docker is a stub here, the script's own decisions are what is under test.
//
// ⚠ Reads files outside the package: `go test -count=1` locally. Needs bash.

const firstAdminScript = "../../scripts/ops/first-admin.sh"

type firstAdminRun struct {
	out      string
	exit     int
	file     string
	fileMode os.FileMode
	posted   string
	// caAsked: the CA step reached the backend.
	caAsked bool
}

// runFirstAdmin runs the script against a stub docker: ca is what the CA step
// prints (created, present, or a failure), status the /api/auth/status answer,
// postCode the register answer.
func runFirstAdmin(t *testing.T, ca, status, postCode string) firstAdminRun {
	t.Helper()
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("needs bash")
	}
	script, err := filepath.Abs(firstAdminScript)
	if err != nil {
		t.Fatal(err)
	}
	root, bin := t.TempDir(), t.TempDir()
	for _, name := range []string{"docker-compose.prod.yml", ".env.production"} {
		if err := os.WriteFile(filepath.Join(root, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	posted := filepath.Join(bin, "posted")
	caMark := filepath.Join(bin, "ca-asked")
	stub := "#!/bin/sh\ncase \"$*\" in\n" +
		"  *bootstrapCa*) : >\"$STUB_CA_MARK\"; printf 'some log line\\n%s\\n' \"$STUB_CA\" ;;\n" +
		"  *wget*) printf '%s' \"$STUB_STATUS\" ;;\n" +
		"  *node*) cat >\"$STUB_POSTED\"; printf '%s\\n' \"$STUB_CODE\" ;;\n" +
		"esac\n"
	if err := os.WriteFile(filepath.Join(bin, "docker"), []byte(stub), 0o755); err != nil {
		t.Fatal(err)
	}
	adminFile := filepath.Join(root, "first-admin.txt")
	cmd := exec.Command("bash", script)
	cmd.Dir = root
	cmd.Env = append(os.Environ(),
		"PATH="+bin+string(os.PathListSeparator)+os.Getenv("PATH"),
		"STUB_STATUS="+status, "STUB_CODE="+postCode, "STUB_POSTED="+posted,
		"STUB_CA="+ca, "STUB_CA_MARK="+caMark,
		"ICESLAB_FIRST_ADMIN_FILE="+adminFile,
	)
	out, err := cmd.CombinedOutput()
	run := firstAdminRun{out: string(out)}
	if ee, ok := err.(*exec.ExitError); ok {
		run.exit = ee.ExitCode()
	} else if err != nil {
		t.Fatal(err)
	}
	if blob, err := os.ReadFile(adminFile); err == nil {
		run.file = string(blob)
		info, err := os.Stat(adminFile)
		if err != nil {
			t.Fatal(err)
		}
		run.fileMode = info.Mode().Perm()
	}
	if blob, err := os.ReadFile(posted); err == nil {
		run.posted = string(blob)
	}
	_, err = os.Stat(caMark)
	run.caAsked = err == nil
	return run
}

const (
	registrationOpen   = `{"authentication":{"password":{"enabled":true}},"registration":{"enabled":true},"panel":{}}`
	registrationClosed = `{"authentication":{"password":{"enabled":true}},"registration":{"enabled":false},"panel":{}}`
)

var firstAdminPassword = regexp.MustCompile(`password: ([0-9a-f]{48})\n`)

func TestFirstAdminPasswordGoesToTheFileAndNeverToTheLog(t *testing.T) {
	run := runFirstAdmin(t, "created", registrationOpen, "201")
	if run.exit != 0 {
		t.Fatalf("exit %d:\n%s", run.exit, run.out)
	}
	if !run.caAsked || !strings.Contains(run.out, "panel CA created") {
		t.Errorf("the CA step did not run or did not say so:\n%s", run.out)
	}
	match := firstAdminPassword.FindStringSubmatch(run.file)
	if match == nil {
		t.Fatalf("no generated password in the file: %q", run.file)
	}
	if strings.Contains(run.out, match[1]) {
		t.Errorf("the password reached stdout or stderr, and so a tee'd log:\n%s", run.out)
	}
	if run.fileMode != 0o600 {
		t.Errorf("file mode %o, want 600", run.fileMode)
	}
	if !strings.Contains(run.posted, match[1]) {
		t.Errorf("the backend was not given the password in the file: %q", run.posted)
	}
}

// The status answer has an `enabled: true` of its own under authentication, so a
// loose match would read every closed panel as open.
func TestFirstAdminRefusesARepeatWithoutTouchingAnything(t *testing.T) {
	run := runFirstAdmin(t, "present", registrationClosed, "201")
	if run.exit != 3 {
		t.Fatalf("exit %d, want 3:\n%s", run.exit, run.out)
	}
	if run.posted != "" || run.file != "" {
		t.Errorf("a panel with an admin got a request %q and a file %q", run.posted, run.file)
	}
	if !strings.Contains(run.out, "panel CA already there, unchanged") {
		t.Errorf("a repeat does not say the CA was left as it was:\n%s", run.out)
	}
}

// No CA, no admin: the first node of that panel would race for it (Бк-183).
func TestFirstAdminStopsWhenTheCAWasNotCreated(t *testing.T) {
	run := runFirstAdmin(t, "failed: connection refused", registrationOpen, "201")
	if run.exit != 1 {
		t.Fatalf("exit %d, want 1:\n%s", run.exit, run.out)
	}
	if run.posted != "" || run.file != "" {
		t.Errorf("no CA, yet a request %q and a file %q", run.posted, run.file)
	}
	if !strings.Contains(run.out, "connection refused") {
		t.Errorf("the refusal does not carry the backend's words:\n%s", run.out)
	}
}

func TestFirstAdminRefusedByTheBackendLeavesNoPasswordBehind(t *testing.T) {
	run := runFirstAdmin(t, "created", registrationOpen, "500")
	if run.exit != 1 {
		t.Fatalf("exit %d, want 1:\n%s", run.exit, run.out)
	}
	if run.file != "" {
		t.Errorf("a password nobody can use was left in the file: %q", run.file)
	}
	if !strings.Contains(run.out, "500") {
		t.Errorf("the refusal does not say what the backend answered:\n%s", run.out)
	}
}

func TestFirstAdminWithNoBackendSaysSo(t *testing.T) {
	run := runFirstAdmin(t, "created", "", "201")
	if run.exit != 1 {
		t.Fatalf("exit %d, want 1:\n%s", run.exit, run.out)
	}
	if run.posted != "" || run.file != "" {
		t.Errorf("no status, yet a request %q and a file %q", run.posted, run.file)
	}
	if !strings.Contains(run.out, "did not answer") {
		t.Errorf("no words about the backend:\n%s", run.out)
	}
}

// The order is the whole point: the frontend's is the only published port.
func TestInstallerCreatesTheFirstAdminBeforeThePortOpens(t *testing.T) {
	blob, err := os.ReadFile("../../scripts/install-iceslab.sh")
	if err != nil {
		t.Fatal(err)
	}
	s := string(blob)
	backend := strings.Index(s, `up -d backend; then`)
	admin := strings.Index(s, `scripts/ops/first-admin.sh`)
	everything := strings.Index(s, `up -d; then`)
	if backend == -1 || admin == -1 || everything == -1 {
		t.Fatalf("installer steps not found: backend %d, first admin %d, stack %d", backend, admin, everything)
	}
	if !(backend < admin && admin < everything) {
		t.Errorf("order must be backend, first admin, frontend: %d, %d, %d", backend, admin, everything)
	}
}

// Only the frontend publishes a port, in both compose files.
func TestComposePublishesNoBackendPort(t *testing.T) {
	service := regexp.MustCompile(`(?m)^  ([a-z0-9-]+):\s*$`)
	for _, path := range []string{"../../docker-compose.prod.yml", "../../docker-compose.ghcr.yml"} {
		blob, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		lines := withoutShellComments(string(blob))
		starts := service.FindAllStringSubmatchIndex(lines, -1)
		published := map[string]bool{}
		for i, m := range starts {
			end := len(lines)
			if i+1 < len(starts) {
				end = starts[i+1][0]
			}
			if strings.Contains(lines[m[0]:end], "\n    ports:") {
				published[lines[m[2]:m[3]]] = true
			}
		}
		if len(published) != 1 || !published["frontend"] {
			t.Errorf("%s: services publishing a port: %v, want the frontend only", path, published)
		}
	}
}

func withoutShellComments(text string) string {
	var kept []string
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "#") {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n")
}
