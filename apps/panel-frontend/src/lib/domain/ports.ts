// Port helpers shared by the node editor (NodeEditModal) and the node-create
// flow (NodesPage). Kept here so both surfaces pick deploy ports the same way
// instead of one hardcoding 443 (which made multi-profile deploys collide).

// Quick-deploy chip ports tried in order. 443 first (standard TLS), then common
// Cloudflare-friendly TLS alternates. Pre-2026-05-21 the chip hardcoded 443
// and any second binding fell over with 409 PORT_IN_USE.
export const QUICK_DEPLOY_PORT_CANDIDATES = [443, 8443, 2053, 2083, 2087, 2096];

// node.address is "host:port" where port is the node-agent's mTLS listener
// (default 1337, overridable via --port at install). Binding the node-agent
// port to a user-protocol inbound causes EADDRINUSE at adapter start, surfacing
// as a confusing 500 from applyInbounds. Exclude it from the picker.
export function parseNodeAgentPort(address: string | undefined | null): number | null {
  if (!address) return null;
  const idx = address.lastIndexOf(':');
  if (idx === -1) return null;
  const n = Number.parseInt(address.slice(idx + 1), 10);
  return Number.isFinite(n) ? n : null;
}

// Picks the first quick-deploy candidate not already taken. `occupied` is ports
// already bound (or assigned earlier in the same batch); `reserved` is e.g. the
// node-agent's own mTLS port. Falls back to (max+1) when all candidates are used.
export function pickFreeQuickDeployPort(occupied: number[], reserved: number[] = []): number {
  const taken = new Set([...occupied, ...reserved]);
  for (const p of QUICK_DEPLOY_PORT_CANDIDATES) {
    if (!taken.has(p)) return p;
  }
  return Math.max(...occupied, ...reserved, 443) + 1;
}
