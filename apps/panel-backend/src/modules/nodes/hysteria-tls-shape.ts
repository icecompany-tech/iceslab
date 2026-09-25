import { acmeHostnameFor } from '../inbounds/acme-hostname.js';
import { hostFromAddress } from '../subscription/subscription.formats.js';

/**
 * The shape of nodes.hysteria_tls and its public face (E30a), apart from the
 * minting in hysteria-tls.ts so the mapper and the subscription read it
 * without pulling in x509 and the database.
 */

/** As stored in nodes.hysteria_tls. The key never leaves the panel but to the node. */
export interface StoredHysteriaTls {
  certPem: string;
  keyPem: string;
  /** The host in the certificate's SAN: the node's address when it was minted. */
  host: string;
  /** sha256 of the DER, lowercase hex, no colons: what clients pin. */
  certSha256: string;
  createdAt: string;
}

/** What the node DTO shows: the intent, never the key. */
export interface PublicHysteriaTls {
  certSha256: string;
  host: string;
  createdAt: string;
}

/** The stored value as the code reads it; anything else is null. */
export function readHysteriaTls(raw: unknown): StoredHysteriaTls | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  for (const k of ['certPem', 'keyPem', 'host', 'certSha256', 'createdAt']) {
    if (typeof r[k] !== 'string' || !r[k]) return null;
  }
  return r as unknown as StoredHysteriaTls;
}

export function publicHysteriaTls(raw: unknown): PublicHysteriaTls | null {
  const t = readHysteriaTls(raw);
  return t ? { certSha256: t.certSha256, host: t.host, createdAt: t.createdAt } : null;
}

/**
 * The host a node's self-signed certificate is for, or null when the node has
 * a name ACME takes (then there is no self-signed certificate at all).
 */
export function selfSignedHostFor(address: string | null | undefined): string | null {
  if (!address || acmeHostnameFor(address)) return null;
  const host = hostFromAddress(address.trim()).toLowerCase();
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return bare || null;
}

/** What a subscription pins for one native hysteria endpoint. */
export interface HysteriaTlsPin {
  /** sha256 of the DER, lowercase hex, no colons. */
  certSha256: string;
  /** The certificate itself, for the clients that take it as their anchor. */
  certPem: string;
  /** The name in its SAN, for the clients that check it. */
  serverName: string;
}

/**
 * The pin of a hysteria endpoint, or null when it has none: another core than
 * native hysteria (sing-box brings its own certificate), a node with an FQDN
 * (ACME), no pair minted yet, or a pair minted for an address the node no
 * longer has (the next push re-mints it; a pin for the old one would not match).
 */
export function hysteriaPinFor(engine: string | undefined, address: string, raw: unknown): HysteriaTlsPin | null {
  if (engine !== 'hysteria') return null;
  const host = selfSignedHostFor(address);
  const t = readHysteriaTls(raw);
  if (!host || !t || t.host !== host) return null;
  return { certSha256: t.certSha256, certPem: t.certPem, serverName: t.host };
}
