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
// resolve_engines, install_engines and core_flags_env, and returns what
// happened.
func runInstall(t *testing.T, withLib bool, protocol, engines string, withSingbox bool) installRun {
	return runInstallWith(t, withLib, protocol, engines, withSingbox, "")
}

// runInstallWith is runInstall with shell assignments of the install flags
// (HY_DOMAIN=..., XR_PRIVATE_KEY=...) set before the run.
func runInstallWith(t *testing.T, withLib bool, protocol, engines string, withSingbox bool, flags string) installRun {
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
		"XR_PRIVATE_KEY=''\nXR_SHORT_IDS=''\nXR_SERVER_NAMES='www.cloudflare.com'\nXR_DEST='www.cloudflare.com:443'\nXR_PORT=443\n" +
		flags + "\n" +
		"PROTOCOL='" + protocol + "'\nENGINES_ARG='" + engines + "'\nWITH_SINGBOX=" + ws + "\n" +
		"resolve_engines\ninstall_engines \"$ICESLAB_NODE_DIR/apps/node/scripts\"\ncore_flags_env\necho \"ENGINES=${ENGINES[*]}\"\n"
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

// 25.09: a node's cores are a set, none of them the main one. --engines alone
// installs them in any order, and the flags follow the core they belong to.
func TestInstallerTakesTheSetAndTheFlagsFollowTheirCore(t *testing.T) {
	r := runInstallWith(t, true, "", "hysteria,xray", false,
		"HY_DOMAIN='hy.example.com'\nHY_EMAIL='ops@example.com'\nXR_PRIVATE_KEY='priv'\nXR_SHORT_IDS='ab12'")
	if r.err != nil {
		t.Fatalf("%v\n%s", r.err, r.out)
	}
	if r.calls != "bootstrap-hysteria.sh \nbootstrap-xray.sh \n" {
		t.Errorf("calls:\n%s", r.calls)
	}
	for _, want := range []string{
		"HYSTERIA_HOSTNAME=hy.example.com\n",
		"HYSTERIA_ACME_EMAIL=ops@example.com\n",
		"XRAY_REALITY_PRIVATE_KEY=priv\n",
		"XRAY_REALITY_SHORT_IDS=ab12\n",
	} {
		if !strings.Contains(r.env, want) {
			t.Errorf("the env lacks %q:\n%s", want, r.env)
		}
	}

	// A flag of a core the node does not get writes nothing.
	r = runInstallWith(t, true, "", "xray", false, "HY_DOMAIN='hy.example.com'\nHY_EMAIL='ops@example.com'")
	if r.err != nil || strings.Contains(r.env, "HYSTERIA_") {
		t.Errorf("a hysteria flag on an xray node: %v\n%s", r.err, r.env)
	}

	// --protocol beside --engines adds its core, wherever the list puts it:
	// no "main core goes first" any more.
	r = runInstall(t, true, "xray", "hysteria,xray", false)
	if r.err != nil || !strings.Contains(r.out, "ENGINES=xray hysteria") {
		t.Errorf("--protocol xray --engines hysteria,xray: %v\n%s", r.err, r.out)
	}
}

// A command an older panel printed keeps working: --protocol hysteria is
// --engines hysteria, calls and env alike.
func TestProtocolAloneIsTheSetOfItsCore(t *testing.T) {
	flags := "HY_DOMAIN='hy.example.com'\nHY_EMAIL='ops@example.com'"
	old := runInstallWith(t, true, "hysteria", "", false, flags)
	set := runInstallWith(t, true, "", "hysteria", false, flags)
	if old.err != nil || set.err != nil {
		t.Fatalf("%v %v\n%s\n%s", old.err, set.err, old.out, set.out)
	}
	if old.calls != set.calls || old.env != set.env {
		t.Errorf("--protocol hysteria and --engines hysteria differ:\ncalls %q / %q\nenv:\n%s\n---\n%s", old.calls, set.calls, old.env, set.env)
	}
	if !strings.Contains(old.env, "HYSTERIA_HOSTNAME=hy.example.com\n") {
		t.Errorf("--protocol hysteria lost its flags:\n%s", old.env)
	}
}

func TestInstallerRefusesAnUnusableSet(t *testing.T) {
	for _, c := range []struct{ protocol, engines, says string }{
		{"xray", "xray,xray", "named twice"},
		{"xray", "xray,wireguard", "unknown core 'wireguard'"},
		{"", ",", "names no core"},
		{"", "", "no core named"},
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

func TestAnOldCheckoutGetsOneCoreAndAWarningThatSaysWhatFixesIt(t *testing.T) {
	r := runInstall(t, false, "xray", "xray,hysteria,singbox", false)
	if r.err != nil {
		t.Fatalf("%v\n%s", r.err, r.out)
	}
	if r.calls != "bootstrap-xray.sh \n" {
		t.Errorf("an old checkout ran more than the core of --protocol:\n%s", r.calls)
	}
	for _, want := range []string{
		"predates --engines",
		"NOT installed: hysteria singbox",
		"ICESLAB_NODE_REF=main",
		"fetch --depth 1 origin main",
		"bootstrap-<core>.sh --restart-agent",
		// A node whose Go is gone cannot rebuild the agent from any checkout
		// (ru-02 on the stand, 24.09): the warning says where Go comes from.
		"needs Go",
		"rerunning this installer",
	} {
		if !strings.Contains(r.out, want) {
			t.Errorf("the warning lacks %q:\n%s", want, r.out)
		}
	}
	// And that core is wired the old way, or the node would have none.
	if !strings.Contains(r.env, "XRAY_BINARY=/usr/local/bin/xray\n") {
		t.Errorf("the one core is not in the env:\n%s", r.env)
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
