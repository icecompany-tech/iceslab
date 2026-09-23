package payload

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"
)

const (
	xraySha = "23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae"
	mtgSha  = "7ef19d079d85f4e00d4f8334ec1f3f3c8718e3d0ed1f3109ea9a8673138a2102"
	commit  = "2a6e1a02ac024f54a23e18f894a279b7f870b8fb"
)

// A payload's coreVersions as resolveCoreVersions writes it.
func sampleVersions() map[string]CoreRelease {
	return map[string]CoreRelease{
		"xray": {Version: "26.3.27", Tag: "v26.3.27", Assets: map[string]CoreAsset{
			"amd64": {File: "Xray-linux-64.zip", Sha256: xraySha},
		}},
		"mtg": {Version: "2.2.8", Tag: "v2.2.8", Assets: map[string]CoreAsset{
			"amd64": {File: "mtg-2.2.8-linux-amd64.tar.gz", Sha256: mtgSha},
		}},
		"amneziawg-module": {Version: "1.0.20260611", Tag: "v1.0.20260611", Commit: commit},
	}
}

func encode(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

func TestCoreEnvGivesAPairPerComponentForThisArch(t *testing.T) {
	lines, warnings := CoreEnv(sampleVersions(), "amd64")
	want := []string{
		"AWG_MODULE_TAG=v1.0.20260611", "AWG_MODULE_SHA=" + commit,
		"MTG_VERSION=2.2.8", "MTG_SHA256=" + mtgSha,
		"XRAY_VERSION=26.3.27", "XRAY_SHA256=" + xraySha,
	}
	if !reflect.DeepEqual(lines, want) {
		t.Errorf("lines = %v\nwant    %v", lines, want)
	}
	if len(warnings) != 0 {
		t.Errorf("warnings = %v", warnings)
	}
}

// A checkout older than the panel: what the agent cannot place is a warning,
// never a line, so the script keeps its own pin.
func TestCoreEnvSaysWhatItCannotPlaceAndGivesNoLineForIt(t *testing.T) {
	v := sampleVersions()
	v["nginx"] = CoreRelease{Version: "1.0", Tag: "v1.0", Commit: commit}
	v["mtg"] = CoreRelease{Version: "2.2.8", Tag: "v2.2.8", Assets: map[string]CoreAsset{
		"amd64": {File: "x", Sha256: "not-a-sha; rm -rf /"},
	}}
	lines, warnings := CoreEnv(v, "arm64")
	for _, l := range lines {
		if strings.HasPrefix(l, "XRAY_") || strings.HasPrefix(l, "MTG_") || strings.HasPrefix(l, "NGINX") {
			t.Errorf("a line for something that cannot be placed: %q", l)
		}
	}
	joined := strings.Join(warnings, "\n")
	for _, want := range []string{"nginx: not a component", "xray 26.3.27: upstream ships nothing for arm64", "mtg"} {
		if !strings.Contains(joined, want) {
			t.Errorf("no warning containing %q in:\n%s", want, joined)
		}
	}
	// The commit-built component does not depend on the arch.
	if !reflect.DeepEqual(lines, []string{"AWG_MODULE_TAG=v1.0.20260611", "AWG_MODULE_SHA=" + commit}) {
		t.Errorf("lines = %v", lines)
	}
}

func TestDecodeCoreVersionsReadsOnlyTheBlock(t *testing.T) {
	got, err := DecodeCoreVersions(encode(t, map[string]any{"coreVersions": sampleVersions()}))
	if err != nil || len(got) != 3 {
		t.Fatalf("got %v, %v", got, err)
	}
	// A payload from a panel older than the block: no versions, no error.
	got, err = DecodeCoreVersions(encode(t, map[string]any{"nodeCertPem": "x"}))
	if err != nil || len(got) != 0 {
		t.Fatalf("old payload: got %v, %v", got, err)
	}
}

// The installer's half, run for real: apply_core_versions_from_payload out of
// install-iceslab-node.sh, with a stand-in agent that answers `core-env` from
// CoreEnv above. Three cases ARCH named, plus the old checkout.
//
// ⚠ Reads a file outside the package: `go test -count=1` locally. Needs bash,
// so it runs in WSL and CI and skips on a bare Windows shell.
func TestInstallerTakesThePanelsChoiceUnderAnExplicitEnv(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil || runtime.GOOS == "windows" {
		t.Skip("needs bash")
	}
	script, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "scripts", "install-iceslab-node.sh"))
	if err != nil {
		t.Fatal(err)
	}
	fn := extractFunction(t, string(script), "apply_core_versions_from_payload")

	dir := t.TempDir()
	lines, _ := CoreEnv(sampleVersions(), "amd64")
	agent := filepath.Join(dir, "iceslab-node")
	writeExec(t, agent, "#!/usr/bin/env bash\n[[ \"$1\" == core-env ]] || exit 2\ncat >/dev/null\nprintf '%s\\n' "+
		shellQuoteAll(append(lines, "NGINX_VERSION=1.0"))+"\n")
	oldAgent := filepath.Join(dir, "old-agent")
	writeExec(t, oldAgent, "#!/usr/bin/env bash\necho '{\"msg\":\"NODE_PAYLOAD env is required\"}'\nexit 1\n")

	run := func(env []string, payload, bin string) string {
		t.Helper()
		prog := "set -euo pipefail\nlog() { echo \"log: $*\" >&2; }\nwarn() { echo \"warn: $*\" >&2; }\n" +
			fn + "\nPAYLOAD=" + payload + "\napply_core_versions_from_payload " + bin + "\n" +
			"echo \"XRAY=${XRAY_VERSION:-}/${XRAY_SHA256:-} MTG=${MTG_VERSION:-}/${MTG_SHA256:-} AWG=${AWG_MODULE_TAG:-}/${AWG_MODULE_SHA:-}\"\n"
		cmd := exec.Command(bash, "-c", prog)
		cmd.Env = append([]string{"PATH=" + os.Getenv("PATH")}, env...)
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("bash: %v\n%s", err, out)
		}
		return strings.TrimSpace(string(out))
	}

	// With the payload and no env: the panel's choice.
	got := run(nil, "x", agent)
	want := "XRAY=26.3.27/" + xraySha + " MTG=2.2.8/" + mtgSha + " AWG=v1.0.20260611/" + commit
	if got != want {
		t.Errorf("payload only:\n got %s\nwant %s", got, want)
	}

	// An explicit pair wins for its core; the others still take the panel's.
	got = run([]string{"XRAY_VERSION=26.1.1", "XRAY_SHA256=" + strings.Repeat("a", 64)}, "x", agent)
	want = "XRAY=26.1.1/" + strings.Repeat("a", 64) + " MTG=2.2.8/" + mtgSha + " AWG=v1.0.20260611/" + commit
	if got != want {
		t.Errorf("explicit env:\n got %s\nwant %s", got, want)
	}

	// No payload: nothing is set, the scripts install their pin blocks.
	if got = run(nil, "''", agent); got != "XRAY=/ MTG=/ AWG=/" {
		t.Errorf("no payload: %s", got)
	}

	// A checkout older than the panel, whose agent has no core-env: pins, no failure.
	if got = run(nil, "x", oldAgent); got != "XRAY=/ MTG=/ AWG=/" {
		t.Errorf("old agent: %s", got)
	}
}

func extractFunction(t *testing.T, script, name string) string {
	t.Helper()
	start := strings.Index(script, "\n"+name+"() {")
	if start == -1 {
		t.Fatalf("%s is not in the installer", name)
	}
	end := strings.Index(script[start:], "\n}\n")
	if end == -1 {
		t.Fatalf("%s has no end", name)
	}
	return script[start : start+end+3]
}

func writeExec(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
}

func shellQuoteAll(lines []string) string {
	sort.Strings(lines)
	q := make([]string, len(lines))
	for i, l := range lines {
		q[i] = "'" + l + "'"
	}
	return strings.Join(q, " ")
}
