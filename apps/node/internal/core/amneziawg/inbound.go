package amneziawg

import (
	"fmt"
	"net"
	"strconv"
	"strings"
)

// inboundCfgWire mirrors AmneziawgConfigSchema in
// apps/panel-backend/src/modules/inbounds/inbounds.schemas.ts.
//
// On the agent side we don't need ServerPublicKey, it's emitted by the
// panel into the wg-quick client conf, the server only ever uses the private
// half. We accept the field on the wire so the JSON shape stays identical
// and ignore it during mapping.
type inboundCfgWire struct {
	Subnet           string         `json:"subnet"`
	ServerPrivateKey string         `json:"serverPrivateKey"`
	ServerPublicKey  string         `json:"serverPublicKey"` // unused on agent
	Obfuscation      obfuscationCfg `json:"obfuscation"`
	// ListenPort is the UDP port the awg-quick interface should bind to.
	// Injected by panel-backend from inbound.port (binding-level field
	// above the protocol config), see apps/panel-backend/src/modules/
	// inbounds/inbounds.queue.ts. When zero on the wire, we fall back to
	// the caller-supplied listenPort (install-time default). Caught live
	// cycle #6 2026-05-12: client wgconf advertised Endpoint=:443 but
	// the server bound 51820, all UDP packets fell on the floor.
	ListenPort int `json:"listenPort,omitempty"`
	// InboundID is the binding this inbound is (t07-6), so RetainInbounds can
	// take down the interface of a binding the push no longer carries.
	InboundID string `json:"inboundId,omitempty"`
	// AwgProtocol 3 routes the inbound to the 3.1 interface; absent or 1 is
	// the 1.x interface every push had before (t07-6).
	AwgProtocol int `json:"awgProtocol,omitempty"`
	// Geometry3 is the node's 3.1 geometry, on a 3.1 inbound only. It replaces
	// the obfuscation block on that interface. Mirrors AwgGeometry3 in
	// shared/transport.ts.
	Geometry3 *geometry3Wire `json:"geometry3,omitempty"`
}

// geometry3Wire is AwgGeometry3 as it travels: ranges as the tools' strings.
type geometry3Wire struct {
	MTU                    int    `json:"mtu"`
	Jc                     int    `json:"jc"`
	Jmin                   int    `json:"jmin"`
	Jmax                   int    `json:"jmax"`
	S1                     int    `json:"s1"`
	S2                     int    `json:"s2"`
	S3                     int    `json:"s3"`
	S4                     int    `json:"s4"`
	H1                     string `json:"h1"`
	H2                     string `json:"h2"`
	H3                     string `json:"h3"`
	H4                     string `json:"h4"`
	I1                     string `json:"i1"`
	I2                     string `json:"i2"`
	I3                     string `json:"i3"`
	I4                     string `json:"i4"`
	I5                     string `json:"i5"`
	HeaderProtectionKey    string `json:"headerProtectionKey"`
	ContentPaddingAddition string `json:"contentPaddingAddition"`
	RekeyAfterTime         string `json:"rekeyAfterTime"`
	RekeyTimeout           string `json:"rekeyTimeout"`
	RejectAfterTime        string `json:"rejectAfterTime"`
	KeepaliveTimeout       string `json:"keepaliveTimeout"`
	MaxHandshakeAttempts   string `json:"maxHandshakeAttempts"`
	RandomTrailers         bool   `json:"randomTrailers"`
}

// parseSpan reads "lo" or "lo-hi". The tools' own syntax; anything else is
// refused here rather than passed on for the tools to misread.
func parseSpan(name, s string) (Span, error) {
	lo, hi, ranged := strings.Cut(strings.TrimSpace(s), "-")
	l, err := strconv.ParseInt(lo, 10, 64)
	if err != nil {
		return Span{}, fmt.Errorf("%s=%q is not a number or a lo-hi range", name, s)
	}
	if !ranged {
		return Span{Lo: l, Hi: l}, nil
	}
	h, err := strconv.ParseInt(hi, 10, 64)
	if err != nil {
		return Span{}, fmt.Errorf("%s=%q is not a lo-hi range", name, s)
	}
	return Span{Lo: l, Hi: h}, nil
}

