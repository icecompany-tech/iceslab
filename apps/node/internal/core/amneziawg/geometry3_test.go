package amneziawg

import (
	"slices"
	"strings"
	"testing"
)

const testHeaderProtectionKey = "EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

// baselineGeometry3 sits inside every row with room on each side, so one
// mutation below breaks one row and nothing else.
func baselineGeometry3() Geometry3 {
	return Geometry3{
		MTU: 1376,
		Jc:  6, Jmin: 48, Jmax: 96,
		// Classes 172 / 132 / 82 / 52; S4 budget 20 + 32 + 1376 + 28 = 1456.
		S1: 24, S2: 40, S3: 18, S4: 20,
		H1: Span{1136172351, 1136272351},
		H2: Span{1532791203, 1532891203},
		H3: Span{1861209101, 1861309101},
		H4: Span{2004118712, 2004218712},
		// A DNS query for www.example.com, not Amnezia's stock response.
		I1:                     "<b 0x12340100000100000000000003777777076578616d706c6503636f6d0000010001>",
		HeaderProtectionKey:    testHeaderProtectionKey,
		ContentPaddingAddition: Span{1, 32},
		RekeyAfterTime:         Span{100, 140},
		RekeyTimeout:           Span{5, 8},
		RejectAfterTime:        Span{210, 250},
		KeepaliveTimeout:       Span{10, 17},
		MaxHandshakeAttempts:   Span{12, 18},
		RandomTrailers:         true,
	}
}

// breakRow holds, for every row of geometry3Rules, a change to the baseline
// that breaks THAT row and no other.
var breakRow = map[string]func(g *Geometry3){
	"hpk-required":           func(g *Geometry3) { g.HeaderProtectionKey = "" },
	"s-nonce-floor":          func(g *Geometry3) { g.S3 = 11 },
	"scalar-uint16":          func(g *Geometry3) { g.Jc = 70000 },
	"range-uint16":           func(g *Geometry3) { g.MaxHandshakeAttempts = Span{70000, 70010} },
	"range-order":            func(g *Geometry3) { g.MaxHandshakeAttempts = Span{18, 12} },
	"mtu-range":              func(g *Geometry3) { g.MTU = 1200 },
	"s4-mtu-budget":          func(g *Geometry3) { g.MTU, g.S4 = 1420, 64 },
	"class-sizes-distinct":   func(g *Geometry3) { g.S3 = 108 }, // 108 + 64 = 24 + 148
	"junk-order":             func(g *Geometry3) { g.Jmin = g.Jmax },
	"junk-ceiling":           func(g *Geometry3) { g.Jmax = 1200 },
	"header-bounds":          func(g *Geometry3) { g.H1 = Span{4, 4} },
	"headers-disjoint":       func(g *Geometry3) { g.H2 = g.H1 },
	"content-padding-set":    func(g *Geometry3) { g.ContentPaddingAddition = Span{0, 16} },
	"timings-set":            func(g *Geometry3) { g.RekeyTimeout = Span{0, 0} },
	"reject-floor":           func(g *Geometry3) { g.RejectAfterTime = Span{170, 250} },
	"rekey-before-reject":    func(g *Geometry3) { g.RekeyAfterTime = Span{100, 215} },
	"reject-after-keepalive": func(g *Geometry3) { g.KeepaliveTimeout = Span{10, 205} },
	"random-trailers-on":     func(g *Geometry3) { g.RandomTrailers = false },
	"i1-present":             func(g *Geometry3) { g.I1 = "" },
	"i-charset":              func(g *Geometry3) { g.I2 = "aa\nPostUp = id" },
}

func TestBaselineGeometryBreaksNoRow(t *testing.T) {
	g := baselineGeometry3()
	if v := g.violations(); len(v) != 0 {
		t.Fatalf("the baseline must be clean for the per-row cases to mean anything, breaks %v", v)
	}
}

// TestEveryRowIsBrokenAloneByItsCase is the "test on every row". A row without
// a case fails here, so the table cannot grow a bound nobody has seen refuse.
func TestEveryRowIsBrokenAloneByItsCase(t *testing.T) {
	for _, r := range geometry3Rules {
		t.Run(r.id, func(t *testing.T) {
			mutate, ok := breakRow[r.id]
			if !ok {
				t.Fatalf("row %s has no case in breakRow", r.id)
			}
			g := baselineGeometry3()
			mutate(&g)
			if got := g.violations(); !slices.Equal(got, []string{r.id}) {
				t.Fatalf("the case for %s must break that row alone, broke %v", r.id, got)
			}
			err := g.validate()
			if err == nil {
				t.Fatal("validate let it through")
			}
			// The refusal names the row and what it spares the operator, so a
			// failed apply on a node reads as a reason and not a mystery.
			if !strings.Contains(err.Error(), r.id) || !strings.Contains(err.Error(), string(r.breaks)) {
				t.Errorf("refusal %q does not name the row %s and its failure %q", err, r.id, r.breaks)
			}
		})
	}
	for id := range breakRow {
		if !slices.ContainsFunc(geometry3Rules, func(r geometryRule) bool { return r.id == id }) {
			t.Errorf("breakRow has a case for %s, which is not a row", id)
		}
	}
}

