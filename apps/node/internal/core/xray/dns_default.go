package xray

import "github.com/icecompany-tech/iceslab/apps/node/internal/core"

// defaultDnsSection is the `dns` block of a node the panel named no resolver
// for (E37, 25.09 on nl-01): core.DefaultResolvers, with queryStrategy from
// core.ResolveStrategy, the same choice the direct outbound's domainStrategy
// reads. Why the host's resolver alone is not enough is written beside
// core.DefaultResolvers.
func defaultDnsSection(ipv6 bool) map[string]any {
	servers := make([]any, 0, len(core.DefaultResolvers))
	for _, s := range core.DefaultResolvers {
		servers = append(servers, s)
	}
	return map[string]any{
		"servers":       servers,
		"queryStrategy": core.ResolveStrategy(ipv6),
	}
}

// nodeHasIPv6 is read at every render. A variable so tests can pin the answer:
// the goldens would otherwise depend on the machine that runs them.
var nodeHasIPv6 = core.HostHasGlobalIPv6
