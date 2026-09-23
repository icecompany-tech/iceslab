package main

import (
	"io"
	"log/slog"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

// An agent with NO engine configured still names every engine it knows, each
// as not installed. Before core.Absent, such a node reported only hysteria (the
// one adapter registered unconditionally), and "not installed" read the same as
// "never mentioned" on the node card.
func TestAnAgentWithNothingConfiguredReportsSevenEnginesAllAbsent(t *testing.T) {
	for _, k := range []string{"XRAY_BINARY", "SINGBOX_BINARY", "HYSTERIA_BINARY", "MTG_BINARY", "MITA_BINARY"} {
		t.Setenv(k, "")
	}
	// These two are probed by path with a default, so point them at nothing.
	nowhere := t.TempDir()
	t.Setenv("AMNEZIAWG_BIN", filepath.Join(nowhere, "awg"))
	t.Setenv("CADDY_NAIVE_BIN", filepath.Join(nowhere, "caddy-naive"))

	adapters := buildAdapters(slog.New(slog.NewTextHandler(io.Discard, nil)))

	var engines []string
	for _, a := range adapters {
		engines = append(engines, a.Engine())
		inst, ok := a.(core.Installable)
		if !ok || inst.Installed() {
			t.Errorf("%s/%s: want installed:false, reported installable=%v", a.Name(), a.Engine(), ok)
		}
		// Idle, not down: a node whose engines are all absent must not read
		// as degraded because of them. hysteria is its own adapter here, in
		// callback-only mode, and answers for itself as it always has.
		if !core.IsAbsent(a) {
			continue
		}
		if p, ok := a.(core.Provisionable); !ok || p.Provisioned() {
			t.Errorf("%s/%s: an absent engine must say it is not provisioned", a.Name(), a.Engine())
		}
	}
	sort.Strings(engines)
	want := "amneziawg hysteria mieru mtproto naive singbox xray"
	if got := strings.Join(engines, " "); got != want {
		t.Fatalf("engines = %q, want exactly one row per known engine: %q", got, want)
	}
}

// Every real core answers its version, so the node card shows one for each
// engine and not only for xray (until 2026-09-23 xray was the one Versioner).
// A stand-in for a missing engine does not: there is no binary to ask.
func TestEveryRealCoreAnswersItsVersion(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	t.Setenv("XRAY_BINARY", "/nonexistent/xray")
	t.Setenv("SINGBOX_BINARY", "/nonexistent/sing-box")
	t.Setenv("MTG_BINARY", "/nonexistent/mtg")
	t.Setenv("MITA_BINARY", "/nonexistent/mita")
	for _, a := range buildAdapters(logger) {
		_, versioned := a.(core.Versioner)
		if core.IsAbsent(a) {
			if versioned {
				t.Errorf("%s/%s: a stand-in answers a version", a.Name(), a.Engine())
			}
			continue
		}
		if !versioned {
			t.Errorf("%s/%s answers no version", a.Name(), a.Engine())
		}
	}
}

// A registered engine keeps its own adapters and gets no stand-in beside it: a
// second row for the same engine would say "installed" and "not installed" at
// once.
func TestARegisteredEngineGetsNoStandIn(t *testing.T) {
	registered := []core.CoreAdapter{core.NewAbsent("xray", "xray")}
	out := withAbsentEngines(registered)
	count := 0
	for _, a := range out {
		if a.Engine() == "xray" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("xray appears %d times, want 1", count)
	}
	if len(out) != len(knownEngines) {
		t.Fatalf("got %d rows, want %d", len(out), len(knownEngines))
	}
}
