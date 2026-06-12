import type { SubscriptionEndpoint } from '../subscription.formats.js';

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
    .map((e, i) => {
      if (e.protocol !== 'shadowsocks') throw new Error('unreachable'); // narrowing
      return {
        id: e.hostId ?? `${e.nodeName}-${i}`,
        remarks: e.nodeName,
        server: e.host,
        server_port: e.port,
        password: e.password,
        method: e.method,
      };
    });
  return JSON.stringify({ version: 1, servers }, null, 2) + '\n';
}
