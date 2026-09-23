package amneziawg

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// `awg` on the machine is not the same question as AmneziaWG on the machine.
//
// Found on the stand, not imagined: ru-02 carries a binary called `awg` that is
// ordinary wireguard-tools v1.0.20210914. The fork keeps every command, every
// flag and the file name, so a check that looks for the file reports the node
// as running AmneziaWG. It then accepts the config, brings the interface up and
// carries traffic with NO obfuscation at all, looking healthy the whole time,
// which is the exact failure this product exists to prevent.
func adapterWithVersion(t *testing.T, out string, err error) *Adapter {
	t.Helper()
	a := New(Config{
		Inbound: validInbound(),
		// A real file: the probe asks a binary only when there is one to ask,
		// and it is keyed by that file's size and mtime.
		AwgBin:      fakeBinary(t, "awg"),
		AwgQuickBin: "/usr/bin/awg-quick",
		ConfigPath:  t.TempDir() + "/awg0.conf",
	}, slog.Default())
	a.cfg.runCmd = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if len(args) == 1 && args[0] == "--version" {
			return []byte(out), err
		}
		return nil, nil
	}
	return a
}

func fakeBinary(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte("stand-in"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestToolsAreAmneziawgReadsTheName(t *testing.T) {
	a := adapterWithVersion(t,
		"amneziawg-tools v1.0.20260618-2 - https://github.com/amnezia-vpn/amneziawg-tools\n", nil)
	if !a.toolsAreAmneziawg() {
		t.Error("amneziawg-tools must be recognised by its own version line")
	}
}

// The stand case, and the reason this exists.
func TestWireguardToolsUnderTheNameAwgAreNotAmneziawg(t *testing.T) {
	a := adapterWithVersion(t,
		"wireguard-tools v1.0.20210914 - https://git.zx2c4.com/wireguard-tools/\n", nil)
	if a.toolsAreAmneziawg() {
		t.Error("wireguard-tools wearing the name awg must NOT count as amneziawg: " +
			"it answers every command and speaks none of the obfuscation")
	}
}

// An answer we could not get is not a yes.
func TestAVersionProbeThatFailsIsNotAYes(t *testing.T) {
	a := adapterWithVersion(t, "", errors.New("exec: not executable"))
	if a.toolsAreAmneziawg() {
		t.Error("a failed probe must count as not-amneziawg, not as installed")
	}
}

// Installed() runs on every healthcheck poll, so the probe must not fork while
// the binary stays the same; and it must ask again once the bootstrap has
// replaced it, or a repaired node (ru-02) keeps reading "not amneziawg" until
// somebody restarts the agent.
func TestTheVersionProbeAsksAgainOnlyAfterTheToolsChange(t *testing.T) {
	calls := 0
	answer := "wireguard-tools v1.0.20210914 - https://git.zx2c4.com/wireguard-tools/"
	bin := fakeBinary(t, "awg")
	a := New(Config{
		Inbound:     validInbound(),
		AwgBin:      bin,
		AwgQuickBin: "/usr/bin/awg-quick",
		ConfigPath:  t.TempDir() + "/awg0.conf",
	}, slog.Default())
	a.cfg.runCmd = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if len(args) == 1 && args[0] == "--version" {
			calls++
			return []byte(answer), nil
		}
		return nil, nil
	}

	for i := 0; i < 5; i++ {
		a.toolsAreAmneziawg()
	}
	if calls != 1 {
		t.Fatalf("the version probe ran %d times, want 1: it is on the healthcheck path", calls)
	}

	answer = "amneziawg-tools v1.0.20260618-2 - https://amnezia.org"
	if err := os.WriteFile(bin, []byte("the pinned amneziawg-tools"), 0o755); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(2 * time.Second)
	_ = os.Chtimes(bin, later, later)
	if !a.toolsAreAmneziawg() {
		t.Fatal("the tools were replaced with amneziawg-tools and the adapter still says no")
	}
	if calls != 2 {
		t.Errorf("calls = %d, want 2", calls)
	}
}

// The tools version goes out in its own field, beside the module's.
func TestToolsVersionIsAwgVersion(t *testing.T) {
	a := adapterWithVersion(t, "amneziawg-tools v1.0.20260618-2 - https://amnezia.org\n", nil)
	if got := a.ToolsVersion(); got != "1.0.20260618-2" {
		t.Fatalf("ToolsVersion = %q, want 1.0.20260618-2 (the -2 is part of the tag)", got)
	}
}

// wireguard-tools has a version too, and it is not the AmneziaWG tools'.
func TestToolsVersionIsEmptyForTheWrongProgram(t *testing.T) {
	a := adapterWithVersion(t,
		"wireguard-tools v1.0.20210914 - https://git.zx2c4.com/wireguard-tools/\n", nil)
	if got := a.ToolsVersion(); got != "" {
		t.Fatalf("ToolsVersion = %q for wireguard-tools, want empty", got)
	}
	a = adapterWithVersion(t, "", errors.New("exec: not executable"))
	if got := a.ToolsVersion(); got != "" {
		t.Fatalf("ToolsVersion = %q for a failed run, want empty", got)
	}
}