func TestEveryRowSaysWhatItCatchesAndWhereItWasRead(t *testing.T) {
	known := []failureMode{failRefusedByTools, failRefusedByEngine, failSilentInTools,
		failRefusedByClient, failStallsTunnel, failExhaustsMemory, failInjection}
	seen := map[string]bool{}
	for _, r := range geometry3Rules {
		if seen[r.id] {
			t.Errorf("row id %s is used twice", r.id)
		}
		seen[r.id] = true
		if !slices.Contains(known, r.breaks) {
			t.Errorf("row %s names an unknown failure %q", r.id, r.breaks)
		}
		if strings.TrimSpace(r.source) == "" {
			t.Errorf("row %s does not say where its bound was read", r.id)
		}
	}
}

// TestTheUint16RowsAreTwoDifferentThings pins the correction of 23.09: the
// scalar fields and the range fields both stop at 65535 here, for opposite
// reasons. A scalar above it makes awg setconf exit (tools config.c:406); a
// range above it is accepted and cut to a uint16 (tools type.c:45-58). Folding
// the two into one row would hide that the second is the one that matters.
func TestTheUint16RowsAreTwoDifferentThings(t *testing.T) {
	rows := map[string]failureMode{}
	for _, r := range geometry3Rules {
		rows[r.id] = r.breaks
	}
	if rows["scalar-uint16"] != failRefusedByTools {
		t.Errorf("scalar-uint16 must be %q, got %q", failRefusedByTools, rows["scalar-uint16"])
	}
	if rows["range-uint16"] != failSilentInTools {
		t.Errorf("range-uint16 must be %q, got %q", failSilentInTools, rows["range-uint16"])
	}
}

// TestTheEdgesAreInside checks every bound from the accepting side: a table
// that is off by one refuses a geometry the engine would have run.
func TestTheEdgesAreInside(t *testing.T) {
	cases := map[string]func(g *Geometry3){
		"S at the nonce floor":          func(g *Geometry3) { g.S3 = 12 },
		"S4 spending the whole budget":  func(g *Geometry3) { g.S4 = 1500 - 32 - 1376 - 28 },
		"Jmax one above Jmin":           func(g *Geometry3) { g.Jmin = g.Jmax - 1 },
		"Jmax at the ceiling":           func(g *Geometry3) { g.Jmax = 1000 },
		"H at the low edge":             func(g *Geometry3) { g.H1 = Span{16, 16} },
		"H at the high edge":            func(g *Geometry3) { g.H4 = Span{2147483647, 2147483647} },
		"a single-value H":              func(g *Geometry3) { g.H2 = Span{1532791203, 1532791203} },
		"ranges at uint16 max":          func(g *Geometry3) { g.MaxHandshakeAttempts = Span{65535, 65535} },
		"RejectAfterTime at the floor":  func(g *Geometry3) { g.RejectAfterTime = Span{180, 200} },
		"content padding of exactly 1":  func(g *Geometry3) { g.ContentPaddingAddition = Span{1, 1} },
		"MTU at the low edge":           func(g *Geometry3) { g.MTU = 1280 },
		"MTU at 1420 with S4 that fits": func(g *Geometry3) { g.MTU, g.S4 = 1420, 20 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			g := baselineGeometry3()
			mutate(&g)
			if v := g.violations(); len(v) != 0 {
				t.Errorf("refused at the edge: %v", v)
			}
		})
	}
}

// deviceKeys31 are the [Interface] keys amneziawg-tools v3.1.20260812 parses
// (src/config.c:481-583). A key outside it fails `awg setconf` with "Line
// unrecognized", and fails it on the node, not here.
var deviceKeys31 = []string{
	"ListenPort", "FwMark", "PrivateKey", "Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4",
	"H1", "H2", "H3", "H4", "I1", "I2", "I3", "I4", "I5", "HeaderProtectionKey",
	"ContentPaddingAddition", "RekeyAfterTime", "RekeyTimeout", "RejectAfterTime",
	"KeepaliveTimeout", "MaxHandshakeAttempts", "RandomTrailers", "DisableCookies",
}

func TestInterfaceLinesAreKeysThe31ToolsParse(t *testing.T) {
	lines, err := baselineGeometry3().interfaceLines()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, l := range lines {
		k, v, ok := strings.Cut(l, " = ")
		if !ok || v == "" {
			t.Fatalf("line %q is not `Key = value`", l)
		}
		if !slices.Contains(deviceKeys31, k) {
			t.Errorf("%s is not a key the 3.1 tools parse", k)
		}
		if seen[k] {
			t.Errorf("%s rendered twice", k)
		}
		seen[k] = true
	}
	for _, must := range []string{"HeaderProtectionKey", "ContentPaddingAddition", "RandomTrailers", "I1", "RejectAfterTime"} {
		if !seen[must] {
			t.Errorf("%s missing from the render", must)
		}
	}
	joined := strings.Join(lines, "\n")
	for _, want := range []string{"H1 = 1136172351-1136272351", "ContentPaddingAddition = 1-32", "RandomTrailers = on"} {
		if !strings.Contains(joined, want) {
			t.Errorf("render lacks %q", want)
		}
	}
}

func TestInterfaceLinesRefuseABrokenGeometry(t *testing.T) {
	g := baselineGeometry3()
	g.Jmin = g.Jmax
	if _, err := g.interfaceLines(); err == nil || !strings.Contains(err.Error(), "junk-order") {
		t.Fatalf("a geometry that would allocate 4 GB per junk packet rendered: %v", err)
	}
}
