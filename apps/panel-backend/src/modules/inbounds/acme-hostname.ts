import { isIP } from 'node:net';
import { hostFromAddress } from '../subscription/subscription.formats.js';

/**
 * The FQDN to publish in a node's hysteria `acme.domains`, or null to leave the
 * node on the hostname it was installed with.
 *
 * Taken from the node's own address because that is both what a hysteria client
 * dials and what it sends as its SNI, which makes it the only name whose
 * certificate can validate. Anything a public CA cannot issue for returns null,
 * since asking hysteria to re-issue on a doomed name would cost it the working
 * certificate it already holds:
 *   - an IP literal, which Let's Encrypt does not serve
 *   - a single-label name, which cannot be publicly resolvable
 *
 * One reader for the push (inbounds.queue.ts) and the install command
 * (nodes.service.ts buildInstallCommand): E30, 25.09, the command put an IP in
 * --hysteria-domain because it read the address its own way.
 */
export function acmeHostnameFor(address: string | null | undefined): string | null {
  if (!address) return null;
  const host = hostFromAddress(address.trim()).toLowerCase();
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (!bare || isIP(bare) !== 0 || !bare.includes('.')) return null;
  return bare;
}
