package xray

import "net"

// defaultDnsSection is the `dns` block of a node the panel named no resolver
// for (E37, 25.09 on nl-01).
//
// Without one xray resolves through the host's resolver, which on a systemd
// host is the stub at 127.0.0.53. On nl-01 that stub stopped answering (an
// AmneziaWG MASQUERADE rule rewrote loopback queries to the public address and
// systemd-resolved dropped them), and every vless host on the node went dead
// with the panel reading ONLINE: one resolver the operator never chose was a
// single point of failure for every host of the core. Two public resolvers
// first, the host's own (`localhost`) last, so any one of the three is enough.
//
// queryStrategy follows what the node can reach: an AAAA answer on a node with
// no IPv6 is an address the connection then fails to dial.
func defaultDnsSection(ipv6 bool) map[string]any {
	strategy := "UseIPv4"
	if ipv6 {
		strategy = "UseIP"
	}
	return map[string]any{
		"servers":       []any{"1.1.1.1", "8.8.8.8", "localhost"},
		"queryStrategy": strategy,
	}
}

// nodeHasIPv6 is read at every render. A variable so tests can pin the answer:
// the goldens would otherwise depend on the machine that runs them.
var nodeHasIPv6 = hostHasGlobalIPv6

// hostHasGlobalIPv6: an interface of this host carries a global IPv6 address.
// Link-local and unique-local (fc00::/7) do not count: neither reaches the
// internet.
func hostHasGlobalIPv6() bool {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, a := range addrs {
		n, ok := a.(*net.IPNet)
		if !ok || n.IP.To4() != nil {
			continue
		}
		if n.IP.IsGlobalUnicast() && !n.IP.IsPrivate() {
			return true
		}
	}
	return false
}
