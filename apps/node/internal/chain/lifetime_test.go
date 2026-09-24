package chain

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// E21 (stand, 24.09): the chain process died 0.4 s after every push with
// "signal: killed". Apply started it with the PUSH REQUEST's context, the
// request context is cancelled once the response is sent, and the subprocess is
// bound to its start context by exec.CommandContext, whose cancel is SIGKILL to
// the group. `sing-box check` was clean and a manual run lived, so every test
// that stopped at the door passed; none of them ever let the process outlive
// the request, which is the only thing a node does with it.
//
// Here the process is real (a shell script standing in for sing-box that
// sleeps), the request context is cancelled the way a sent response cancels it,
// and the process has to still be running afterwards.

// fakeEngine writes a stand-in for the sing-box binary: `version` answers,
// `run` sleeps, optionally after printing a line to stderr and exiting.
func fakeEngine(t *testing.T, runBody string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("needs a unix shell: the agent runs on Linux")
	}
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("needs sh")
	}
	path := filepath.Join(t.TempDir(), "sing-box")
	script := "#!/bin/sh\ncase \"$1\" in\n  version) echo 'sing-box version 1.13.14' ;;\n  check) exit 0 ;;\n  run) " +
		runBody + " ;;\nesac\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestTheChainOutlivesThePushRequestThatStartedIt(t *testing.T) {
	bin := fakeEngine(t, "exec sleep 60")
	lifetime, stopAgent := context.WithCancel(context.Background())
	defer stopAgent()
	m := New(Config{
		BinaryPath: bin,
		ConfigPath: filepath.Join(t.TempDir(), "chain", "config.json"),
		Logger:     quiet(),
		Lifetime:   lifetime,
	})
	defer func() { _ = m.stop("test over") }()

	request, respond := context.WithCancel(context.Background())
	if err := m.Apply(request, block(goldenConfig)); err != nil {
		t.Fatalf("apply: %v", err)
	}
	// The handler returns and the server cancels the request context.
	respond()

	// E21 killed it within half a second; give it well past that.
	time.Sleep(1500 * time.Millisecond)
	st := m.Status()
	if st == nil || !st.Running {
		t.Fatalf("the chain died with the push request that started it: %+v", st)
	}

	// And the agent's own lifetime still ends it.
	stopAgent()
	deadline := time.Now().Add(5 * time.Second)
	for m.Status().Running && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if m.Status().Running {
		t.Fatal("the chain outlived the agent's lifetime")
	}
}

func TestAChainThatDiesSaysHowAndWithWhatLastWords(t *testing.T) {
	// "left no reason" was the whole report of E21 while the agent's own log
	// said "signal: killed". The exit status and the engine's last stderr line
	// are what the panel shows now.
	bin := fakeEngine(t, "echo 'FATAL[0000] start service: listen tcp 127.0.0.1:26001: bind: address already in use' >&2; exit 1")
	m := New(Config{
		BinaryPath: bin,
		ConfigPath: filepath.Join(t.TempDir(), "chain", "config.json"),
		Logger:     quiet(),
	})
	defer func() { _ = m.stop("test over") }()
	if err := m.Apply(context.Background(), block(goldenConfig)); err != nil {
		t.Fatalf("apply: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	var reason string
	for time.Now().Before(deadline) {
		if st := m.Status(); st != nil && !st.Running && strings.Contains(st.Error, "exit status 1") {
			reason = st.Error
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !strings.Contains(reason, "exit status 1") || !strings.Contains(reason, "address already in use") {
		t.Fatalf("the reason does not say how the chain died: %q", reason)
	}
	if strings.Contains(reason, "left no reason") {
		t.Fatalf("still the old non-answer: %q", reason)
	}
}