// toGeometry turns the wire into the geometry the bounds table checks. It
// does not judge the values; validate does, in one place.
func (w geometry3Wire) toGeometry() (Geometry3, error) {
	g := Geometry3{
		MTU: w.MTU, Jc: w.Jc, Jmin: w.Jmin, Jmax: w.Jmax,
		S1: w.S1, S2: w.S2, S3: w.S3, S4: w.S4,
		I1: w.I1, I2: w.I2, I3: w.I3, I4: w.I4, I5: w.I5,
		HeaderProtectionKey: w.HeaderProtectionKey,
		RandomTrailers:      w.RandomTrailers,
	}
	for _, f := range []struct {
		name string
		raw  string
		into *Span
	}{
		{"H1", w.H1, &g.H1}, {"H2", w.H2, &g.H2}, {"H3", w.H3, &g.H3}, {"H4", w.H4, &g.H4},
		{"ContentPaddingAddition", w.ContentPaddingAddition, &g.ContentPaddingAddition},
		{"RekeyAfterTime", w.RekeyAfterTime, &g.RekeyAfterTime},
		{"RekeyTimeout", w.RekeyTimeout, &g.RekeyTimeout},
		{"RejectAfterTime", w.RejectAfterTime, &g.RejectAfterTime},
		{"KeepaliveTimeout", w.KeepaliveTimeout, &g.KeepaliveTimeout},
		{"MaxHandshakeAttempts", w.MaxHandshakeAttempts, &g.MaxHandshakeAttempts},
	} {
		s, err := parseSpan(f.name, f.raw)
		if err != nil {
			return Geometry3{}, err
		}
		*f.into = s
	}
	return g, nil
}

type obfuscationCfg struct {
	Jc   int    `json:"jc"`
	Jmin int    `json:"jmin"`
	Jmax int    `json:"jmax"`
	S1   int    `json:"s1"`
	S2   int    `json:"s2"`
	S3   int    `json:"s3"`
	S4   int    `json:"s4"`
	H1   uint32 `json:"h1"`
	H2   uint32 `json:"h2"`
	H3   uint32 `json:"h3"`
	H4   uint32 `json:"h4"`
	// I1-I5: optional v2.0 mimicry signature packets (hex string).
	// Empty disables that slot. Pass through to awg-quick which writes
	// them into the [Interface] block as `I1 = <hex>` etc.
	I1 string `json:"i1,omitempty"`
	I2 string `json:"i2,omitempty"`
	I3 string `json:"i3,omitempty"`
	I4 string `json:"i4,omitempty"`
	I5 string `json:"i5,omitempty"`
}

// toInboundConfig maps wire onto the existing config.go InboundConfig.
// `Interface` and `ListenPort` are install-time identity (not in the wire),
// so the caller passes them in from the live adapter Config.
func (w inboundCfgWire) toInboundConfig(iface string, listenPort int) (InboundConfig, error) {
	addr, err := serverAddressFromSubnet(w.Subnet)
	if err != nil {
		return InboundConfig{}, err
	}
	// Prefer the port declared on the wire (per-inbound, set in panel UI);
	// fall back to the install-time default the caller passes in.
	port := listenPort
	if w.ListenPort > 0 {
		port = w.ListenPort
	}
	var geometry *Geometry3
	switch w.AwgProtocol {
	case 0, 1:
	case 3:
		// A 3.1 inbound with no geometry would come up speaking 1.x under a
		// 3.1 name, and every 3.1 client would fail its handshake: refused.
		if w.Geometry3 == nil {
			return InboundConfig{}, fmt.Errorf("a 3.1 inbound carries no geometry3")
		}
		g, err := w.Geometry3.toGeometry()
		if err != nil {
			return InboundConfig{}, fmt.Errorf("geometry3: %w", err)
		}
		geometry = &g
	default:
		return InboundConfig{}, fmt.Errorf("awgProtocol %d is not one this agent serves (1 or 3)", w.AwgProtocol)
	}
	return InboundConfig{
		Geometry:   geometry,
		Interface:  iface,
		ListenPort: port,
		PrivateKey: w.ServerPrivateKey,
		Address:    addr,
		Jc:         w.Obfuscation.Jc,
		Jmin:       w.Obfuscation.Jmin,
		Jmax:       w.Obfuscation.Jmax,
		S1:         w.Obfuscation.S1,
		S2:         w.Obfuscation.S2,
		S3:         w.Obfuscation.S3,
		S4:         w.Obfuscation.S4,
		H1:         w.Obfuscation.H1,
		H2:         w.Obfuscation.H2,
		H3:         w.Obfuscation.H3,
		H4:         w.Obfuscation.H4,
		I1:         w.Obfuscation.I1,
		I2:         w.Obfuscation.I2,
		I3:         w.Obfuscation.I3,
		I4:         w.Obfuscation.I4,
		I5:         w.Obfuscation.I5,
	}, nil
}

