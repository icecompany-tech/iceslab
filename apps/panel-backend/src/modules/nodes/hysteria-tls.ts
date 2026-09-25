// `@peculiar/x509@2` pulls in tsyringe, which requires this polyfill. Must be
// imported before x509, exactly as link-tls.ts and keygen.crypto.ts do it.
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { X509Certificate, webcrypto } from 'node:crypto';
import { isIP } from 'node:net';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { readHysteriaTls, selfSignedHostFor, type StoredHysteriaTls } from './hysteria-tls-shape.js';

export {
  publicHysteriaTls,
  readHysteriaTls,
  selfSignedHostFor,
  type PublicHysteriaTls,
  type StoredHysteriaTls,
} from './hysteria-tls-shape.js';

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

/**
 * The certificate native hysteria serves on a node no public CA issues for
 * (E30a, 25.09): a node addressed by IP. Minted by the PANEL, the pattern of
 * cascades/link-tls.ts, and for its reasons:
 *
 *   - the pin is known when the profile is saved, so a subscription works
 *     before the node has reported anything;
 *   - reinstalling the node does not change the certificate, so the links
 *     already handed out keep connecting;
 *   - every client pins in its own form (the DER's sha256 in hex, the whole
 *     certificate, a public key hash), and only the certificate itself can
 *     answer all of them.
 *
 * One per node, stored on `nodes.hysteria_tls`, pushed as tlsCertPem /
 * tlsKeyPem in the hysteria inbound config only while the node has no FQDN.
 * Bound to the host it was minted for (the SAN): a node that moves to another
 * IP gets a new one, and its clients a new subscription anyway. Otherwise it
 * changes only by rotateHysteriaTls, an explicit action.
 */

/** Ten years, as the leg certificates: pinned, so expiry buys nothing. */
const LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000;

const ALGORITHM: EcKeyGenParams & EcdsaParams = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };

const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

type Key = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** sha256 of a PEM certificate's DER, lowercase hex without colons. */
export function certSha256(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase();
}

/** Mint the pair for one host: an IP goes in the SAN as an IP, a name as a name. */
export async function mintHysteriaTls(host: string): Promise<StoredHysteriaTls> {
  const keys = (await webcrypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify'])) as {
    publicKey: Key;
    privateKey: Key;
  };
  const san = isIP(host) !== 0 ? { type: 'ip' as const, value: host } : { type: 'dns' as const, value: host };
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerialHex(),
    // No commas or equals signs can come from a host, so the DN needs no escaping.
    subject: `CN=${host}`,
    issuer: `CN=${host}`,
    notBefore: new Date(Date.now() - 60 * 60 * 1000),
    notAfter: new Date(Date.now() + LIFETIME_MS),
    signingAlgorithm: ALGORITHM,
    publicKey: keys.publicKey,
    signingKey: keys.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([OID_SERVER_AUTH], true),
      // In the SAN, not only the subject: clients that check the name (sing-box
      // against its `certificate`, xray against its pin) check the SAN.
      new x509.SubjectAlternativeNameExtension([san]),
    ],
  });
  const certPem = cert.toString('pem');
  const der = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  return {
    certPem,
    keyPem: privateKeyDerToPem(der),
    host,
    certSha256: certSha256(certPem),
    createdAt: new Date().toISOString(),
  };
}

/**
 * The node's pair for its current address: the stored one when it was minted
 * for this host, else a new one, stored. null when the node has a name ACME
 * takes. Called from the push, where native hysteria is about to be rendered.
 */
export async function ensureHysteriaTls(nodeId: string): Promise<StoredHysteriaTls | null> {
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { address: true, hysteriaTls: true } });
  const host = selfSignedHostFor(node?.address);
  if (!node || !host) return null;
  const stored = readHysteriaTls(node.hysteriaTls);
  if (stored && stored.host === host) return stored;
  const fresh = await mintHysteriaTls(host);
  await prisma.node.update({ where: { id: nodeId }, data: { hysteriaTls: fresh as unknown as Prisma.InputJsonValue } });
  return fresh;
}

/**
 * A new pair for the node, whatever it had: the explicit rotation. Every link
 * handed out with the old pin stops connecting until its subscription is
 * refreshed, which is the point. null when the node has a name ACME takes.
 */
export async function rotateHysteriaTls(nodeId: string): Promise<StoredHysteriaTls | null> {
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { address: true } });
  const host = selfSignedHostFor(node?.address);
  if (!node || !host) return null;
  const fresh = await mintHysteriaTls(host);
  await prisma.node.update({ where: { id: nodeId }, data: { hysteriaTls: fresh as unknown as Prisma.InputJsonValue } });
  return fresh;
}

function privateKeyDerToPem(der: ArrayBuffer): string {
  const b64 = Buffer.from(der).toString('base64');
  const wrapped = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

function randomSerialHex(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(16));
  bytes[0]! &= 0x7f;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
