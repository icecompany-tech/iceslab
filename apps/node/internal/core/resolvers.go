package core

import "net"

// The resolvers a core asks when the panel named none (E37, 25.09 on nl-01).
//
// Left to itself a core resolves through the host, which on a systemd host is
// the stub at 127.0.0.53. On nl-01 that stub stopped answering (an AmneziaWG
// MASQUERADE rule rewrote loopback queries to the public address and
// systemd-resolved dropped them), and every host of the core went dead with the
// panel reading ONLINE. Two public resolvers first and the host's own last, so
// any one of the three is enough. `localhost` is how xray names the host's
// resolver; a core that spells it differently maps it.
var DefaultResolvers = []string{"1.1.1.1", "8.8.8.8", "localhost"}

// ResolveStrategy is the one choice of address family a core resolves names
// with, in xray's words: UseIP where the node has global IPv6, UseIPv4
// otherwise. An AAAA answer on a node with no IPv6 is an address the
// connection then fails to dial.
func ResolveStrategy(ipv6 bool) string {
	if ipv6 {
		return "UseIP"
	}
	return "UseIPv4"
}

// HostHasGlobalIPv6: an interface of this host carries a global IPv6 address.
// Link-local and unique-local (fc00::/7) do not count: neither reaches the
// internet.
func HostHasGlobalIPv6() bool {
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
