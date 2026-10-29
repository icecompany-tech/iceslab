package hysteria

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// A-265: the unit systemd runs gets HYSTERIA_LOG_LEVEL=error from a runtime
// drop-in when its environment lacks it, once; a unit that has it (a new
// installer's, or the drop-in already in place) is left alone, with no reload
// and no restart, unless its running process was started without it.
type unitFake struct {
	mu    sync.Mutex
	env   string // what `systemctl show -p Environment --value` answers
	pid   string // `-p MainPID`; "" answers 0, not running
	start string // `-p ExecMainStartTimestamp --timestamp=unix`, "@<sec>"
	calls []string
}

func (f *unitFake) run(_ context.Context, name string, args ...string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, name+" "+strings.Join(args, " "))
	return nil
}

func (f *unitFake) output(_ context.Context, name string, args ...string) ([]byte, error) {
	if name != "systemctl" || len(args) < 1 || args[0] != "show" {
		return nil, errors.New("unexpected command")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case slices.Contains(args, "MainPID"):
		if f.pid == "" {
			return []byte("0\n"), nil
		}
		return []byte(f.pid + "\n"), nil
	case slices.Contains(args, "ExecMainStartTimestamp"):
		return []byte(f.start + "\n"), nil
	}
	return []byte(f.env + "\n"), nil
}

func unitAdapter(t *testing.T, f *unitFake, unit string) (*Adapter, string) {
	t.Helper()
	dir := t.TempDir()
	return New(Config{
		ServiceUnit:    unit,
		RunCmd:         f.run,
		CmdOutput:      f.output,
		RuntimeUnitDir: dir,
		ProcRoot:       filepath.Join(dir, "proc"),
	}, slog.New(slog.NewTextHandler(io.Discard, nil))), dir
}

