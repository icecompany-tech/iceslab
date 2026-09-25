package server

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// E37, 25.09 on nl-01: the host's stub resolver stopped answering, every xray
// host on the node died, and every core still ran, so the node read ONLINE. The
// healthcheck asks the resolver itself now.
func TestADeadSystemResolverDegradesANodeWhoseCoresAllRun(t *testing.T) {
	xray := &fakeAdapter{name: "xray", engine: "xray"}
	s := newServerWith(t, xray)

	var asked int
	s.cfg.ResolverProbe = func(ctx context.Context) error {
		asked++
		if _, ok := ctx.Deadline(); !ok {
			t.Error("the probe was given no deadline")
		}
		return errors.New("lookup www.google.com on 127.0.0.53:53: read: connection refused")
	}
	h := healthOf(t, s)
	if asked != 1 {
		t.Fatalf("the resolver was asked %d times in one healthcheck", asked)
	}
	if h.Status != "degraded" || h.Reason != dto.ResolverDownReason {
		t.Errorf("status %q reason %q, want degraded with %q", h.Status, h.Reason, dto.ResolverDownReason)
	}
	if !coreOf(h, "xray").Running {
		t.Error("the core itself was marked down: the resolver is the machine's, not the core's")
	}

	// A resolver that answers says nothing.
	s.cfg.ResolverProbe = func(context.Context) error { return nil }
	if h := healthOf(t, s); h.Status != "ok" || h.Reason != "" {
		t.Errorf("a working resolver: status %q reason %q", h.Status, h.Reason)
	}
}

// A resolver that hangs is cut at the timeout: the healthcheck answers
// degraded instead of waiting for it.
func TestAHangingResolverIsCutAtTheTimeout(t *testing.T) {
	s := newServerWith(t, &fakeAdapter{name: "xray", engine: "xray"})
	s.cfg.ResolverProbe = func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}
	start := time.Now()
	h := healthOf(t, s)
	if took := time.Since(start); took > resolverProbeTimeout+time.Second {
		t.Errorf("the healthcheck took %v", took)
	}
	if h.Reason != dto.ResolverDownReason {
		t.Errorf("reason %q", h.Reason)
	}
}
