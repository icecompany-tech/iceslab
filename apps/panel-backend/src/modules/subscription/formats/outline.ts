import type { SubscriptionEndpoint } from '../subscription.formats.js';
import { endpointId } from '../endpoint-identity.js';

/**
 * Outline / SIP008 "online config" formatter (`?format=outline`).
 *
 * SIP008 is the standard Shadowsocks online-configuration JSON: a `servers`
 * array that the Outline client and shadowsocks-android / shadowsocks-rust
 * clients poll and import. Only `shadowsocks` endpoints map (these clients
 * speak Shadowsocks and nothing else); every other protocol is skipped, the
 * same way the xrayjson formatter skips non-xray endpoints.
 *
 * Shape (SIP008 v1):
 *   {
 *     "version": 1,
 *     "servers": [
 *       { "id", "remarks", "server", "server_port", "password", "method" }
 *     ]
 *   }
 */
export function buildOutlineJson(endpoints: SubscriptionEndpoint[]): string {
  const servers = endpoints
    .filter((e) => e.protocol === 'shadowsocks')
    .map((e) => {
      if (e.protocol !== 'shadowsocks') throw new Error('unreachable'); // narrowing
      return {
        // SIP008 `id` is what a client matches a server against across polls, so
        // it has to be the endpoint's identity and not its position in the list
        // or a name an operator can edit. The host id keeps that literal form it
        // has always had - changing it would make every client drop its servers
        // and re-add them once - and the fallback, which used to paste the label
        // together with a list index, becomes the same identity everything else
        // is now keyed by.
        id: e.hostId ?? endpointId(e),
        remarks: e.nodeName,
        server: e.host,
        server_port: e.port,
        password: e.password,
        method: e.method,
      };
    });
  return JSON.stringify({ version: 1, servers }, null, 2) + '\n';
}
