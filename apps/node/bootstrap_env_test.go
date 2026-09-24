package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
)

// E20: a bootstrap wires its core into the agent by writing its own block of
// /etc/iceslab-node/env (scripts/lib/node-env.sh). What is held here:
//
//   - two runs leave the same file, for every bootstrap and for all of them in
//     a row, on top of an env that already has a payload, a hand-written copy
//     of a key and somebody else's block;
//   - every key a bootstrap writes is one this agent reads, so a key the agent
//     never looks at (the installer's old NAIVE_BINARY) cannot come back;
//   - every way a bootstrap ends well goes through the env block.
//
// The blocks are run for real: each script's wire_env, with the script's own
// top-level assignments in front of it, in bash against a temp file. Same
// shape as the installer test in internal/payload/coreenv_test.go.
//
// ⚠ Reads files outside the package: `go test -count=1` locally. Needs bash,
// so it runs in WSL and CI and skips on a bare Windows shell.

var bootstraps = map[string]string{
	"xray":      "bootstrap-xray.sh",
	"singbox":   "bootstrap-singbox.sh",
	"hysteria":  "bootstrap-hysteria.sh",
	"amneziawg": "bootstrap-amneziawg.sh",
	"mtproto":   "bootstrap-mtg.sh",
	"mieru":     "bootstrap-mieru.sh",
	"naive":     "bootstrap-naive.sh",
}

const baseEnv = "NODE_PAYLOAD=cGF5bG9hZA\nNODE_HOST=0.0.0.0\nNODE_PORT=1337\n" +
	// A hand-written copy from before E20, which the singbox block now owns.
	"SINGBOX_BINARY=/opt/old/sing-box\n" +
	// A line nobody's block owns: it stays where it is.
	"XRAY_REALITY_SHORT_IDS=abc123\n" +
	"# >>> iceslab-node env:other >>>\nOTHER_KEY=1\n# <<< iceslab-node env:other <<<\n"

func needBash(t *testing.T) string {
	t.Helper()
	bash, err := exec.LookPath("bash")
	if err != nil || runtime.GOOS == "windows" {
		t.Skip("needs bash")
	}
	return bash
}

func readScript(t *testing.T, name string) string {
	t.Helper()
	blob, err := os.ReadFile(filepath.Join("scripts", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(blob)
}

// wiring returns bash that defines wire_env exactly as the script does, with
// the script's own simple top-level assignments in front of it (the paths and
// pins it reads). No `declare -A`, no command substitutions: nothing that
// could run anything.
func wiring(t *testing.T, script string) string {
	t.Helper()
	start := strings.Index(script, "\nwire_env() {")
	if start == -1 {
		t.Fatal("no wire_env")
	}
	end := strings.Index(script[start:], "\n}\n")
	if end == -1 {
		t.Fatal("wire_env has no end")
	}
	assign := regexp.MustCompile(`^[A-Z][A-Z0-9_]*=("[^"$` + "`" + `]*"|"\$\{[A-Z0-9_]+:-[^}` + "`" + `$]*\}"|\$\{[A-Z0-9_]+:-[^}` + "`" + `$]*\}|[^"$` + "`" + `\s]*)$`)
	var vars []string
	for _, line := range strings.Split(script[:start], "\n") {
		if assign.MatchString(line) {
			vars = append(vars, line)
		}
	}
	return strings.Join(vars, "\n") + script[start:start+end+3]
}

func runWiring(t *testing.T, bash, envFile string, bodies ...string) {
	t.Helper()
	lib, err := filepath.Abs(filepath.Join("scripts", "lib", "node-env.sh"))
	if err != nil {
		t.Fatal(err)
	}
	prog := "set -euo pipefail\nlog() { :; }\nwarn() { :; }\nfail() { echo \"$*\" >&2; exit 1; }\n. '" + lib + "'\n"
	for _, b := range bodies {
		prog += b + "\nwire_env\nunset -f wire_env\n"
	}
	cmd := exec.Command(bash, "-c", prog)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "ICESLAB_NODE_ENV=" + envFile}
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("bash: %v\n%s", err, out)
	}
}

