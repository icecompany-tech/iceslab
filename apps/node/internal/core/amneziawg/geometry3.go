package amneziawg

import (
	"fmt"
	"strings"
)

// Geometry3 is the obfuscation geometry of an AmneziaWG 3.1 interface: the
// part both ends must agree on, minted once per NODE and stored, the way leg
// credentials are. Protocol 1.x does not use it and its render does not change.
//
// Not wired to the wire contract yet (that is Ф7.1, after the Ф7.0
// measurement). What lives here now is the table of bounds, because it does
// not depend on how version 3 is run: kernel module or userspace daemon read
// the same keys the same way.
//
// DisableCookies is deliberately absent. Whether `on` is safe depends on the
// runtime, not the geometry: up to amneziawg-go 3.1.20260814 it locked a
// node's own users out under a flood (awg3-geometry.sh:211-216). It joins when
// Ф7.0 has decided between the module and the daemon.
type Geometry3 struct {
	// Tunnel MTU the geometry was minted for. S4 is paid out of it.
	MTU int

	Jc, Jmin, Jmax int
	S1, S2, S3, S4 int

	// H1-H4 are ranges in 3.1 (tools type.c u32_range_from_string); a single
	// value is a range with Lo == Hi.
	H1, H2, H3, H4 Span

	I1, I2, I3, I4, I5 string

	HeaderProtectionKey    string
	ContentPaddingAddition Span

	RekeyAfterTime, RekeyTimeout, RejectAfterTime Span
	KeepaliveTimeout, MaxHandshakeAttempts        Span

	RandomTrailers bool
}

// Span is an inclusive range as the 3.1 tools write it: "lo" or "lo-hi".
// int64 on purpose, so a value the tools would truncate can be represented and
// refused here instead of being cut to a uint16 on the way in.
type Span struct{ Lo, Hi int64 }

func (s Span) String() string {
	if s.Lo == s.Hi {
		return fmt.Sprintf("%d", s.Lo)
	}
	return fmt.Sprintf("%d-%d", s.Lo, s.Hi)
}

// What goes wrong when a row is broken. Each row names ONE, because "refuse
// here" means something different when the alternative is a loud failure
// somewhere else and when the alternative is nothing at all.
type failureMode string

const (
	// awg setconf exits non-zero: loud, the node reports a failed apply.
	failRefusedByTools failureMode = "refused by tools"
	// the kernel or the daemon refuses the device: loud, same place.
	failRefusedByEngine failureMode = "refused by engine"
	// the tools accept and store something else: nobody is told.
	failSilentInTools failureMode = "silent in tools"
	// the server runs; the client app refuses the config: the operator
	// hears it from a user.
	failRefusedByClient failureMode = "refused by client"
	// everything loads and the tunnel handshakes but stalls or never
	// carries data: the worst kind, looks like DPI.
	failStallsTunnel failureMode = "stalls the tunnel"
	// the daemon allocates without bound: an outage, not an error.
	failExhaustsMemory failureMode = "exhausts memory"
	// the value reaches the INI and can inject into it.
	failInjection failureMode = "injects into the config"
)

type geometryRule struct {
	id     string
	breaks failureMode
	// source is where the bound was read, file:line at a named tag.
	source string
	check  func(g Geometry3) error
}

const (
	nonceFloor      = 12 // HEADER_PROTECTION_NONCE_SIZE
	uint16Max       = 65535
	headerLow       = 16      // 0 reads as unset, 1..4 are plain WireGuard types
	headerCeiling   = 1 << 31 // exclusive; nothing downstream has to care about sign
	stockRejectTime = 180     // what a client that does not parse RejectAfterTime runs
	junkCeiling     = 1000
	mtuMin          = 1280 // the IPv6 minimum a tunnel must carry
	mtuMax          = 1420 // awg-quick's own default, 1500 minus the IPv6 overhead
)

