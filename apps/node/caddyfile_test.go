package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// A-267: the host Caddyfile masks subscription and bootstrap tokens in Caddy's
// logs. The installer writes it once, so deploy.sh renders it again on every
// update (refresh_host_caddyfile in scripts/ops/_lib.sh), or an operator who
// updated would keep a Caddy writing tokens into access.log.
//
// ⚠ Reads files outside the package: `go test -count=1` locally. Needs bash.

const (
	panelInstaller = "../../scripts/install-iceslab.sh"
	opsLib         = "../../scripts/ops/_lib.sh"
)

// caddyfileFunc: write_caddyfile() as written, heredoc and all. The heredoc
// closes its own site blocks with `}` at column 0, so the function ends at
// the `}` after `EOF`, not at the first one.
func caddyfileFunc(t *testing.T, path string) string {
	t.Helper()
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := strings.ReplaceAll(string(blob), "\r\n", "\n")
	start := strings.Index(s, "\nwrite_caddyfile() {\n")
	if start == -1 {
		t.Fatalf("%s has no write_caddyfile()", path)
	}
	end := strings.Index(s[start:], "\nEOF\n}\n")
	if end == -1 {
		t.Fatalf("%s: write_caddyfile() has no end", path)
	}
	return s[start : start+end+len("\nEOF\n}\n")]
}

// The installer runs curl-piped and cannot source _lib.sh, so the function is
// in both. A fix made in one copy and not the other would give a fresh install
// one file and the next deploy another.
func TestTheHostCaddyfileIsWrittenByOneFunction(t *testing.T) {
	if a, b := caddyfileFunc(t, panelInstaller), caddyfileFunc(t, opsLib); a != b {
		t.Errorf("write_caddyfile differs between install-iceslab.sh and scripts/ops/_lib.sh:\n--- installer\n%s\n--- _lib.sh\n%s", a, b)
	}
	read := func(p string) string {
		blob, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		return strings.ReplaceAll(string(blob), "\r\n", "\n")
	}
	if a, b := fnBody(t, read(panelInstaller), "prepare_caddy_logs"), fnBody(t, read(opsLib), "prepare_caddy_logs"); a != b {
		t.Errorf("prepare_caddy_logs differs between install-iceslab.sh and scripts/ops/_lib.sh:\n--- installer\n%s\n--- _lib.sh\n%s", a, b)
	}
}

const legacyCaddyfile = `panel.example.com {
  log {
    output file /var/log/caddy/access.log
    format json
  }
  reverse_proxy 127.0.0.1:8080
}

# Anti-probing: bare-IP / unknown hostname requests on :443 get a silent 204
# so scanners can't fingerprint Iceslab.
:443 {
  tls internal
  respond 204
}
`

type caddyRefresh struct {
	out, calls, file string
	backups          []string
	stamp            string
}