// serverAddressFromSubnet picks the first usable host of the subnet for the
// server's tunnel IP, by convention `.1`. Input "10.0.0.0/24" → "10.0.0.1/24".
func serverAddressFromSubnet(subnet string) (string, error) {
	ip, ipnet, err := net.ParseCIDR(subnet)
	if err != nil {
		return "", fmt.Errorf("parse subnet %q: %w", subnet, err)
	}
	v4 := ip.To4()
	if v4 == nil {
		return "", fmt.Errorf("subnet %q is not IPv4", subnet)
	}
	host := make(net.IP, 4)
	copy(host, v4)
	host[3]++
	ones, _ := ipnet.Mask.Size()
	return fmt.Sprintf("%s/%d", host.String(), ones), nil
}

// diffKind classifies a transition between two InboundConfig values:
//   - diffNone: byte-equivalent, no work
//   - diffSubnet: subnet/address changed, reject when peers exist (cannot
//     re-allocate without rotating every client)
//   - diffSyncconf: only S1-S4 / Jc/Jmin/Jmax changed, `awg syncconf` reloads
//     these without bouncing the interface
//   - diffRestart: H1-H4 / PrivateKey / ListenPort / Interface changed,
//     these are interface-immutable, syncconf can't apply them, full restart
//     required (admins are warned in panel UI)
type diffKind int

const (
	diffNone diffKind = iota
	diffSyncconf
	diffRestart
	diffSubnet
)

// geometryEqual: the 3.1 block is interface-init-time like H1-H4 (the key and
// the timings are read at device creation), so any change is a restart.
func geometryEqual(a, b *Geometry3) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// classifyDiff compares old vs new and returns the strictest action required.
// "Strictest" means: subnet > restart > syncconf > none, if multiple changes
// happen at once we pick the one demanding the heaviest reload.
func classifyDiff(old, new InboundConfig) diffKind {
	if old.Address != new.Address {
		return diffSubnet
	}
	// AmneziaWG fork v1.0.20251009 does NOT apply Jc/Jmin/Jmax/S1-S4
	// changes via `awg syncconf` to a running interface, they're frozen
	// at interface init. Verified live cycle #6 2026-05-12: changed Jc 4→0
	// via panel UI, syncconf returned success, but `awg show awg0` still
	// reported jc=4 until awg-quick down/up bounced the interface. So
	// treat junk/magic-size changes as diffRestart, same as H1-H4 / key /
	// port, all interface-init-time-only fields.
	if old.PrivateKey != new.PrivateKey ||
		old.ListenPort != new.ListenPort ||
		old.Interface != new.Interface ||
		old.H1 != new.H1 || old.H2 != new.H2 || old.H3 != new.H3 || old.H4 != new.H4 ||
		old.S1 != new.S1 || old.S2 != new.S2 || old.S3 != new.S3 || old.S4 != new.S4 ||
		old.Jc != new.Jc || old.Jmin != new.Jmin || old.Jmax != new.Jmax ||
		old.I1 != new.I1 || old.I2 != new.I2 || old.I3 != new.I3 || old.I4 != new.I4 || old.I5 != new.I5 ||
		!geometryEqual(old.Geometry, new.Geometry) {
		return diffRestart
	}
	return diffNone
}
