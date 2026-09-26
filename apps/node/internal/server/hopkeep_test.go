package server

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

func TestTheUdpPortsAPushListensOn(t *testing.T) {
	// ru-02 as the stand had it: hysteria for users, an AWG inbound, an xray
	// one, a transit whose chain receives a leg and hands nothing over, and the
	// receiving end of a leg tunnel.
	req := dto.ApplyInboundsRequest{
		Inbounds: []dto.InboundDto{
			{Protocol: "hysteria", Port: 443},
			{Protocol: "amneziawg", Port: 51820},
			{Protocol: "xray", Port: 8443},
		},
		Chain: &dto.NodeChain{
			Engine: "singbox",
			Config: json.RawMessage(`{"inbounds":[
				{"type":"vless","tag":"link-in","listen":"10.77.0.2","listen_port":24001},
				{"type":"socks","tag":"in-d1","listen":"127.0.0.1","listen_port":26001},
				{"type":"tproxy","tag":"in-tproxy","listen":"127.0.0.1","listen_port":25000}
			]}`),
			Tunnels: []dto.ChainTunnel{{Iface: "awg-l0", ListenPort: 27000}, {Iface: "awg-l1"}},
		},
	}
	got := udpPortsOf(req)
	slices.Sort(got)
	// Not 8443 (xray is TCP), not the loopback listeners, not the dialling end
	// of awg-l1 (it listens on nothing).
	if want := []int{443, 24001, 27000, 51820}; !slices.Equal(got, want) {
		t.Errorf("udpPortsOf = %v, want %v", got, want)
	}
}
