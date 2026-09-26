package server

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/chain"
)

// E46: an agent with a chain manager carries cascade legs through the chain
// process alone, and says so in its healthcheck, so the panel can refuse a leg
// onto a node without sing-box instead of saving a cascade nothing carries.
func TestTheHealthcheckSaysTheChainCarriesTheLegs(t *testing.T) {
	s := newServerWith(t, &fakeAdapter{name: "xray", engine: "xray"})
	if h := healthOf(t, s); h.ChainEngine != "" {
		t.Errorf("no chain manager, yet chainEngine %q", h.ChainEngine)
	}
	// A manager with no binary at all: the stand's ru-01, still a chain-only
	// agent, and that is exactly what the panel needs to know about it.
	s.cfg.Chain = chain.New(chain.Config{
		ConfigPath: filepath.Join(t.TempDir(), "chain", "config.json"),
		Logger:     slog.New(slog.NewTextHandler(io.Discard, nil)),
		Lifetime:   context.Background(),
	})
	if h := healthOf(t, s); h.ChainEngine != "singbox" {
		t.Errorf("chainEngine %q, want singbox", h.ChainEngine)
	}
}
