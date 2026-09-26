package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/chain"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
)

// chainAwareCore records what it was told, in order.
type chainAwareCore struct {
	fakeAdapter
	calls []string
}

func (c *chainAwareCore) SetChainHolds(held bool) {
	if held {
		c.calls = append(c.calls, "holds")
	} else {
		c.calls = append(c.calls, "free")
	}
}

func (c *chainAwareCore) ApplyCascade(f json.RawMessage) error {
	if len(f) == 0 {
		c.calls = append(c.calls, "cascade nil")
	} else {
		c.calls = append(c.calls, "cascade drawing")
	}
	return nil
}

// E47: before a core is handed its part of the cascade it is told whether the
// chain holds it, so a nil means "no cascade here" and not "read the copy on
// your inbound". Held also when the chain failed to start (E46): the legacy
// drawing is ignored either way, so xray must not keep a leg the chain owns.
func TestACoreIsToldTheChainHoldsTheCascadeBeforeItIsHandedIt(t *testing.T) {
	xray := &chainAwareCore{fakeAdapter: fakeAdapter{name: "xray", engine: "xray"}}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	m := chain.New(chain.Config{
		ConfigPath: filepath.Join(t.TempDir(), "chain", "config.json"),
		Logger:     logger,
		Lifetime:   context.Background(),
	})
	s, err := New(Config{Logger: logger, Payload: &payload.Payload{}, Adapters: []core.CoreAdapter{xray}, Chain: m})
	if err != nil {
		t.Fatal(err)
	}

	// A transit: the chain block carries no user-core drawing for it.
	transit := chainBlock()
	transit.UserCore = nil
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{Chain: transit})
	if len(xray.calls) != 2 || xray.calls[0] != "holds" || xray.calls[1] != "cascade nil" {
		t.Fatalf("calls %v, want [holds, cascade nil]", xray.calls)
	}
	// An entry: told first, then handed the chain's drawing.
	xray.calls = nil
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{Chain: chainBlock()})
	if len(xray.calls) != 2 || xray.calls[0] != "holds" || xray.calls[1] != "cascade drawing" {
		t.Fatalf("calls %v, want [holds, cascade drawing]", xray.calls)
	}

	// No chain in the push: the core is told it is free again.
	xray.calls = nil
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{})
	if len(xray.calls) == 0 || xray.calls[0] != "free" {
		t.Fatalf("calls %v, want the core told it is free first", xray.calls)
	}
}