// geometry3Rules is the table of Ф7.3. One row per bound, each with a test in
// geometry3_test.go that breaks that row alone; the test refuses a row without
// a case, so a row cannot be added here unguarded.
var geometry3Rules = []geometryRule{
	{
		id: "hpk-required", breaks: failRefusedByEngine,
		source: "awg3-entrypoint refuses to start without it; netlink.c:953 v3.1.20260906",
		check: func(g Geometry3) error {
			if g.HeaderProtectionKey == "" {
				return fmt.Errorf("HeaderProtectionKey is required on a 3.1 interface; without it the interface speaks 1.x")
			}
			if err := validateWGKey(g.HeaderProtectionKey); err != nil {
				return fmt.Errorf("HeaderProtectionKey: %w", err)
			}
			return nil
		},
	},
	{
		id: "s-nonce-floor", breaks: failRefusedByEngine,
		source: "module netlink.c:810-849 and :956-976 v3.1.20260906 refuse S below the 12-byte header nonce",
		check: func(g Geometry3) error {
			for i, s := range []int{g.S1, g.S2, g.S3, g.S4} {
				if s < nonceFloor {
					return fmt.Errorf("S%d=%d is below the %d-byte header cipher nonce", i+1, s, nonceFloor)
				}
			}
			return nil
		},
	},
	{
		id: "scalar-uint16", breaks: failRefusedByTools,
		source: "tools config.c:395-411 v3.1.20260812 parse_uint16 exits 1 above UINT16_MAX",
		check: func(g Geometry3) error {
			for _, f := range []struct {
				name string
				v    int
			}{{"Jc", g.Jc}, {"Jmin", g.Jmin}, {"Jmax", g.Jmax}, {"S1", g.S1}, {"S2", g.S2}, {"S3", g.S3}, {"S4", g.S4}} {
				if f.v < 0 || f.v > uint16Max {
					return fmt.Errorf("%s=%d does not fit a uint16; awg setconf would exit", f.name, f.v)
				}
			}
			return nil
		},
	},
	{
		id: "range-uint16", breaks: failSilentInTools,
		source: "tools type.c:40-58 v3.1.20260812 u16_range_from_string checks UINT32_MAX, stores uint16",
		check: func(g Geometry3) error {
			for name, s := range g.u16Spans() {
				if s.Hi > uint16Max || s.Lo > uint16Max {
					return fmt.Errorf("%s=%s would be truncated to a uint16 by the tools without a word (70000 becomes 4464)", name, s)
				}
			}
			return nil
		},
	},
	{
		id: "range-order", breaks: failRefusedByTools,
		source: "tools type.c:52 v3.1.20260812 refuses hi < lo",
		check: func(g Geometry3) error {
			all := g.u16Spans()
			for name, s := range g.headerSpans() {
				all[name] = s
			}
			for name, s := range all {
				if s.Lo < 0 || s.Hi < s.Lo {
					return fmt.Errorf("%s=%d-%d is inverted or negative", name, s.Lo, s.Hi)
				}
			}
			return nil
		},
	},
	{
		id: "mtu-range", breaks: failStallsTunnel,
		source: "S4 budget below is computed from it; 1280 is the IPv6 minimum, 1420 awg-quick's default",
		check: func(g Geometry3) error {
			if g.MTU < mtuMin || g.MTU > mtuMax {
				return fmt.Errorf("MTU=%d is outside [%d, %d]", g.MTU, mtuMin, mtuMax)
			}
			return nil
		},
	},
	{
		id: "s4-mtu-budget", breaks: failStallsTunnel,
		source: "awg3-geometry.sh:96-98 (amnezia-shared-panel 2066a80): S4 + 32 + MTU + 28 <= 1500",
		check: func(g Geometry3) error {
			if total := g.S4 + 32 + g.MTU + 28; total > 1500 {
				return fmt.Errorf("S4=%d with MTU=%d makes a %d-byte datagram, above 1500: full-size packets fragment or drop", g.S4, g.MTU, total)
			}
			return nil
		},
	},
	{
		id: "class-sizes-distinct", breaks: failRefusedByClient,
		source: "awg3-geometry.sh:105-122 (2066a80): the server tolerates it, the client settings refuse it",
		check: func(g Geometry3) error {
			sizes := []struct {
				name string
				n    int
			}{{"init (S1+148)", g.S1 + 148}, {"response (S2+92)", g.S2 + 92}, {"cookie (S3+64)", g.S3 + 64}, {"transport (S4+32)", g.S4 + 32}}
			for i := range sizes {
				for j := i + 1; j < len(sizes); j++ {
					if sizes[i].n == sizes[j].n {
						return fmt.Errorf("packet classes %s and %s are both %d bytes", sizes[i].name, sizes[j].name, sizes[i].n)
					}
				}
			}
			return nil
		},
	},
	{
		id: "junk-order", breaks: failExhaustsMemory,
		source: "awg3-geometry.sh:81-86 (2066a80): min + fastrandn(max-min) on uint32, ~4 GB per junk packet",
		check: func(g Geometry3) error {
			if g.Jmin >= g.Jmax {
				return fmt.Errorf("Jmin=%d must be strictly below Jmax=%d", g.Jmin, g.Jmax)
			}
			return nil
		},
	},
	{
		id: "junk-ceiling", breaks: failStallsTunnel,
		source: "awg3-geometry.sh:230 (2066a80)",
		check: func(g Geometry3) error {
			if g.Jmax > junkCeiling {
				return fmt.Errorf("Jmax=%d is above %d: junk larger than the path MTU", g.Jmax, junkCeiling)
			}
			return nil
		},
	},
	{
		id: "header-bounds", breaks: failSilentInTools,
		source: "awg3-geometry.sh:53-61 (2066a80): 0 round-trips as unset, 1..4 are plain WireGuard types",
		check: func(g Geometry3) error {
			for name, s := range g.headerSpans() {
				if s.Lo < headerLow || s.Hi >= headerCeiling {
					return fmt.Errorf("%s=%s must lie in [%d, 2^31)", name, s, headerLow)
				}
			}
			return nil
		},
	},
	{
		id: "headers-disjoint", breaks: failRefusedByEngine,
		source: "awg3-geometry.sh:54 (2066a80): amneziawg-go refuses overlapping headers; receive.c:40-91 tells classes apart by H",
		check: func(g Geometry3) error {
			hs := []struct {
				name string
				s    Span
			}{{"H1", g.H1}, {"H2", g.H2}, {"H3", g.H3}, {"H4", g.H4}}
			for i := range hs {
				for j := i + 1; j < len(hs); j++ {
					if hs[i].s.Lo <= hs[j].s.Hi && hs[j].s.Lo <= hs[i].s.Hi {
						return fmt.Errorf("%s=%s overlaps %s=%s", hs[i].name, hs[i].s, hs[j].name, hs[j].s)
					}
				}
			}
			return nil
		},
	},
	{
		id: "content-padding-set", breaks: failStallsTunnel,
		source: "awg3-geometry.sh:183-187 (2066a80); send.c:254 v3.1.20260906: zero range falls back to pad-to-16",
		check: func(g Geometry3) error {
			if g.ContentPaddingAddition.Lo < 1 {
				return fmt.Errorf("ContentPaddingAddition=%s must start at 1; zero keeps the multiple-of-16 lattice a classifier reads", g.ContentPaddingAddition)
			}
			return nil
		},
	},
	{
		id: "timings-set", breaks: failSilentInTools,
		source: "awg3-geometry.sh:56 (2066a80): a 0-0 range reads back as unset",
		check: func(g Geometry3) error {
			for name, s := range g.timingSpans() {
				if s.Lo < 1 {
					return fmt.Errorf("%s=%s is unset; every timing is minted, a stock beat is a signature", name, s)
				}
			}
			return nil
		},
	},
	{
		id: "reject-floor", breaks: failStallsTunnel,
		source: "awg3-geometry.sh:257-260 (2066a80): a client without RejectAfterTime runs the stock 180 s",
		check: func(g Geometry3) error {
			if g.RejectAfterTime.Lo < stockRejectTime {
				return fmt.Errorf("RejectAfterTime=%s goes below the stock %d s", g.RejectAfterTime, stockRejectTime)
			}
			return nil
		},
	},
	{
		id: "rekey-before-reject", breaks: failStallsTunnel,
		source: "awg3-geometry.sh:252-253 (2066a80): a keypair rejected before it can be rekeyed",
		check: func(g Geometry3) error {
			if g.RekeyAfterTime.Hi >= g.RejectAfterTime.Lo {
				return fmt.Errorf("RekeyAfterTime=%s must end below RejectAfterTime=%s", g.RekeyAfterTime, g.RejectAfterTime)
			}
			return nil
		},
	},
	{
		id: "reject-after-keepalive", breaks: failStallsTunnel,
		source: "awg3-geometry.sh:254-256 (2066a80)",
		check: func(g Geometry3) error {
			if g.RejectAfterTime.Lo <= g.KeepaliveTimeout.Hi+g.RekeyTimeout.Hi {
				return fmt.Errorf("RejectAfterTime=%s must exceed KeepaliveTimeout=%s + RekeyTimeout=%s", g.RejectAfterTime, g.KeepaliveTimeout, g.RekeyTimeout)
			}
			return nil
		},
	},
	{
		id: "random-trailers-on", breaks: failStallsTunnel,
		source: "awg3-geometry.sh:202-206 (2066a80): must match on both ends; receive.c:51 v3.1.20260906 matches lengths by it",
		check: func(g Geometry3) error {
			// A constant, not a minted value: the one way the client render
			// (Ф7.6) agrees with the server without reading node state.
			if !g.RandomTrailers {
				return fmt.Errorf("RandomTrailers must be on; it is fixed fleet-wide so both ends agree by construction")
			}
			return nil
		},
	},
	{
		id: "i1-present", breaks: failStallsTunnel,
		source: "amnezia-client #3082: empty I1 with Jc=4 handshakes and carries no data",
		check: func(g Geometry3) error {
			if strings.TrimSpace(g.I1) == "" {
				return fmt.Errorf("I1 is empty")
			}
			return nil
		},
	},
	{
		id: "i-charset", breaks: failInjection,
		source: "validateIField in config.go: I1-I5 go into the INI verbatim",
		check: func(g Geometry3) error {
			for i, v := range []string{g.I1, g.I2, g.I3, g.I4, g.I5} {
				if err := validateIField(fmt.Sprintf("I%d", i+1), v); err != nil {
					return err
				}
			}
			return nil
		},
	},
}

