import { buildAmneziawgClientConfig } from '../../../core-adapters/amneziawg/index.js';
import type {
  SubscriptionEndpoint,
  AmneziawgSubscriptionEndpoint,
} from '../subscription.formats.js';

/**
 * wg-quick / awg-quick `.conf` subscription formatter (AmneziaWG-only).
 *
 * Targets the AmneziaVPN-app, the AmneziaWG mobile clients, and stock
 * `wg-quick` for users on AmneziaWG-aware kernels. Output is the textual
 * `[Interface]` + `[Peer]` blob produced by `buildAmneziawgClientConfig`.
 *
 * Limitations:
 *   - **Single node per file.** wg-quick is one [Interface] per file; a client
 *     can't merge several AmneziaWG tunnels into one config. A user with more
 *     than one AmneziaWG node therefore needs one link per node: pass
 *     `nodeName` to pick which endpoint to emit. Without it (the legacy
 *     whole-subscription link) we emit the first AmneziaWG endpoint, so every
 *     per-node link MUST carry `?node=` or they all resolve to the same node.
 *   - **AmneziaWG-only.** hysteria/xray/naive endpoints are skipped silently.
 *     The client picked this format because their app speaks wg-quick; other
 *     protocols don't translate to it.
 *
 * Returns an empty string when no matching AmneziaWG endpoint is available — the
 * route handler turns that into a 204-style empty body, telling the client
 * "no AmneziaWG inbound configured for you".
 */
export function buildWgQuickConf(
  endpoints: SubscriptionEndpoint[],
  nodeName?: string,
): string {
  const awgEndpoints = endpoints.filter(
    (e): e is AmneziawgSubscriptionEndpoint => e.protocol === 'amneziawg',
  );
  // nodeName selects which node's tunnel; absent = first (legacy whole-sub link).
  const awg = nodeName
    ? awgEndpoints.find((e) => e.nodeName === nodeName)
    : awgEndpoints[0];
  if (!awg) return '';

  return buildAmneziawgClientConfig({
    privateKey: awg.privateKey,
    allowedIp: awg.allowedIp,
    serverPublicKey: awg.serverPublicKey,
    host: awg.host,
    port: awg.port,
    jc: awg.jc,
    jmin: awg.jmin,
    jmax: awg.jmax,
    s1: awg.s1,
    s2: awg.s2,
    s3: awg.s3,
    s4: awg.s4,
    h1: awg.h1,
    h2: awg.h2,
    h3: awg.h3,
    h4: awg.h4,
    i1: awg.i1,
    i2: awg.i2,
    i3: awg.i3,
    i4: awg.i4,
    i5: awg.i5,
  });
}
