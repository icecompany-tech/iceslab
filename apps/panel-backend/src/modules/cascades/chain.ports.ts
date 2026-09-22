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
 * The socks port for a way out.
 *
 * Derived, never stored: both sides compute it from the direction tag, so they
 * cannot disagree about it. Tag 0 is the "Auto" line, and zero is free by
 * construction, because direction tags are issued from a counter starting at 1.
 */
export function chainSocksPort(directionTag: number): number {
  return CHAIN_SOCKS_BASE + directionTag;
}