func (g Geometry3) headerSpans() map[string]Span {
	return map[string]Span{"H1": g.H1, "H2": g.H2, "H3": g.H3, "H4": g.H4}
}

func (g Geometry3) timingSpans() map[string]Span {
	return map[string]Span{
		"RekeyAfterTime": g.RekeyAfterTime, "RekeyTimeout": g.RekeyTimeout,
		"RejectAfterTime": g.RejectAfterTime, "KeepaliveTimeout": g.KeepaliveTimeout,
		"MaxHandshakeAttempts": g.MaxHandshakeAttempts,
	}
}

// u16Spans are the fields the tools parse with u16_range_from_string.
func (g Geometry3) u16Spans() map[string]Span {
	out := g.timingSpans()
	out["ContentPaddingAddition"] = g.ContentPaddingAddition
	return out
}

// violations returns the id of every row the geometry breaks, in table order.
// A list rather than the first error, so a test can prove its mutation broke
// exactly one row and not a neighbour by accident.
func (g Geometry3) violations() []string {
	var ids []string
	for _, r := range geometry3Rules {
		if r.check(g) != nil {
			ids = append(ids, r.id)
		}
	}
	return ids
}

// validate refuses a geometry that breaks any row, naming the row and what
// would happen if it were let through.
func (g Geometry3) validate() error {
	for _, r := range geometry3Rules {
		if err := r.check(g); err != nil {
			return fmt.Errorf("awg 3.1 geometry, %s (%s): %w", r.id, r.breaks, err)
		}
	}
	return nil
}

