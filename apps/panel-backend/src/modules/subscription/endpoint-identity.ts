import { createHash } from 'node:crypto';
import type { SubscriptionEndpoint } from './subscription.formats.js';

/**
 * Who an endpoint IS, as opposed to what it is called.
 *
 * Until 2026-08-30 the two were the same string. `subscriptionServerName` built
 * a display label out of the flag, the host remark and the node name, and every
 * structured format turned that label into an IDENTIFIER: the outbound tag in
 * xray-json, the tag in sing-box, the proxy name in Clash, and through those the
 * value routing rules and selector groups point at. Two bindings on one node
 * whose hosts were never named produce the same label, so they produced the same
 * identifier: rules then aim at an ambiguous tag, and a client that checks
 * refuses the whole config rather than the one duplicate (audit A-020).
 *
 * The key below is the host row's id, the row an endpoint is actually emitted
 * from. It is a uuid, so it is unique by construction, and it is untouched by
 * renaming the node, the host, or the country: exactly the edits that used to
 * move an identifier. The binding id is the fallback for the vestigial hostless
 * shape.
 *
 * An endpoint written out by hand (a test, a preview) has no key, and the tuple
 * below stands in. It does name the label, which is the very thing this module
 * exists to stop depending on - deliberately, and only there: such an endpoint
 * has no other identity to offer, and nothing renames it between two calls
 * inside one process.
 */
export function endpointKey(e: SubscriptionEndpoint): string {
  if (e.key) return e.key;
  const transport = e.protocol === 'xray' ? (e.network ?? '') : '';
  return [e.nodeId ?? '', e.nodeName, e.host, e.port, e.protocol, transport].join('|');
}

/**
 * The key squeezed into something short enough to read in a config.
 *
 * A raw uuid inside every outbound tag is legible to nobody and makes the diff
 * between two generated configs unreadable; eight hex characters of its digest
 * collide with probability that rounds to zero across the handful of endpoints
 * one subscription carries, and the value is stable across processes because it
 * is a plain hash, not a counter or a random.
 */
export function endpointId(e: SubscriptionEndpoint): string {
  return createHash('sha256').update(endpointKey(e)).digest('hex').slice(0, 8);
}

/**
 * The config-internal tag for an endpoint, in the formats where a tag is NOT
 * shown to anyone: xray-json outbounds and the rules pointing at them.
 *
 * Deliberately carries no part of the label. The point of the exercise is that
 * renaming a node cannot reach a value a routing rule dereferences, and a tag
 * built by pasting the label back in would have inherited the collision it was
 * meant to remove.
 */
export function endpointTag(e: SubscriptionEndpoint, role = 'proxy'): string {
  return `${role}-${endpointId(e)}`;
}

/**
 * A tagger for the formats where the identifier and the display name are the
 * SAME field: sing-box tags and Clash proxy names are what a person picks from
 * in the client's server list, so they cannot become opaque ids.
 *
 * There the guarantee has to come from the other side: labels are made unique
 * once, for every format, in `disambiguateEndpointLabels`. This is the seatbelt
 * under that, because a formatter is also called directly (tests, the admin
 * preview) with endpoints that never went through the service. On a collision it
 * appends the endpoint's own id rather than a counter, so the name a client
 * remembers as "the selected proxy" depends on the endpoint and not on where it
 * happened to sit in the list.
 */
export function makeTagger(): (e: SubscriptionEndpoint, base: string) => string {
  const used = new Set<string>();
  return (e, base) => {
    let candidate = base;
    if (used.has(candidate)) {
      candidate = `${base}-${endpointId(e).slice(0, 4)}`;
      for (let n = 2; used.has(candidate); n++) {
        candidate = `${base}-${endpointId(e).slice(0, 4)}-${n}`;
      }
    }
    used.add(candidate);
    return candidate;
  };
}
