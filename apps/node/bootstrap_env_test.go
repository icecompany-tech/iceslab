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

// fnBody cuts one function out of a script, the same way wiring does.
func fnBody(t *testing.T, script, name string) string {
	t.Helper()
	start := strings.Index(script, "\n"+name+"() {")
	if start == -1 {
		t.Fatalf("no %s", name)
	}
	end := strings.Index(script[start:], "\n}\n")
	return script[start : start+end+3]
}

// --remove takes out what the install put in, and nothing else: wire, then
// unwire, and every key the wiring wrote is gone, the block with it, and the
// payload, other blocks and loose lines nobody's core owns are where they were.
func TestEveryBootstrapUnwiresWhatItWired(t *testing.T) {
	bash := needBash(t)
	key := regexp.MustCompile(`"([A-Z][A-Z0-9_]*)=`)
	for engine, name := range bootstraps {
		t.Run(engine, func(t *testing.T) {
			script := readScript(t, name)
			wire := wiring(t, script)
			unwire := fnBody(t, script, "unwire_env")
			env := filepath.Join(t.TempDir(), "env")
			if err := os.WriteFile(env, []byte(baseEnv), 0o600); err != nil {
				t.Fatal(err)
			}
			runWiring(t, bash, env, wire)
			// The unwire runs in place of a second wire_env: name it so.
			runWiring(t, bash, env, strings.Replace(unwire, "\nunwire_env() {", "\nwire_env() {", 1))
			got, _ := os.ReadFile(env)
			if strings.Contains(string(got), "iceslab-node env:"+engine+" ") {
				t.Errorf("the %s block is still there:\n%s", engine, got)
			}
			for _, k := range key.FindAllStringSubmatch(wire[strings.Index(wire, "wire_env() {"):], -1) {
				if strings.Contains(string(got), "\n"+k[1]+"=") || strings.HasPrefix(string(got), k[1]+"=") {
					t.Errorf("%s is still set after --remove:\n%s", k[1], got)
				}
			}
			for _, keep := range []string{"NODE_PAYLOAD=cGF5bG9hZA\n", "XRAY_REALITY_SHORT_IDS=abc123\n", "OTHER_KEY=1\n"} {
				if !strings.Contains(string(got), keep) {
					t.Errorf("--remove took %q with it:\n%s", keep, got)
				}
			}
		})
	}
}

// Every bootstrap has the --remove road, and it goes through the one refusal
// the script can make and through the env: a remove that forgot either would
// either pull a binary from under a running core or leave the agent asking for
// a core that is gone.
func TestEveryBootstrapHasARemoveThatRefusesAndUnwires(t *testing.T) {
	for engine, name := range bootstraps {
		script := readScript(t, name)
		remove := fnBody(t, script, "remove_core")
		if !strings.Contains(remove, "node_env_refuse_if_running") {
			t.Errorf("%s: --remove does not refuse on a running core", name)
		}
		if !strings.Contains(remove, "unwire_env") {
			t.Errorf("%s: --remove leaves the core in the agent's env", name)
		}
		if strings.Contains(remove, "/etc/iceslab-node/env") || strings.Contains(remove, "NODE_PAYLOAD") ||
			strings.Contains(remove, "rm -rf /etc/iceslab-node") {
			t.Errorf("%s: --remove reaches into the agent's identity", name)
		}
		dispatch := "if [[ \"$NODE_ENV_REMOVE\" == 1 ]]; then"
		i := strings.Index(script, dispatch)
		if i == -1 || !strings.Contains(script[i:i+200], "remove_core\n  node_env_done "+engine) {
			t.Errorf("%s: no --remove dispatch that ends through node_env_done %s", name, engine)
		}
	}
}

// The refusal and the process probe, run for real.
func TestTheRemoveRefusalAndTheProcessProbe(t *testing.T) {
	bash := needBash(t)
	lib, _ := filepath.Abs(filepath.Join("scripts", "lib", "node-env.sh"))
	run := func(body string) (string, error) {
		cmd := exec.Command(bash, "-c", "set -euo pipefail\n. '"+lib+"'\n"+body)
		cmd.Env = []string{"PATH=/usr/bin:/bin"}
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	out, err := run(`node_env_refuse_if_running mtg "mtg pid 42"; echo REACHED`)
	if err == nil || strings.Contains(out, "REACHED") || !strings.Contains(out, "Stop it first") {
		t.Errorf("a running core was not refused: %v\n%s", err, out)
	}
	out, err = run(`node_env_refuse_if_running mtg ""; echo REACHED`)
	if err != nil || !strings.Contains(out, "REACHED") {
		t.Errorf("a stopped core was refused: %v\n%s", err, out)
	}
	out, err = run(`sleep 30 & p=$!; got="$(node_env_pids sleep)"; kill $p; echo "[$got]"; echo "[$(node_env_pids no-such-core)]"`)
	if err != nil || !regexp.MustCompile(`\[sleep pid \d+`).MatchString(out) || !strings.Contains(out, "[]") {
		t.Errorf("node_env_pids: %v\n%s", err, out)
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
