//go:build linux

package subprocess

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"testing"
	"time"
)

// TestHelperBind is not a test: it is the stand-in engine the tests below
// spawn. It binds what it is told and dies of it the way sing-box and xray do,
// so the line the agent parses is the net package's real wording, not a copy.
func TestHelperBind(t *testing.T) {
	addr := os.Getenv("ICESLAB_BIND_HELPER")
	if addr == "" {
		t.Skip("helper process only")
	}
	network := os.Getenv("ICESLAB_BIND_NETWORK")
	var err error
	if network == "udp" {
		var pc net.PacketConn
		pc, err = net.ListenPacket("udp", addr)
		if pc != nil {
			pc.Close()
		}
	} else {
		var l net.Listener
		l, err = net.Listen("tcp", addr)
		if l != nil {
			l.Close()
		}
	}
	fmt.Fprintf(os.Stderr, "FATAL start service: start inbound/socks[in-d1]: %v\n", err)
	os.Exit(1)
}

// exitReasonOfHelper runs the helper against addr and returns the reason the
// subprocess gives once it has died.
func exitReasonOfHelper(t *testing.T, network, addr string) string {
	t.Helper()
	t.Setenv("ICESLAB_BIND_HELPER", addr)
	t.Setenv("ICESLAB_BIND_NETWORK", network)
	proc := New(Config{
		Name:   "bind-helper",
		Binary: os.Args[0],
		Args:   []string{"-test.run=^TestHelperBind$"},
		Logger: newSilentLogger(),
	})
	if err := proc.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && proc.ExitReason() == "" {
		time.Sleep(20 * time.Millisecond)
	}
	return proc.ExitReason()
}

func TestExitReasonNamesWhoHoldsATCPPort(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	reason := exitReasonOfHelper(t, "tcp", l.Addr().String())
	if !strings.Contains(reason, "address already in use") {
		t.Fatalf("the helper did not die of the busy port: %q", reason)
	}
	// The holder is this test process: it has the listener open.
	want := fmt.Sprintf("(pid %d))", os.Getpid())
	if !strings.Contains(reason, "(held by ") || !strings.HasSuffix(reason, want) {
		t.Errorf("reason does not name the holder %s: %q", want, reason)
	}
}

func TestExitReasonNamesWhoHoldsAUDPPort(t *testing.T) {
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()

	reason := exitReasonOfHelper(t, "udp", pc.LocalAddr().String())
	want := fmt.Sprintf("(pid %d))", os.Getpid())
	if !strings.Contains(reason, "(held by ") || !strings.HasSuffix(reason, want) {
		t.Errorf("reason does not name the holder %s: %q", want, reason)
	}
}

func TestPortHolderLeavesTheLineAloneWhenNobodyIsFound(t *testing.T) {
	// A port that was free a moment ago: the holder has gone, which is the
	// ordinary case by the time somebody reads the reason.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()

	for _, line := range []string{
		"listen tcp " + addr + ": bind: address already in use",
		"FATAL start service: decode config: unknown field",
		"listen tcp not-an-address: bind: address already in use",
	} {
		if got := withPortHolder(line); got != line {
			t.Errorf("withPortHolder(%q) = %q, want it unchanged", line, got)
		}
	}
}