func TestEveryBootstrapLeavesTheSameEnvOnTheSecondRun(t *testing.T) {
	bash := needBash(t)
	names := make([]string, 0, len(bootstraps))
	for engine := range bootstraps {
		names = append(names, engine)
	}
	sort.Strings(names)

	var all []string
	for _, engine := range names {
		body := wiring(t, readScript(t, bootstraps[engine]))
		all = append(all, body)
		t.Run(engine, func(t *testing.T) {
			env := filepath.Join(t.TempDir(), "env")
			if err := os.WriteFile(env, []byte(baseEnv), 0o600); err != nil {
				t.Fatal(err)
			}
			runWiring(t, bash, env, body)
			first, _ := os.ReadFile(env)
			runWiring(t, bash, env, body)
			second, _ := os.ReadFile(env)
			if string(first) != string(second) {
				t.Fatalf("second run changed the env:\n--- first\n%s--- second\n%s", first, second)
			}
			got := string(first)
			if !strings.Contains(got, "# >>> iceslab-node env:"+engine+" >>>\n") {
				t.Errorf("no %s block:\n%s", engine, got)
			}
			for _, keep := range []string{"NODE_PAYLOAD=cGF5bG9hZA\n", "XRAY_REALITY_SHORT_IDS=abc123\n", "OTHER_KEY=1\n"} {
				if !strings.Contains(got, keep) {
					t.Errorf("lost %q:\n%s", keep, got)
				}
			}
			if info, _ := os.Stat(env); info.Mode().Perm() != 0o600 {
				t.Errorf("env mode %v, the payload lives in this file", info.Mode().Perm())
			}
		})
	}

	// All seven in a row, twice: one file, the same file.
	env := filepath.Join(t.TempDir(), "env")
	if err := os.WriteFile(env, []byte(baseEnv), 0o600); err != nil {
		t.Fatal(err)
	}
	runWiring(t, bash, env, all...)
	first, _ := os.ReadFile(env)
	runWiring(t, bash, env, all...)
	second, _ := os.ReadFile(env)
	if string(first) != string(second) {
		t.Fatalf("all seven, second run changed the env:\n--- first\n%s--- second\n%s", first, second)
	}
	// The hand-written copy is gone, the block's value is the one left.
	if strings.Contains(string(first), "/opt/old/sing-box") || strings.Count(string(first), "SINGBOX_BINARY=") != 1 {
		t.Errorf("the loose SINGBOX_BINARY survived next to the block:\n%s", first)
	}
	// Six variables for hysteria, the list E20 named, and the secret kept.
	for _, key := range []string{"HYSTERIA_BINARY=", "HYSTERIA_CONFIG=", "HYSTERIA_AUTH_PORT=", "HYSTERIA_SERVICE_UNIT=hysteria",
		"HYSTERIA_STATS_LISTEN=", "HYSTERIA_STATS_SECRET="} {
		if !strings.Contains(string(first), key) {
			t.Errorf("hysteria block lacks %s", key)
		}
	}
}

// A secret the config on disk already carries is not re-rolled by a rerun.
func TestHysteriaKeepsTheStatsSecretItFound(t *testing.T) {
	bash := needBash(t)
	env := filepath.Join(t.TempDir(), "env")
	if err := os.WriteFile(env, []byte(baseEnv+"HYSTERIA_STATS_SECRET=keepme\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runWiring(t, bash, env, wiring(t, readScript(t, "bootstrap-hysteria.sh")))
	got, _ := os.ReadFile(env)
	if strings.Count(string(got), "HYSTERIA_STATS_SECRET=keepme\n") != 1 {
		t.Errorf("secret not kept exactly once:\n%s", got)
	}
}

// Every key a bootstrap writes is one this agent reads. A key nobody reads is
// a line that looks like configuration and configures nothing.
func TestEveryBootstrapKeyIsReadByTheAgent(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	read := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?:os\.Getenv|getenv|getenvInt)\("([A-Z0-9_]+)"`).FindAllStringSubmatch(string(src), -1) {
		read[m[1]] = true
	}
	key := regexp.MustCompile(`"([A-Z][A-Z0-9_]*)=`)
	for engine, name := range bootstraps {
		body := wiring(t, readScript(t, name))
		keys := key.FindAllStringSubmatch(body[strings.Index(body, "wire_env() {"):], -1)
		if len(keys) == 0 {
			t.Errorf("%s writes no keys", name)
		}
		for _, k := range keys {
			if !read[k[1]] {
				t.Errorf("%s (%s) writes %s, which the agent never reads", name, engine, k[1])
			}
		}
	}
}

// Every successful end of a bootstrap goes through the env block: an early
// "already on the wanted version" exit used to leave the node exactly as
// unwired as before.
func TestEveryBootstrapEndsThroughTheEnvBlock(t *testing.T) {
	for _, name := range bootstraps {
		script := readScript(t, name)
		if !strings.Contains(script, `. "$(dirname "${BASH_SOURCE[0]}")/lib/node-env.sh"`) {
			t.Errorf("%s does not source lib/node-env.sh", name)
		}
		if !strings.Contains(script, `node_env_flags "$@"`) {
			t.Errorf("%s takes no --restart-agent", name)
		}
		lines := strings.Split(script, "\n")
		for i, l := range lines {
			if strings.TrimSpace(l) != "exit 0" {
				continue
			}
			before := strings.Join(lines[max(0, i-3):i], "\n")
			if !strings.Contains(before, "node_env_done") && !strings.Contains(before, "finish") {
				t.Errorf("%s:%d exits 0 without wiring the core in", name, i+1)
			}
		}
		if strings.Count(script, "node_env_done ")+strings.Count(script, "\nfinish\n")+strings.Count(script, "  finish\n") < 1 {
			t.Errorf("%s never calls node_env_done", name)
		}
	}
}
