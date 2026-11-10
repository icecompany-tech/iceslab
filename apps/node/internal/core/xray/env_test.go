package xray

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

func TestTheCoreGetsMPTCPOffAndKeepsTheOperatorsGODEBUG(t *testing.T) {
	for have, want := range map[string]string{
		"":                         "GODEBUG=multipathtcp=0",
		"http2debug=1":             "GODEBUG=http2debug=1,multipathtcp=0",
		"multipathtcp=2,gctrace=1": "GODEBUG=multipathtcp=2,gctrace=1,multipathtcp=0",
	} {
		got := coreEnv(func(k string) string {
			if k == "GODEBUG" {
				return have
			}
			return ""
		})
		if !slices.Equal(got, []string{want}) {
			t.Errorf("GODEBUG %q: %v, want %s", have, got, want)
		}
	}
}

// The process started from the adapter's own process settings carries the
// setting: a stand-in for xray writes the environment it was given to a file.
func TestTheStartedCoreProcessHasMPTCPOff(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the stand-in core is a shell script")
	}
	t.Setenv("GODEBUG", "http2debug=1")
	dir := t.TempDir()
	bin := filepath.Join(dir, "xray")
	out := filepath.Join(dir, "env")
	script := "#!/bin/sh\nenv > " + out + ".part && mv " + out + ".part " + out + "\nexec sleep 30\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	a := New(Config{ConfigPath: filepath.Join(dir, "config.json"), BinaryPath: bin}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	proc := subprocess.New(a.processConfig(bin, filepath.Join(dir, "config.json"), 0))
	if err := proc.Start(t.Context()); err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(func() { _ = proc.Stop(t.Context()) })
	var env []byte
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if raw, err := os.ReadFile(out); err == nil {
			env = raw
			break
		}
	}
	var godebug []string
	for _, v := range strings.Split(string(env), "\n") {
		if strings.HasPrefix(v, "GODEBUG=") {
			godebug = append(godebug, v)
		}
	}
	if !slices.Equal(godebug, []string{"GODEBUG=http2debug=1,multipathtcp=0"}) {
		t.Fatalf("GODEBUG of the core process: %v", godebug)
	}
}