// interfaceLines renders the geometry as [Interface] keys, in the order the
// 3.1 tools document them. Only keys `awg setconf` parses (tools config.c:481-
// 583 v3.1.20260812); MTU is an awg-quick key and stays with the caller.
func (g Geometry3) interfaceLines() ([]string, error) {
	if err := g.validate(); err != nil {
		return nil, err
	}
	onOff := "off"
	if g.RandomTrailers {
		onOff = "on"
	}
	lines := []string{
		fmt.Sprintf("Jc = %d", g.Jc),
		fmt.Sprintf("Jmin = %d", g.Jmin),
		fmt.Sprintf("Jmax = %d", g.Jmax),
		fmt.Sprintf("S1 = %d", g.S1),
		fmt.Sprintf("S2 = %d", g.S2),
		fmt.Sprintf("S3 = %d", g.S3),
		fmt.Sprintf("S4 = %d", g.S4),
		"H1 = " + g.H1.String(),
		"H2 = " + g.H2.String(),
		"H3 = " + g.H3.String(),
		"H4 = " + g.H4.String(),
	}
	for i, v := range []string{g.I1, g.I2, g.I3, g.I4, g.I5} {
		if v != "" {
			lines = append(lines, fmt.Sprintf("I%d = %s", i+1, v))
		}
	}
	return append(lines,
		"HeaderProtectionKey = "+g.HeaderProtectionKey,
		"ContentPaddingAddition = "+g.ContentPaddingAddition.String(),
		"RekeyAfterTime = "+g.RekeyAfterTime.String(),
		"RekeyTimeout = "+g.RekeyTimeout.String(),
		"RejectAfterTime = "+g.RejectAfterTime.String(),
		"KeepaliveTimeout = "+g.KeepaliveTimeout.String(),
		"MaxHandshakeAttempts = "+g.MaxHandshakeAttempts.String(),
		"RandomTrailers = "+onOff,
	), nil
}
