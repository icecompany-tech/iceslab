package amneziawg

import (
	"context"
	"errors"
	"log/slog"
	"testing"
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
		// Bare names so BinaryPresent resolves them through PATH rather than
		// stat'ing a path that does not exist on a test machine. The question
		// under test is the VERSION probe; presence is covered by its own test.
		AwgBin:      "/usr/bin/awg",
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

// Installed() runs on every healthcheck poll, so the probe must fork once.
func TestTheVersionProbeIsAskedOnce(t *testing.T) {
	calls := 0
	a := New(Config{
		Inbound:     validInbound(),
		AwgBin:      "/usr/bin/awg",
		AwgQuickBin: "/usr/bin/awg-quick",
		ConfigPath:  t.TempDir() + "/awg0.conf",
	}, slog.Default())
	a.cfg.runCmd = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if len(args) == 1 && args[0] == "--version" {
			calls++
			return []byte("amneziawg-tools v1.0.20260618-2"), nil
		}
		return nil, nil
	}

	for i := 0; i < 5; i++ {
		a.toolsAreAmneziawg()
	}
	if calls != 1 {
		t.Errorf("the version probe ran %d times, want 1: it is on the healthcheck path", calls)
	}
}
