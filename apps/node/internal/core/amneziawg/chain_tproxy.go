package amneziawg

import "fmt"

// ChainTProxy is how an AmneziaWG entry hands its users to the chain: every
// packet arriving on the awg interface is steered by TPROXY into the chain's
// tproxy inbound on loopback, and the chain routes it like any other entry's
// traffic. Ф7.4; the fields arrive in userCore.tproxy once Ф7.1 has the wire.
type ChainTProxy struct {
	// Port of the chain's tproxy inbound on 127.0.0.1.
	Port int
	// Mark the TPROXY target sets and the ip rule matches.
	Mark uint32
	// Table that turns marked packets into local delivery.
	Table uint32
}

func (t ChainTProxy) validate() error {
	if t.Port < 1 || t.Port > 65535 {
		return fmt.Errorf("tproxy port %d out of range", t.Port)
	}
	if t.Mark == 0 {
		// Zero is "no mark": the ip rule would match every unmarked packet on
		// the host and route all of it to loopback.
		return fmt.Errorf("tproxy mark must be non-zero")
	}
	switch {
	case t.Table == 0:
		return fmt.Errorf("routing table 0 is unspecified")
	case t.Table >= 253 && t.Table <= 255:
		// default, main and local. Adding a local default route to main or
		// local takes the whole host off the network.
		return fmt.Errorf("routing table %d is reserved (default/main/local)", t.Table)
	case t.Table > 1<<31-1:
		return fmt.Errorf("routing table %d out of range", t.Table)
	}
	return nil
}

// chainTProxyHooks returns the PostUp and PostDown lines for an awg interface
// whose users go into the chain. Both lists are written out in full, not one
// derived from the other: the mirror test in chain_tproxy_test.go inverts
// PostUp on its own and compares, which would prove nothing if this function
// did the inverting.
//
// IPv4 only, as the AWG subnet is. Every line has to pass validatePostHook
// (awg-quick evals them as root), so there are no pipes, no `||`, no `-C`
// guards: idempotence comes from PostDown being the exact mirror, not from
// checks inside the lines.
func chainTProxyHooks(t ChainTProxy) (up, down []string, err error) {
	if err := t.validate(); err != nil {
		return nil, nil, err
	}
	mark := fmt.Sprintf("0x%x", t.Mark)
	up = []string{
		// Marked packets are delivered locally, which is what lets the
		// tproxy socket on loopback receive traffic addressed elsewhere.
		fmt.Sprintf("ip rule add fwmark %s lookup %d", mark, t.Table),
		fmt.Sprintf("ip route add local 0.0.0.0/0 dev lo table %d", t.Table),
		// Traffic to the node itself (its tunnel address, a DNS on it) stays
		// with the node and never enters the chain.
		"iptables -t mangle -A PREROUTING -i %i -m addrtype --dst-type LOCAL -j RETURN",
		fmt.Sprintf("iptables -t mangle -A PREROUTING -i %%i -p tcp -j TPROXY --on-ip 127.0.0.1 --on-port %d --tproxy-mark %s", t.Port, mark),
		fmt.Sprintf("iptables -t mangle -A PREROUTING -i %%i -p udp -j TPROXY --on-ip 127.0.0.1 --on-port %d --tproxy-mark %s", t.Port, mark),
	}
	down = []string{
		fmt.Sprintf("iptables -t mangle -D PREROUTING -i %%i -p udp -j TPROXY --on-ip 127.0.0.1 --on-port %d --tproxy-mark %s", t.Port, mark),
		fmt.Sprintf("iptables -t mangle -D PREROUTING -i %%i -p tcp -j TPROXY --on-ip 127.0.0.1 --on-port %d --tproxy-mark %s", t.Port, mark),
		"iptables -t mangle -D PREROUTING -i %i -m addrtype --dst-type LOCAL -j RETURN",
		fmt.Sprintf("ip route del local 0.0.0.0/0 dev lo table %d", t.Table),
		fmt.Sprintf("ip rule del fwmark %s lookup %d", mark, t.Table),
	}
	for _, cmd := range append(append([]string{}, up...), down...) {
		if err := validatePostHook(cmd); err != nil {
			return nil, nil, fmt.Errorf("chain tproxy hook %q: %w", cmd, err)
		}
	}
	return up, down, nil
}
