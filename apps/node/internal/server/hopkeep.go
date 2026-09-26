package server

import (
	"encoding/json"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// udpPortsOf is every UDP port a push makes this node listen on from the
// outside, E49: what a port-hopping redirect must leave alone (hopguard).
//
//   - each inbound whose protocol takes UDP (protoForInbound, the same table
//     the firewall opens by): hysteria, AmneziaWG, tuic, shadowsocks, mieru;
//   - each listener of the chain that is not on loopback: the link-in of a leg,
//     UDP for hy2 and tuic, UDP beside TCP for shadowsocks, TCP for vless
//     (harmless to name, the redirect is UDP-only);
//   - the receiving end of each leg tunnel.
//
// The chain's loopback listeners (socks hand-off, tproxy) are not here: packets
// to loopback never cross nat PREROUTING. What an awg interface carries to a
// foreign address is kept off the redirect by the guard's own interface rule.
func udpPortsOf(req dto.ApplyInboundsRequest) []int {
	var ports []int
	for _, ib := range req.Inbounds {
		for _, proto := range protoForInbound(ib.Protocol) {
			if proto == "udp" && ib.Port > 0 {
				ports = append(ports, ib.Port)
			}
		}
	}
	if req.Chain != nil {
		var cfg struct {
			Inbounds []struct {
				Listen     string `json:"listen"`
				ListenPort int    `json:"listen_port"`
			} `json:"inbounds"`
		}
		if json.Unmarshal(req.Chain.Config, &cfg) == nil {
			for _, in := range cfg.Inbounds {
				if in.ListenPort > 0 && in.Listen != "127.0.0.1" && in.Listen != "::1" {
					ports = append(ports, in.ListenPort)
				}
			}
		}
		for _, t := range req.Chain.Tunnels {
			if t.ListenPort > 0 {
				ports = append(ports, t.ListenPort)
			}
		}
	}
	return ports
}
