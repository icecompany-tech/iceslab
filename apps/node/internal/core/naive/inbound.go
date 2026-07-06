package naive

// inboundCfgWire mirrors NaiveConfigSchema in
// apps/panel-backend/src/modules/inbounds/inbounds.schemas.ts. The agent
// keeps the install-time `ListenPort` from its own Config (Caddyfile root
// `:<port>`), the panel never pushes it because it's identity for the node,
// not per-inbound.
type inboundCfgWire struct {
	Hostname       string `json:"hostname"`
	TLSEmail       string `json:"tlsEmail"`
	MasqueradeRoot string `json:"masqueradeRoot"`
}

func (w inboundCfgWire) toInboundConfig(listenPort int) InboundConfig {
	return InboundConfig{
		Hostname:       w.Hostname,
		ListenPort:     listenPort,
		TLSEmail:       w.TLSEmail,
		MasqueradeRoot: w.MasqueradeRoot,
	}
}

func inboundEqual(a, b InboundConfig) bool {
	return a.Hostname == b.Hostname &&
		a.ListenPort == b.ListenPort &&
		a.TLSEmail == b.TLSEmail &&
		a.MasqueradeRoot == b.MasqueradeRoot
}