// runRefresh: the file in place (empty: none), whether a stamp of it lies
// beside it, the env file's lines, and whether `caddy validate` passes.
func runRefresh(t *testing.T, existing string, stamped bool, env string, validates bool) caddyRefresh {
	t.Helper()
	bash := needBash(t)
	dir := t.TempDir()
	file := filepath.Join(dir, "Caddyfile")
	stamp := filepath.Join(dir, ".iceslab-caddyfile.sha256")
	envFile := filepath.Join(dir, ".env.production")
	calls := filepath.Join(dir, "calls")
	if existing != "" {
		if err := os.WriteFile(file, []byte(existing), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(envFile, []byte(env), 0o600); err != nil {
		t.Fatal(err)
	}
	note := `echo "$(basename "$0") $*" >>'` + calls + "'\n"
	validate := "exit 0\n"
	if !validates {
		validate = "exit 1\n"
	}
	bin := stubs(t, map[string]string{
		"caddy":     note + validate,
		"systemctl": note + "exit 0\n",
	})
	prog := "set -euo pipefail\nLIB_PREFIX=test\nsource '" + opsLib + "'\n"
	if stamped {
		prog += "sha256sum '" + file + "' | cut -d' ' -f1 >'" + stamp + "'\n"
	}
	prog += "CADDYFILE_PATH='" + file + "' ENV_FILE='" + envFile + "' refresh_host_caddyfile\necho DONE\n"
	cmd := exec.Command(bash, "-c", prog)
	cmd.Env = []string{"PATH=" + bin + ":/usr/bin:/bin"}
	out, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "DONE") {
		t.Fatalf("refresh_host_caddyfile: %v\n%s", err, out)
	}
	r := caddyRefresh{out: string(out)}
	if b, err := os.ReadFile(calls); err == nil {
		r.calls = string(b)
	}
	if b, err := os.ReadFile(file); err == nil {
		r.file = string(b)
	}
	if b, err := os.ReadFile(stamp); err == nil {
		r.stamp = strings.TrimSpace(string(b))
	}
	r.backups, _ = filepath.Glob(file + ".bak.*")
	return r
}

func assertRewritten(t *testing.T, what string, r caddyRefresh, prefix string) {
	t.Helper()
	for _, want := range []string{
		"panel.example.com {",
		"reverse_proxy 127.0.0.1:8080",
		"log iceslab_secret_paths",
		"@secret_paths path " + prefix + "/* /api/internal/bootstrap/* /api/users/by-subscription-token/* /api/settings/subscription/preview/*",
		"include http.log.error",
		"trusted_proxies static 173.245.48.0/20 ",
		"trusted_proxies_strict\n",
	} {
		if !strings.Contains(r.file, want) {
			t.Errorf("%s: the new file has no %q:\n%s", what, want, r.file)
		}
	}
	if !strings.Contains(r.calls, "caddy validate") || !strings.Contains(r.calls, "systemctl reload caddy") {
		t.Errorf("%s: not validated and reloaded:\n%s", what, r.calls)
	}
	if len(r.backups) != 1 {
		t.Errorf("%s: want one backup of the old file, got %v", what, r.backups)
	}
	if r.stamp == "" {
		t.Errorf("%s: no stamp of the new file, the next deploy would call it edited", what)
	}
}

func TestADeployRewritesTheHostCaddyfileTheInstallerWrote(t *testing.T) {
	// A panel installed with v0.2.1: no stamp, the file exactly as written then.
	r := runRefresh(t, legacyCaddyfile, false, "", true)
	assertRewritten(t, "v0.2.1 file", r, "/sub")

	// Installed later: the stamp says the file is still ours, whatever it holds.
	r = runRefresh(t, "panel.example.com {\n  reverse_proxy 127.0.0.1:8080\n}\n", true, "SUBSCRIPTION_PATH_PREFIX=/s3cr3t\n", true)
	assertRewritten(t, "stamped file", r, "/s3cr3t")

	// And the deploy after it finds nothing to do: no rewrite, no reload.
	again := runRefresh(t, r.file, true, "SUBSCRIPTION_PATH_PREFIX=/s3cr3t\n", true)
	// prepare_caddy_logs still asks systemctl for Caddy's user; no reload.
	if !strings.Contains(again.out, "already current") || strings.Contains(again.calls, "systemctl reload") {
		t.Errorf("a current file was rewritten or reloaded:\n%s\ncalls:\n%s", again.out, again.calls)
	}
}

func TestADeployLeavesAnEditedHostCaddyfileAlone(t *testing.T) {
	edited := strings.Replace(legacyCaddyfile, "  reverse_proxy", "  encode gzip\n  reverse_proxy", 1)
	r := runRefresh(t, edited, false, "", true)
	if r.file != edited {
		t.Errorf("an edited file was rewritten:\n%s", r.file)
	}
	if !strings.Contains(r.out, "edited by hand") || strings.Contains(r.calls, "systemctl") {
		t.Errorf("want a warning and no reload, got:\n%s\ncalls:\n%s", r.out, r.calls)
	}
}

func TestADeployKeepsTheOldHostCaddyfileWhenTheNewOneDoesNotValidate(t *testing.T) {
	r := runRefresh(t, legacyCaddyfile, false, "", false)
	// prepare_caddy_logs asks systemctl which user Caddy runs as before the
	// validate, so only a reload counts here.
	if r.file != legacyCaddyfile || len(r.backups) != 0 || strings.Contains(r.calls, "systemctl reload") {
		t.Errorf("a file that does not validate was put in place:\n%s\ncalls:\n%s", r.file, r.calls)
	}
}

// Caddy keeps a file log open across reloads and hands the same writer to the
// next config (see caddy_restart_if_stale_logs in _lib.sh), so a log removed
// under it is written into the removed file until a restart. The function
// restarts exactly then: a named log held as «(deleted)».
func TestCaddyRestartsOnlyWhenItHoldsARemovedLog(t *testing.T) {
	bash := needBash(t)
	run := func(t *testing.T, links map[string]string) (string, string) {
		t.Helper()
		dir := t.TempDir()
		fdDir := filepath.Join(dir, "proc", "4242", "fd")
		if err := os.MkdirAll(fdDir, 0o755); err != nil {
			t.Fatal(err)
		}
		for name, target := range links {
			// A symlink's target can be any text: the kernel's «(deleted)»
			// suffix included.
			if err := os.Symlink(target, filepath.Join(fdDir, name)); err != nil {
				t.Fatal(err)
			}
		}
		caddyfile := filepath.Join(dir, "Caddyfile")
		if err := os.WriteFile(caddyfile, []byte(legacyCaddyfile+"x {\n  log y {\n    output file /var/log/caddy/access-masked.log {\n      roll_size 10MiB\n    }\n  }\n}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		calls := filepath.Join(dir, "calls")
		bin := stubs(t, map[string]string{
			"systemctl": `echo "systemctl $*" >>'` + calls + `'
case "$1" in
  show) echo 4242 ;;
  is-active) echo active ;;
esac
exit 0
`,
		})
		prog := "set -euo pipefail\nLIB_PREFIX=test\nsource '" + opsLib + "'\nCADDY_PROC='" + filepath.Join(dir, "proc") + "' caddy_restart_if_stale_logs '" + caddyfile + "'\necho DONE\n"
		cmd := exec.Command(bash, "-c", prog)
		cmd.Env = []string{"PATH=" + bin + ":/usr/bin:/bin"}
		out, err := cmd.CombinedOutput()
		if err != nil || !strings.Contains(string(out), "DONE") {
			t.Fatalf("caddy_restart_if_stale_logs: %v\n%s", err, out)
		}
		c, _ := os.ReadFile(calls)
		return string(out), string(c)
	}

	out, calls := run(t, map[string]string{
		"7":  "/var/log/caddy/access-masked.log (deleted)",
		"13": "/var/log/caddy/access.log",
	})
	if !strings.Contains(calls, "systemctl restart caddy") || !strings.Contains(out, "access-masked.log into a removed file") {
		t.Errorf("a removed log held open did not restart Caddy:\n%s\ncalls:\n%s", out, calls)
	}

	for what, links := range map[string]map[string]string{
		"logs open, none removed":  {"7": "/var/log/caddy/access-masked.log", "13": "/var/log/caddy/access.log"},
		"a removed file not a log": {"9": "/tmp/whatever (deleted)"},
	} {
		out, calls := run(t, links)
		if strings.Contains(calls, "restart") {
			t.Errorf("%s: Caddy restarted for nothing:\n%s\ncalls:\n%s", what, out, calls)
		}
	}
}

// refresh_host_caddyfile asks after both of its outcomes that touch a running
// Caddy: the re-render and «already current».
func TestTheRefreshChecksForRemovedLogsOnBothPaths(t *testing.T) {
	blob, err := os.ReadFile(opsLib)
	if err != nil {
		t.Fatal(err)
	}
	body := fnBody(t, strings.ReplaceAll(string(blob), "\r\n", "\n"), "refresh_host_caddyfile")
	if n := strings.Count(body, `caddy_restart_if_stale_logs "$file"`); n != 2 {
		t.Errorf("refresh_host_caddyfile calls caddy_restart_if_stale_logs %d times, want 2 (after the reload, and when already current)", n)
	}
}

// A-009: the file write_caddyfile renders is one the real Caddy loads, with
// trusted_proxies and trusted_proxies_strict in it. The refresh tests stub
// `caddy validate`; this one asks caddy-naive, a Caddy 2.11 with one more
// module, which CI builds for the naive adapter anyway. The log paths move
// into the test's directory: validate opens every log the file names.
func TestTheHostCaddyfileValidatesWithTheRealCaddy(t *testing.T) {
	bin := os.Getenv("CADDY_NAIVE_BIN")
	if bin == "" {
		t.Skip("CADDY_NAIVE_BIN not set: the host Caddyfile is not validated by a real caddy here")
	}
	bash := needBash(t)
	dir := t.TempDir()
	file := filepath.Join(dir, "Caddyfile")
	prog := "set -euo pipefail\nLIB_PREFIX=test\nsource '" + opsLib + "'\nPANEL_DOMAIN=panel.example.com FRONTEND_PORT=8080 write_caddyfile '" + file + "'\n"
	if out, err := exec.Command(bash, "-c", prog).CombinedOutput(); err != nil {
		t.Fatalf("write_caddyfile: %v\n%s", err, out)
	}
	blob, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	rendered := string(blob)
	for _, want := range []string{"    trusted_proxies static 173.245.48.0/20 ", "    trusted_proxies_strict\n"} {
		if !strings.Contains(rendered, want) {
			t.Errorf("the rendered Caddyfile has no %q", want)
		}
	}
	local := strings.ReplaceAll(rendered, "/var/log/caddy/", dir+"/")
	if err := os.WriteFile(file, []byte(local), 0o644); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(bin, "validate", "--config", file, "--adapter", "caddyfile")
	cmd.Env = append(os.Environ(), "HOME="+dir, "XDG_DATA_HOME="+dir, "XDG_CONFIG_HOME="+dir)
	if out, err := cmd.CombinedOutput(); err != nil || !strings.Contains(string(out), "Valid configuration") {
		t.Errorf("caddy validate refused the host Caddyfile: %v\n%s", err, out)
	}
}

func TestADeployWithoutAHostCaddyDoesNothing(t *testing.T) {
	r := runRefresh(t, "", false, "", true)
	if !strings.Contains(r.out, "nothing to refresh") || r.calls != "" {
		t.Errorf("a bare-IP install was touched:\n%s\ncalls:\n%s", r.out, r.calls)
	}
}