// procEnviron writes the environment a fake process was started with.
func procEnviron(t *testing.T, a *Adapter, pid string, env ...string) {
	t.Helper()
	d := filepath.Join(a.cfg.ProcRoot, pid)
	if err := os.MkdirAll(d, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "environ"), []byte(strings.Join(env, "\x00")+"\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// AUDT to A-265: the drop-in was written, its try-restart failed, and the next
// start found the level in the unit's environment and did nothing, so hysteria
// ran on at the old level. The process is asked what it runs with.
func TestAProcessStartedBeforeTheDropInIsRestartedOnTheNextStart(t *testing.T) {
	f := &unitFake{env: "HYSTERIA_LOG_LEVEL=error", pid: "4242"}
	a, _ := unitAdapter(t, f, "hysteria")
	procEnviron(t, a, "4242", "PATH=/usr/bin", "HYSTERIA_LOG_LEVEL=warn")
	a.ensureUnitLogLevel(context.Background())
	if strings.Join(f.calls, ";") != "systemctl try-restart hysteria.service" {
		t.Fatalf("calls %v, want one try-restart for a process on the old level", f.calls)
	}

	// The restarted process has it: nothing more.
	procEnviron(t, a, "4242", "PATH=/usr/bin", "HYSTERIA_LOG_LEVEL=error")
	f.calls = nil
	a.ensureUnitLogLevel(context.Background())
	if len(f.calls) != 0 {
		t.Fatalf("a process on the level was restarted: %v", f.calls)
	}

	// Not running: it will start with the unit's environment.
	f.pid, f.calls = "", nil
	a.ensureUnitLogLevel(context.Background())
	if len(f.calls) != 0 {
		t.Fatalf("a unit that is not running was restarted: %v", f.calls)
	}
}

// Where /proc/<pid>/environ cannot be read: the process started before our
// drop-in was written cannot carry its level.
func TestWithoutItsEnvironmentTheStartIsComparedWithTheDropIn(t *testing.T) {
	f := &unitFake{env: "HYSTERIA_LOG_LEVEL=error", pid: "4242"}
	a, dir := unitAdapter(t, f, "hysteria")
	dropIn := filepath.Join(dir, "hysteria.service.d", "iceslab-log.conf")
	if err := os.MkdirAll(filepath.Dir(dropIn), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dropIn, logDropIn(), 0o644); err != nil {
		t.Fatal(err)
	}
	written := time.Now()
	if err := os.Chtimes(dropIn, written, written); err != nil {
		t.Fatal(err)
	}

	f.start = fmt.Sprintf("@%d", written.Add(-time.Hour).Unix())
	a.ensureUnitLogLevel(context.Background())
	if strings.Join(f.calls, ";") != "systemctl try-restart hysteria.service" {
		t.Fatalf("calls %v, want a try-restart for a process older than the drop-in", f.calls)
	}

	f.start, f.calls = fmt.Sprintf("@%d", written.Add(time.Minute).Unix()), nil
	a.ensureUnitLogLevel(context.Background())
	if len(f.calls) != 0 {
		t.Fatalf("a process started after the drop-in was restarted: %v", f.calls)
	}
}

func TestALegacyUnitGetsTheLogLevelOnceAndIsRestartedIfRunning(t *testing.T) {
	f := &unitFake{env: "PATH=/usr/bin"}
	a, dir := unitAdapter(t, f, "hysteria")
	a.ensureUnitLogLevel(context.Background())

	body, err := os.ReadFile(filepath.Join(dir, "hysteria.service.d", "iceslab-log.conf"))
	if err != nil {
		t.Fatalf("drop-in not written (the unit name needs its .service suffix): %v", err)
	}
	if !strings.Contains(string(body), "[Service]\nEnvironment=HYSTERIA_LOG_LEVEL=error\n") {
		t.Fatalf("drop-in body:\n%s", body)
	}
	if strings.Join(f.calls, ";") != "systemctl daemon-reload;systemctl try-restart hysteria.service" {
		t.Fatalf("calls %v, want daemon-reload then try-restart (a stopped unit stays stopped)", f.calls)
	}

	// systemd now carries it: the next start reads it and does nothing.
	f.env = "PATH=/usr/bin HYSTERIA_LOG_LEVEL=error"
	f.calls = nil
	a.ensureUnitLogLevel(context.Background())
	if len(f.calls) != 0 {
		t.Fatalf("a unit that carries the level was touched again: %v", f.calls)
	}
}

func TestANewInstallersUnitIsLeftAlone(t *testing.T) {
	f := &unitFake{env: "HYSTERIA_LOG_LEVEL=error"}
	a, dir := unitAdapter(t, f, "hysteria.service")
	a.ensureUnitLogLevel(context.Background())
	if len(f.calls) != 0 {
		t.Fatalf("calls %v on a unit that already logs at error", f.calls)
	}
	if _, err := os.Stat(filepath.Join(dir, "hysteria.service.d")); !os.IsNotExist(err) {
		t.Fatalf("a drop-in was written for a unit that needs none: %v", err)
	}
}

func TestAnotherLevelInTheUnitIsOverridden(t *testing.T) {
	// info: a unit someone set by hand. warn: what bootstrap-hysteria.sh wrote
	// until 26.10, which still names the client on every broken connection.
	for _, level := range []string{"info", "warn"} {
		f := &unitFake{env: "HYSTERIA_LOG_LEVEL=" + level}
		a, _ := unitAdapter(t, f, "hysteria.service")
		a.ensureUnitLogLevel(context.Background())
		if len(f.calls) != 2 {
			t.Fatalf("%s: calls %v, want the drop-in applied (it comes after the unit's line, the later wins)", level, f.calls)
		}
		// After the reload systemd answers the later assignment: one restart.
		f.env, f.calls = "HYSTERIA_LOG_LEVEL=error", nil
		a.ensureUnitLogLevel(context.Background())
		if len(f.calls) != 0 {
			t.Fatalf("%s: restarted again on the next start: %v", level, f.calls)
		}
	}
}

func TestTheDropInIsWrittenAtStartInUnitMode(t *testing.T) {
	f := &unitFake{env: ""}
	a, dir := unitAdapter(t, f, "hysteria")
	a.cfg.BinaryPath = "/usr/local/bin/hysteria"
	a.cfg.AuthCallbackPort = freeTCP(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Stop(context.Background()) })
	if _, err := os.Stat(filepath.Join(dir, "hysteria.service.d", "iceslab-log.conf")); err != nil {
		t.Fatalf("Start in unit mode wrote no drop-in: %v", err)
	}
}
