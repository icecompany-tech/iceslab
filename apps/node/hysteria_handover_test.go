package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// E34, 25.09 on nl-01: the installer wrote a hysteria config and STARTED
// hysteria on 443/udp before the panel had said anything. The first push put
// an AWG inbound on 443/udp, AWG lost the port, and the node read DEGRADED
// until a second push. The installer now leaves hysteria to the agent, and
// the port-hopping redirect that sat in the same step moved to the bootstrap,
// so a hysteria added to a node later gets it too.
//
// ⚠ Reads files outside the package: `go test -count=1` locally. Needs bash.

// codeLines is the script without its comment lines.
func codeLines(s string) string {
	var b strings.Builder
	for _, line := range strings.Split(s, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		b.WriteString(line + "\n")
	}
	return b.String()
}

func TestTheInstallerStartsNoHysteria(t *testing.T) {
	blob, err := os.ReadFile(installerPath)
	if err != nil {
		t.Fatal(err)
	}
	code := codeLines(string(blob))
	for _, bad := range []*regexp.Regexp{
		regexp.MustCompile(`systemctl\s+(re)?start\s+hysteria`),
		regexp.MustCompile(`systemctl\s+enable\s+--now\s+hysteria`),
		regexp.MustCompile(`>\s*"?(/etc/hysteria/config\.yaml|\$HY_CONFIG)`),
		regexp.MustCompile(`\biptables\s+-t\s+nat`),
	} {
		if m := bad.FindString(code); m != "" {
			t.Errorf("the installer still does %q: hysteria is the agent's to start", m)
		}
	}
	// The range still reaches the bootstrap, and before the bootstrap runs.
	export := strings.Index(code, `export HYSTERIA_PORT_RANGE="$HY_PORT_RANGE"`)
	install := strings.Index(code, `install_engines "$ICESLAB_NODE_DIR/apps/node/scripts"`)
	if export == -1 || install == -1 || export > install {
		t.Errorf("--hysteria-port-range does not reach bootstrap-hysteria.sh before it runs (export at %d, install_engines at %d)", export, install)
	}
}

type hopRun struct {
	out, calls, helper, unit string
	err                      error
}

// runHop runs port_hopping from bootstrap-hysteria.sh with iptables and
// systemctl stubbed, against a helper and unit in dir.
func runHop(t *testing.T, dir, portRange string) hopRun {
	t.Helper()
	calls := filepath.Join(dir, "calls")
	bin := stubs(t, map[string]string{
		"iptables":  `echo "iptables $*" >>'` + calls + "'\n",
		"systemctl": `echo "systemctl $*" >>'` + calls + "'\n",
	})
	helper := filepath.Join(dir, "iceslab-hyhop")
	unit := filepath.Join(dir, "iceslab-hyhop.service")
	_ = os.Remove(calls)
	prog := "set -euo pipefail\nlog() { echo \"log: $*\"; }\nwarn() { echo \"warn: $*\"; }\nfail() { echo \"fail: $*\"; exit 1; }\n" +
		"PORT_RANGE='" + portRange + "'\nLISTEN_PORT=443\nHYHOP_BIN='" + helper + "'\nHYHOP_UNIT='" + unit + "'\n" +
		shellFunc(t, "bootstrap-hysteria.sh", "port_hopping") + "\nport_hopping\n"
	out, err := runBash(t, bin, prog)
	c, _ := os.ReadFile(calls)
	h, _ := os.ReadFile(helper)
	u, _ := os.ReadFile(unit)
	return hopRun{out: out, calls: string(c), helper: string(h), unit: string(u), err: err}
}

func TestHysteriaPortHoppingFollowsItsRange(t *testing.T) {
	dir := t.TempDir()

	r := runHop(t, dir, "20000-50000")
	if r.err != nil {
		t.Fatalf("%v\n%s", r.err, r.out)
	}
	if !strings.Contains(r.helper, "RANGE_IPT='20000:50000'") || !strings.Contains(r.helper, "LISTEN_PORT=443") {
		t.Errorf("helper:\n%s", r.helper)
	}
	if !strings.Contains(r.unit, "ExecStop=") || !strings.Contains(r.calls, "systemctl restart iceslab-hyhop.service") {
		t.Errorf("the redirect is not a unit that is (re)started:\n%s\n%s", r.unit, r.calls)
	}

	// A new range takes the old rule down with the helper that knows it.
	r = runHop(t, dir, "30000-40000")
	if r.err != nil {
		t.Fatalf("%v\n%s", r.err, r.out)
	}
	if !strings.Contains(r.calls, "iptables -t nat -D PREROUTING -p udp --dport 20000:50000 ") {
		t.Errorf("the old range's rule was not removed:\n%s", r.calls)
	}
	if !strings.Contains(r.helper, "RANGE_IPT='30000:40000'") {
		t.Errorf("helper:\n%s", r.helper)
	}

	// Empty turns it off, and takes away what was there.
	r = runHop(t, dir, "")
	if r.err != nil {
		t.Fatalf("%v\n%s", r.err, r.out)
	}
	if r.helper != "" || r.unit != "" || !strings.Contains(r.calls, "systemctl disable --now iceslab-hyhop.service") {
		t.Errorf("port-hopping off left the redirect:\n%s\n%s", r.calls, r.out)
	}

	// A range root would run and that is not one is refused before it is written.
	for _, bad := range []string{"80-90", "50000-20000", "1:2; reboot"} {
		r = runHop(t, t.TempDir(), bad)
		if r.err == nil || !strings.Contains(r.out, "fail: HYSTERIA_PORT_RANGE") || r.helper != "" {
			t.Errorf("%q: %v\n%s", bad, r.err, r.out)
		}
	}
}
