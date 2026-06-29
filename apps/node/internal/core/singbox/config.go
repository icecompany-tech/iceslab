package singbox

import (
	"encoding/json"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
)

// sing-box config structs — only the subset we render for a TUIC inbound.
// Full schema: https://sing-box.sagernet.org/configuration/

type sbConfig struct {
	Log          sbLog           `json:"log"`
	Inbounds     []sbInbound     `json:"inbounds"`
	Outbounds    []sbOutbound    `json:"outbounds"`
	Experimental *sbExperimental `json:"experimental,omitempty"`
}

type sbLog struct {
	Level     string `json:"level"`
	Timestamp bool   `json:"timestamp"`
}

type sbInbound struct {
	Type              string   `json:"type"`
	Tag               string   `json:"tag"`
	Listen            string   `json:"listen"`
	ListenPort        int      `json:"listen_port"`
	Users             []sbUser `json:"users"`
	CongestionControl string   `json:"congestion_control,omitempty"`
	TLS               sbTLS    `json:"tls"`
}

type sbUser struct {
	Name     string `json:"name"`
	UUID     string `json:"uuid,omitempty"`
	Password string `json:"password,omitempty"`
	// Flow carries VLESS Vision ("xtls-rprx-vision") when the xray-family engine
	// renders a vless inbound; empty/omitted for every other protocol.
	Flow string `json:"flow,omitempty"`
	// AlterID is emitted only for VMess users (pointer so an explicit 0 -
	// "disable legacy MD5 auth" - serializes, while nil omits the key for
	// tuic/anytls/vless/trojan).
	AlterID *int `json:"alterId,omitempty"`
}

type sbTLS struct {
	Enabled         bool       `json:"enabled"`
	ServerName      string     `json:"server_name,omitempty"`
	ALPN            []string   `json:"alpn,omitempty"`
	CertificatePath string     `json:"certificate_path,omitempty"`
	KeyPath         string     `json:"key_path,omitempty"`
	Reality         *sbReality `json:"reality,omitempty"`
}

// sbReality is the inbound REALITY block (sing-box tls.reality). private_key is
// the same x25519 key xray uses; short_id is an array of hex strings; handshake
// is the camouflage target unverified probes are forwarded to.
type sbReality struct {
	Enabled           bool        `json:"enabled"`
	Handshake         sbHandshake `json:"handshake"`
	PrivateKey        string      `json:"private_key"`
	ShortID           []string    `json:"short_id"`
	MaxTimeDifference string      `json:"max_time_difference,omitempty"`
}

type sbHandshake struct {
	Server     string `json:"server"`
	ServerPort int    `json:"server_port"`
}

type sbOutbound struct {
	Type string `json:"type"`
	Tag  string `json:"tag"`
}

// experimental.v2ray_api drives per-user traffic stats. sing-box implements the
// V2Ray StatsService gRPC; we read it with the xray binary as a generic client
// (sing-box ships no stats CLI; the node-agent is zero-dependency by design).
type sbExperimental struct {
	V2RayAPI *sbV2RayAPI `json:"v2ray_api,omitempty"`
}

type sbV2RayAPI struct {
	Listen string  `json:"listen"`
	Stats  sbStats `json:"stats"`
}

type sbStats struct {
	Enabled bool     `json:"enabled"`
	Users   []string `json:"users,omitempty"`
}

// InboundConfig is the panel-pushed TUIC inbound shape (subset of the
// ApplyInbound config blob). All fields are comparable so the adapter can
// diff old vs new with `==` and skip a restart on no-op pushes.
type InboundConfig struct {
	ListenPort        int
	ServerName        string
	CongestionControl string

	// ───── xray-family fields (engine=singbox for vless/vmess/trojan) ─────
	// All zero for tuic/anytls. Kept as scalars (short IDs as a CSV string) so
	// InboundConfig stays comparable for the ApplyInbound `==` no-op diff.
	Subprotocol        string // "vless" (default) | "vmess" | "trojan"
	RealityDest        string // "host:port" camouflage target
	RealityServerName  string // single SNI -> sing-box tls.server_name
	RealityPrivateKey  string // x25519 private key (same format xray uses)
	RealityShortIDsCSV string // comma-joined hex short IDs
	RealityMaxTimeDiff int    // ms; 0 omits the field
	Flow               string // "xtls-rprx-vision" for vless Vision; vless-only
}

