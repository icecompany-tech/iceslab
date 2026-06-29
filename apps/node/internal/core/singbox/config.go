package singbox

import (
	"encoding/json"
	"sort"
)

// sing-box config structs — only the subset we render for a TUIC inbound.
// Full schema: https://sing-box.sagernet.org/configuration/

type sbConfig struct {
	Log       sbLog        `json:"log"`
	Inbounds  []sbInbound  `json:"inbounds"`
	Outbounds []sbOutbound `json:"outbounds"`
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
	UUID     string `json:"uuid"`
	Password string `json:"password,omitempty"`
}

type sbTLS struct {
	Enabled         bool     `json:"enabled"`
	ServerName      string   `json:"server_name,omitempty"`
	ALPN            []string `json:"alpn,omitempty"`
	CertificatePath string   `json:"certificate_path,omitempty"`
	KeyPath         string   `json:"key_path,omitempty"`
}

type sbOutbound struct {
	Type string `json:"type"`
	Tag  string `json:"tag"`
}

// InboundConfig is the panel-pushed TUIC inbound shape (subset of the
// ApplyInbound config blob). All fields are comparable so the adapter can
// diff old vs new with `==` and skip a restart on no-op pushes.
type InboundConfig struct {
	ListenPort        int
	ServerName        string
	CongestionControl string
}

// userEntry is the per-user TUIC credential the adapter tracks in memory,
// keyed by userId.
type userEntry struct {
	UUID     string
	Password string
	Username string
}

// renderConfig builds the full sing-box config JSON for a single TUIC inbound.
// Users are sorted by userId so the output is deterministic (stable across
// re-renders, friendly to tests and to "did anything actually change" checks).
//
// TLS is mandatory for TUIC (sing-box rejects a TUIC inbound without it); we
// always emit the cert/key paths the bootstrap script generates, ALPN h3, and
// the panel-supplied server_name.
func renderConfig(certPath, keyPath string, inbound InboundConfig, users map[string]userEntry) ([]byte, error) {
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
		// Name = userId so a future stats path (S1b, v2ray-api) can map
		// per-user counters straight back to the panel's userId.
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
	return json.MarshalIndent(cfg, "", "  ")
}
