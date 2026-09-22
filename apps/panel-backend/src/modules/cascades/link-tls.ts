// `@peculiar/x509@2` pulls in tsyringe, which requires this polyfill. Must be
// imported before x509, exactly as keygen.crypto.ts does it.
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { webcrypto } from 'node:crypto';

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

/**
 * The TLS a QUIC leg wears, minted by the PANEL.
 *
 * hy2 and tuic are QUIC, and QUIC is TLS: neither cell can be configured
 * without a certificate on the receiving end. The question is whose.
 *
 * ⚠ NOT A FILE ON THE NODE, and not `insecure: true` on the dialling side.
 * Both are the shapes one reaches for first and both are wrong for a LEG:
 *
 *   - a `certificate_path` means the key lives outside the panel, minted by
 *     whatever ran on that box, rotated by nobody, and readable by anything on
 *     it. The panel already mints every other leg credential;
 *   - `insecure: true` means the dialling hop accepts ANY certificate, so
 *     whoever can answer on that address is the next hop. A cascade exists to
 *     make the path unfakeable, and that setting hands the path to whoever
 *     gets there first.
 *
 * So the panel mints a self-signed pair per leg, the receiving side gets the
 * certificate and the key, and the dialling side gets the certificate alone as
 * a PIN with `insecure: false`. There is no CA and no domain: a leg has no name
 * to verify, so the trust anchor IS this one certificate, and the name below is
 * a constant both ends agree on rather than anything DNS knows.
 *
 * Verified against sing-box 1.13.14 with `sing-box check`: inline PEM in
 * `tls.certificate` / `tls.key` is accepted on both the inbound and the
 * outbound, so nothing has to exist on disk.
 */

/** The name in the certificate, and the `server_name` both ends send.
 *
 *  Fixed, and deliberately not resolvable: a leg is dialled by IP or by the
 *  node's own address, and the SNI is only there because TLS insists on one.
 *  Making it look like a real domain would invite somebody to point DNS at it. */
export const LINK_TLS_SERVER_NAME = 'link.iceslab.local';

/** Ten years. A leg's certificate is pinned by the other end, so expiry buys
 *  nothing and costs an outage on a fleet nobody has touched in a year. */
const LINK_CERT_LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000;

const ALGORITHM: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};

const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

// Same boundary as keygen.crypto.ts: Node's webcrypto CryptoKey and the DOM one
// @peculiar/x509 expects are structurally identical at runtime and distinct to
// TypeScript.
type Key = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LinkTls {
  /** PEM, handed to the receiving side and pinned by the dialling one. */
  certPem: string;
  /** PEM, handed ONLY to the receiving side. */
  keyPem: string;
}

/** Mint the pair for one leg. */
export async function generateLinkTls(): Promise<LinkTls> {
  const keys = (await webcrypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify'])) as {
    publicKey: Key;
    privateKey: Key;
  };

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerialHex(),
    subject: `CN=${LINK_TLS_SERVER_NAME}`,
    issuer: `CN=${LINK_TLS_SERVER_NAME}`,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + LINK_CERT_LIFETIME_MS),
    signingAlgorithm: ALGORITHM,
    publicKey: keys.publicKey,
    signingKey: keys.privateKey,
    extensions: [
      // A leaf, not an authority: this certificate signs nothing else, and
      // saying so keeps a stolen leg key from minting anything.
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
        true,
      ),
      new x509.ExtendedKeyUsageExtension([OID_SERVER_AUTH], true),
      // The name has to be in the SAN as well as the subject: a certificate
      // with a CN and no SAN is rejected by every modern stack, ours included.
      new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: LINK_TLS_SERVER_NAME }]),
    ],
  });

  const der = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  return { certPem: cert.toString('pem'), keyPem: privateKeyDerToPem(der) };
}

/**
 * PEM as sing-box wants it in a config: an array of LINES.
 *
 * A single string with newlines is accepted too, but the array is what makes a
 * golden readable and a diff meaningful: a changed certificate shows as the
 * lines that changed rather than as one enormous altered string.
 */
export function pemLines(pem: string): string[] {
  return pem.trim().split(/\r?\n/);
}

function privateKeyDerToPem(der: ArrayBuffer): string {
  const b64 = Buffer.from(der).toString('base64');
  const wrapped = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

function randomSerialHex(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(16));
  // Top bit clear: ASN.1 INTEGER is signed.
  bytes[0]! &= 0x7f;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