// userEntry is the per-user TUIC credential the adapter tracks in memory,
// keyed by userId.
type userEntry struct {
	UUID     string
	Password string
	Username string
}

// renderConfig builds the full sing-box config JSON for a single TUIC inbound.
// Users are sorted by userId so the output is deterministic. When statsListen
// is non-empty, an experimental.v2ray_api block is emitted so sing-box counts
// per-user traffic (read later via the xray-binary stats client).
//
// TLS is mandatory for TUIC; we always emit the cert/key paths, ALPN h3, and
// the panel-supplied server_name.
func renderConfig(certPath, keyPath, statsListen string, inbound InboundConfig, users map[string]userEntry) ([]byte, error) {
	cc := inbound.CongestionControl
	if cc == "" {
		cc = "bbr"
	}

	ids := make([]string, 0, len(users))
	for id := range users {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	sbUsers := make([]sbUser, 0, len(ids))
	for _, id := range ids {
		e := users[id]
		// Name = userId so the v2ray stats key (user>>><name>>>traffic>>>...)
		// maps straight back to the panel's userId.
		sbUsers = append(sbUsers, sbUser{Name: id, UUID: e.UUID, Password: e.Password})
	}

	cfg := sbConfig{
		Log: sbLog{Level: "warn", Timestamp: true},
		Inbounds: []sbInbound{{
			Type:              "tuic",
			Tag:               "tuic-in",
			Listen:            "0.0.0.0",
			ListenPort:        inbound.ListenPort,
			Users:             sbUsers,
			CongestionControl: cc,
			TLS: sbTLS{
				Enabled:         true,
				ServerName:      inbound.ServerName,
				ALPN:            []string{"h3"},
				CertificatePath: certPath,
				KeyPath:         keyPath,
			},
		}},
		Outbounds: []sbOutbound{{Type: "direct", Tag: "direct"}},
	}

	if statsListen != "" {
		cfg.Experimental = &sbExperimental{
			V2RayAPI: &sbV2RayAPI{
				Listen: statsListen,
				Stats:  sbStats{Enabled: true, Users: ids},
			},
		}
	}

	return json.MarshalIndent(cfg, "", "  ")
}

// renderAnytlsConfig builds the sing-box config for a single AnyTLS inbound.
// AnyTLS is TCP+TLS with password-only auth (no uuid, no congestion control);
// padding_scheme is left at the sing-box default. TLS is required, so cert/key
// are always emitted. Stats wiring is identical to TUIC.
func renderAnytlsConfig(certPath, keyPath, statsListen string, inbound InboundConfig, users map[string]userEntry) ([]byte, error) {
	ids := make([]string, 0, len(users))
	for id := range users {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	sbUsers := make([]sbUser, 0, len(ids))
	for _, id := range ids {
		e := users[id]
		// Name = userId for stable v2ray stats keys. AnyTLS is password-only,
		// so UUID stays empty (omitted by `omitempty`).
		sbUsers = append(sbUsers, sbUser{Name: id, Password: e.Password})
	}

	cfg := sbConfig{
		Log: sbLog{Level: "warn", Timestamp: true},
		Inbounds: []sbInbound{{
			Type:       "anytls",
			Tag:        "anytls-in",
			Listen:     "0.0.0.0",
			ListenPort: inbound.ListenPort,
			Users:      sbUsers,
			TLS: sbTLS{
				Enabled:         true,
				ServerName:      inbound.ServerName,
				CertificatePath: certPath,
				KeyPath:         keyPath,
			},
		}},
		Outbounds: []sbOutbound{{Type: "direct", Tag: "direct"}},
	}

	if statsListen != "" {
		cfg.Experimental = &sbExperimental{
			V2RayAPI: &sbV2RayAPI{
				Listen: statsListen,
				Stats:  sbStats{Enabled: true, Users: ids},
			},
		}
	}

	return json.MarshalIndent(cfg, "", "  ")
}

// renderXrayFamilyConfig builds the sing-box config for a vless/vmess/trojan
// inbound served by the sing-box engine (engine-choice). Security is REALITY
// (steal-others): the same x25519 key + short IDs + camouflage dest xray uses,
// so a vless:// / vmess:// / trojan:// link works against either engine. Stats
// wiring (v2ray_api) is identical to the other sing-box protocols.
//
// Per-protocol user shape:
//   - vless: uuid + flow (Vision)
//   - vmess: uuid + alterId 0
//   - trojan: password (== the user's xray uuid, mirroring the xray adapter's
//     reuse of user.xrayUuid as the trojan password)
func renderXrayFamilyConfig(statsListen string, inbound InboundConfig, users map[string]userEntry) ([]byte, error) {
	sub := inbound.Subprotocol
	if sub == "" {
		sub = "vless"
	}

	host, port := splitHostPort(inbound.RealityDest, 443)
	tls := sbTLS{
		Enabled:    true,
		ServerName: inbound.RealityServerName,
		Reality: &sbReality{
			Enabled:    true,
			Handshake:  sbHandshake{Server: host, ServerPort: port},
			PrivateKey: inbound.RealityPrivateKey,
			ShortID:    splitCSV(inbound.RealityShortIDsCSV),
		},
	}
	if inbound.RealityMaxTimeDiff > 0 {
		tls.Reality.MaxTimeDifference = fmt.Sprintf("%dms", inbound.RealityMaxTimeDiff)
	}

	ids := sortedIDs(users)
	zero := 0
	sbUsers := make([]sbUser, 0, len(ids))
	for _, id := range ids {
		e := users[id]
		u := sbUser{Name: id} // Name = userId -> stable v2ray stats key.
		switch sub {
		case "trojan":
			u.Password = e.Password
		case "vmess":
			u.UUID = e.UUID
			u.AlterID = &zero
		default: // vless
			u.UUID = e.UUID
			u.Flow = inbound.Flow // empty when Vision is off
		}
		sbUsers = append(sbUsers, u)
	}

	cfg := sbConfig{
		Log: sbLog{Level: "warn", Timestamp: true},
		Inbounds: []sbInbound{{
			Type:       sub,
			Tag:        sub + "-in",
			Listen:     "0.0.0.0",
			ListenPort: inbound.ListenPort,
			Users:      sbUsers,
			TLS:        tls,
		}},
		Outbounds: []sbOutbound{{Type: "direct", Tag: "direct"}},
	}

	if statsListen != "" {
		cfg.Experimental = &sbExperimental{
			V2RayAPI: &sbV2RayAPI{
				Listen: statsListen,
				Stats:  sbStats{Enabled: true, Users: ids},
			},
		}
	}

	return json.MarshalIndent(cfg, "", "  ")
}

// sortedIDs returns the user IDs sorted, for deterministic config output.
func sortedIDs(users map[string]userEntry) []string {
	ids := make([]string, 0, len(users))
	for id := range users {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// splitCSV splits a comma-joined list, trimming blanks. Returns a non-nil empty
// slice for "" so the rendered JSON carries `[]`, never `null`.
func splitCSV(s string) []string {
	out := []string{}
	if s == "" {
		return out
	}
	for _, p := range strings.Split(s, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// splitHostPort parses "host:port"; a missing/invalid port falls back to defPort.
func splitHostPort(hostPort string, defPort int) (string, int) {
	if hostPort == "" {
		return "", defPort
	}
	host, portStr, err := net.SplitHostPort(hostPort)
	if err != nil {
		return hostPort, defPort // no port present: whole value is the host
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port == 0 {
		return host, defPort
	}
	return host, port
}
