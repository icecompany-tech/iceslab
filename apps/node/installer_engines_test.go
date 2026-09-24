package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// --engines in install-iceslab-node.sh, run for real: the installer's "Cores"
// section cut out of the script and run in bash against a fake checkout whose
// bootstraps are stand-ins that note their call and write a block through the
// real lib/node-env.sh. Same shape as the installer test in
// internal/payload/coreenv_test.go.
//
// ⚠ Reads files outside the package: `go test -count=1` locally. Needs bash.

const installerPath = "../../scripts/install-iceslab-node.sh"

// coresSection is the installer from KNOWN_ENGINES to the end of
// legacy_primary_env: every function --engines is made of.
func coresSection(t *testing.T) string {
	t.Helper()
	blob, err := os.ReadFile(installerPath)
	if err != nil {
		t.Fatal(err)
	}
	s := string(blob)
	start := strings.Index(s, "\nKNOWN_ENGINES=")
	last := strings.Index(s, "\nlegacy_primary_env() {")
	if start == -1 || last == -1 {
		t.Fatal("the installer's Cores section is not where this test looks")
	}
	end := strings.Index(s[last:], "\n}\n")
	return s[start : last+end+3]
}

type installRun struct {
	out, calls, env string
	err            error
}

// runInstall builds a checkout (with or without lib/node-env.sh), runs
// resolve_engines and install_engines, and returns what happened.
func runInstall(t *testing.T, withLib bool, protocol, engines string, withSingbox bool) installRun {
	t.Helper()
	bash := needBash(t)
	root := t.TempDir()
	scripts := filepath.Join(root, "apps", "node", "scripts")
	if err := os.MkdirAll(filepath.Join(scripts, "lib"), 0o755); err != nil {
		t.Fatal(err)
	}
	if withLib {
		lib, err := os.ReadFile(filepath.Join("scripts", "lib", "node-env.sh"))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(scripts, "lib", "node-env.sh"), lib, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for engine, name := range bootstraps {
		stub := "#!/usr/bin/env bash\nset -euo pipefail\necho \"" + name + " $*\" >>\"$CALLS\"\n"
		if withLib {
			stub += ". \"$(dirname \"$0\")/lib/node-env.sh\"\nnode_env_block " + engine + " STUB_" + strings.ToUpper(engine) + "=1\n"
		}
		if err := os.WriteFile(filepath.Join(scripts, name), []byte(stub), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	env := filepath.Join(root, "env")
	calls := filepath.Join(root, "calls")
	if err := os.WriteFile(env, []byte("NODE_PAYLOAD=x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ws := "0"
	if withSingbox {
		ws = "1"
	}
	prog := "set -euo pipefail\nlog() { :; }\nwarn() { echo \"warn: $*\"; }\nfail() { echo \"fail: $*\"; exit 1; }\n" +
		coresSection(t) + "\n" +
		"ICESLAB_NODE_DIR='" + root + "'\nICESLAB_NODE_REF=v0.1.9\nENV_FILE='" + env + "'\nHY_DOMAIN=''\nHY_EMAIL=''\n" +
		"PROTOCOL='" + protocol + "'\nENGINES_ARG='" + engines + "'\nWITH_SINGBOX=" + ws + "\n" +
		"resolve_engines\ninstall_engines \"$ICESLAB_NODE_DIR/apps/node/scripts\"\necho \"ENGINES=${ENGINES[*]}\"\n"
	cmd := exec.Command(bash, "-c", prog)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "ICESLAB_NODE_ENV=" + env, "CALLS=" + calls}
	out, err := cmd.CombinedOutput()
	c, _ := os.ReadFile(calls)
	e, _ := os.ReadFile(env)
	return installRun{out: string(out), calls: string(c), env: string(e), err: err}
}

func TestInstallerRunsEveryCoresBootstrapAndEachWiresItself(t *testing.T) {
	r := runInstall(t, true, "xray", "xray,hysteria,singbox", false)
	if r.err != nil {
		t.Fatalf("%v\n%s", r.err, r.out)
	}
	want := "bootstrap-xray.sh \nbootstrap-hysteria.sh \nbootstrap-singbox.sh \n"
	if r.calls != want {
		t.Errorf("calls:\n%s\nwant:\n%s", r.calls, want)
	}
	for _, engine := range []string{"xray", "hysteria", "singbox"} {
		if !strings.Contains(r.env, "# >>> iceslab-node env:"+engine+" >>>\nSTUB_"+strings.ToUpper(engine)+"=1\n") {
			t.Errorf("no %s block in the env:\n%s", engine, r.env)
		}
	}
	// The installer passes no --restart-agent: it starts the agent itself, once.
	if strings.Contains(r.calls, "--restart-agent") {
		t.Error("the installer asked a bootstrap to restart the agent")
	}
}

func TestInstallerTakesTheOldSpellingsToo(t *testing.T) {
	// --with-singbox on top of the main core, and a protocol whose core is
	// named differently (shadowsocks runs on xray).
	r := runInstall(t, true, "shadowsocks", "", true)
	if r.err != nil || !strings.Contains(r.out, "ENGINES=xray singbox") {
		t.Fatalf("%v\n%s", r.err, r.out)
	}
	if r.calls != "bootstrap-xray.sh \nbootstrap-singbox.sh \n" {
		t.Errorf("calls:\n%s", r.calls)
	}
	// Nothing named at all: the core of --protocol alone.
	r = runInstall(t, true, "tuic", "", false)
	if r.err != nil || r.calls != "bootstrap-singbox.sh \n" {
		t.Errorf("tuic alone: %v\n%s\n%s", r.err, r.calls, r.out)
	}
}

func TestInstallerRefusesEnginesThatDisagreeWithTheProtocol(t *testing.T) {
	for _, c := range []struct{ protocol, engines, says string }{
		{"xray", "hysteria,xray", "the main core goes first"},
		{"xray", "xray,xray", "named twice"},
		{"xray", "xray,wireguard", "unknown core 'wireguard'"},
	} {
		r := runInstall(t, true, c.protocol, c.engines, false)
		if r.err == nil || !strings.Contains(r.out, c.says) {
			t.Errorf("%s/%s: want a refusal saying %q, got %v\n%s", c.protocol, c.engines, c.says, r.err, r.out)
		}
		if r.calls != "" {
			t.Errorf("%s/%s: a bootstrap ran before the refusal:\n%s", c.protocol, c.engines, r.calls)
		}
	}
}

func TestAnOldCheckoutGetsTheMainCoreAndAWarningThatSaysWhatFixesIt(t *testing.T) {
	r := runInstall(t, false, "xray", "xray,hysteria,singbox", false)
	if r.err != nil {
		t.Fatalf("%v\n%s", r.err, r.out)
	}
	if r.calls != "bootstrap-xray.sh \n" {
		t.Errorf("an old checkout ran more than the main core:\n%s", r.calls)
	}
	for _, want := range []string{
		"predates --engines",
		"NOT installed: hysteria singbox",
		"ICESLAB_NODE_REF=main",
		"fetch --depth 1 origin main",
		"bootstrap-<core>.sh --restart-agent",
	} {
		if !strings.Contains(r.out, want) {
			t.Errorf("the warning lacks %q:\n%s", want, r.out)
		}
	}
	// And the main core is wired the old way, or the node would have none.
	if !strings.Contains(r.env, "XRAY_BINARY=/usr/local/bin/xray\n") {
		t.Errorf("the main core is not in the env:\n%s", r.env)
	}
}

// The installer's table and the panel's (ENGINE_BOOTSTRAP in shared) name the
// same script for every core: the panel's "how to install" and the installer
// are one road.
func TestInstallerAndPanelNameTheSameBootstraps(t *testing.T) {
	shared, err := os.ReadFile("../../packages/shared/src/core-versions.ts")
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)export const ENGINE_BOOTSTRAP[^{]*\{(.*?)\};`).FindSubmatch(shared)
	if block == nil {
		t.Fatal("ENGINE_BOOTSTRAP not found in core-versions.ts")
	}
	panel := map[string]string{}
	for _, m := range regexp.MustCompile(`(\w+): '([^']+)'`).FindAllSubmatch(block[1], -1) {
		panel[string(m[1])] = string(m[2])
	}
	section := coresSection(t)
	for engine, script := range panel {
		if !strings.Contains(section, engine+")") || !regexp.MustCompile(`\b`+engine+`\)\s+echo `+regexp.QuoteMeta(script)+` ;;`).MatchString(section) {
			t.Errorf("the installer does not map %s to %s", engine, script)
		}
		if bootstraps[engine] != script {
			t.Errorf("bootstrap_env_test knows %s as %q, the panel as %q", engine, bootstraps[engine], script)
		}
	}
	if len(panel) != len(bootstraps) {
		t.Errorf("the panel names %d cores, the tests %d", len(panel), len(bootstraps))
	}
}
