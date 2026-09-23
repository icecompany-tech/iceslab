package amneziawg

import (
	"fmt"
	"strings"
)

// ChainTProxy is how an AmneziaWG entry hands its users to the chain: every
// packet arriving on the awg interface is steered by TPROXY into the chain's
// tproxy inbound on loopback, and the chain routes it like any other entry's
// traffic. Ф7.4; filled from userCore.tproxy (dto.ChainUserCoreTProxy).
type ChainTProxy struct {
	// Port of the chain's tproxy inbound on 127.0.0.1.
	Port int
	// Mark is the firewall mark the TPROXY target sets AND the routing table
	// the ip rule sends it to: one number, so there is one place to check for
	// collisions (decision of 2026-09-23). Per INTERFACE, not per node: the
	// panel mints it from the interface's listen port, so two awg interfaces
	// on one node never share an ip rule.
	Mark uint32
}

func (t ChainTProxy) validate() error {
	if t.Port < 1 || t.Port > 65535 {
		return fmt.Errorf("tproxy port %d out of range", t.Port)
	}
	switch {
	case t.Mark == 0:
		// Zero is "no mark" and table 0 is unspecified: the ip rule would match
		// every unmarked packet on the host and route all of it to loopback.
		return fmt.Errorf("tproxy mark must be non-zero")
	case t.Mark >= 253 && t.Mark <= 255:
		// As a table: default, main and local. A local default route in one
		// of those takes the whole host off the network.
		return fmt.Errorf("tproxy mark %d is a reserved routing table (default/main/local)", t.Mark)
	case t.Mark > 1<<31-1:
		return fmt.Errorf("tproxy mark %d out of range", t.Mark)
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
// guards: idempotence comes from PostDown being the exact mirror, and from
// sweepChainTProxy before a bring-up, not from checks inside the lines.
func chainTProxyHooks(t ChainTProxy) (up, down []string, err error) {
	if err := t.validate(); err != nil {
		return nil, nil, err
	}
	mark := fmt.Sprintf("0x%x", t.Mark)
	table := t.Mark
	up = []string{
		// Marked packets are delivered locally, which is what lets the
		// tproxy socket on loopback receive traffic addressed elsewhere.
		fmt.Sprintf("ip rule add fwmark %s lookup %d", mark, table),
		fmt.Sprintf("ip route add local 0.0.0.0/0 dev lo table %d", table),
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
		fmt.Sprintf("ip route del local 0.0.0.0/0 dev lo table %d", table),
		fmt.Sprintf("ip rule del fwmark %s lookup %d", mark, table),
	}
	for _, cmd := range append(append([]string{}, up...), down...) {
		if err := validatePostHook(cmd); err != nil {
			return nil, nil, fmt.Errorf("chain tproxy hook %q: %w", cmd, err)
		}
	}
	return up, down, nil
}

// forInterface substitutes the interface name for %i, the one substitution
// awg-quick makes itself. Needed where the lines run outside awg-quick.
func forInterface(cmd, iface string) string {
	return strings.ReplaceAll(cmd, "%i", iface)
}

// sweepMaxRepeats bounds the sweep of one line. A line that keeps succeeding
// past it is being re-added by something else, and looping on it forever would
// hang the bring-up instead of reporting that.
const sweepMaxRepeats = 64

// sweepChainTProxy takes away what an interface's hooks may have left behind,
// before its bring-up (decision of 2026-09-23).
//
// The residue it exists for: awg-quick's own failure trap deletes an interface
// whose PostUp failed WITHOUT running PostDown, so the lines that did run stay.
// The next bring-up then duplicates the ip rule and stops at the route. So each
// PostDown line is run until it fails, which is the tools' own way of saying
// "nothing left of this". A line failing at once on a clean host is the normal
// case and is not an error.
//
// run executes one command given as argv, without a shell: every line already
// passed validatePostHook, so splitting on spaces is the whole parse.
func sweepChainTProxy(iface string, down []string, run func(argv []string) error) error {
	for _, line := range down {
		argv := strings.Fields(forInterface(line, iface))
		n := 0
		for ; n < sweepMaxRepeats; n++ {
			if run(argv) != nil {
				break
			}
		}
		if n == sweepMaxRepeats {
			return fmt.Errorf("sweep of %s: %q still succeeds after %d runs; something keeps adding it", iface, strings.Join(argv, " "), sweepMaxRepeats)
		}
	}
	return nil
}
