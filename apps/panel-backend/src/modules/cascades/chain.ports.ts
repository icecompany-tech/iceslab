/**
 * Where the user's core hands traffic to the chain process. One port per way
 * out, on loopback.
 *
 * Its own file because BOTH sides of the handover need the formula and neither
 * should import the other: `chain.config.ts` renders the listeners, and
 * `cascade.config.ts` renders the xray outbound that dials them. Putting it in
 * either one makes the pair circular, and a number that two processes must
 * agree on is exactly the thing not to have two copies of.
 */

/** Base of the loopback socks range. */
export const CHAIN_SOCKS_BASE = 26000;

/**
 * The socks user a hand-off arrives as, one per route-policy ordinal (phase
 * 9.3): `p0` is the plain profile, `p<k>` the policy with ordinal k. The user
 * IS how the chain knows which policy a connection carries: xray's entry reads
 * it off the client's UUID variant (vlessRoute) and dials the chain as that
 * user, and the chain's policy rules gate on `auth_user`.
 *
 * Here for the same reason as the port formula: two sides must agree on it and
 * neither should import the other. The listeners are rendered in
 * `chain.config.ts`, the xray outbounds that dial them in `cascade.config.ts`,
 * the hysteria hand-off in the service. A second spelling would be a hand-off
 * the listener refuses on every connection, with every config loading cleanly.
 * The agent never reads the name.
 */
export function chainSocksUser(ordinal: number): string {
  return `p${ordinal}`;
}

/** The plain profile's user, the one every entry has, and the one a hysteria
 *  entry hands its users over as. Until phase 9.3 the only user, then named
 *  `chain`. */
export const CHAIN_SOCKS_USER = chainSocksUser(0);

/**
 * The socks port for a way out.
 *
 * Derived, never stored: both sides compute it from the direction tag, so they
 * cannot disagree about it. Tag 0 is the "Auto" line, and zero is free by
 * construction, because direction tags are issued from a counter starting at 1.
 */
export function chainSocksPort(directionTag: number): number {
  return CHAIN_SOCKS_BASE + directionTag;
}

/**
 * The chain's tproxy listener on loopback, where an AmneziaWG entry's packets
 * are steered (phase 7). One per NODE: every awg interface points at it, and
 * the rules that steer are told apart by the interface and its mark, not by
 * the port. Between the link range (LINK_PORT_BASE 24000 + step) and the socks
 * range (26000 + tag, tag <= MAX_DIRECTION_TAG), so it can meet neither.
 */
export const CHAIN_TPROXY_PORT = 25000;

/** Above every port number, so mark and table are never 0 nor 253-255. */
export const CHAIN_TPROXY_MARK_BASE = 0x10000;

/**
 * Firewall mark AND routing table of one awg interface, from its UDP listen
 * port.
 *
 * Per INTERFACE and not per node, decided 2026-09-23: two awg interfaces on
 * one node (protocol 1 beside protocol 3) with one mark would share one ip
 * rule, and the PostDown of either, or the sweep before its bring-up, would
 * take the other's away; that interface's users leave the chain silently. The
 * listen port is the one number both sides already know and that is unique per
 * interface on a node by construction, since two sockets cannot bind it.
 */
export function chainTProxyMark(listenPort: number): number {
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new RangeError(`awg listen port ${listenPort} is not a port`);
  }
  return CHAIN_TPROXY_MARK_BASE + listenPort;
}
