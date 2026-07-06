// `@peculiar/x509@2` pulls in tsyringe, which requires this polyfill.
// Must be imported before x509.
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { webcrypto } from 'node:crypto';

// @peculiar/x509 needs an explicit Crypto provider. Node 20+ ships native
// webcrypto under node:crypto, we wire it once at module load.
x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const ALGORITHM: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const TEN_YEARS_MS = 10 * ONE_YEAR_MS;

// OIDs for ExtendedKeyUsage extension
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const OID_CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';

export interface CertBundle {
  certPem: string;
  privateKeyPem: string;
}

export interface NodeCertOptions {
  commonName: string;
  /** Subject Alternative Names (DNS / IP) for the node's address. */
  sans?: { type: 'dns' | 'ip'; value: string }[];
}

// Node's webcrypto types and the DOM CryptoKey @peculiar/x509 expects are
// structurally the same at runtime but treated as distinct by TypeScript
// (Node 22 webcrypto adds 'decapsulateBits' to KeyUsage which DOM doesn't have).
// We use `any` at this boundary instead of fighting the type system.
type Key = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ───── PEM <-> DER helpers (private keys) ─────

function privateKeyDerToPem(der: ArrayBuffer): string {
  const b64 = Buffer.from(der).toString('base64');
  const wrapped = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

function pemToDer(pem: string): ArrayBuffer {
  const cleaned = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const buf = Buffer.from(cleaned, 'base64');
  // Node's Buffer.from may return a slice into a shared internal pool, `.buffer`
  // would expose the whole pool, not just our bytes. Copy into a standalone
  // ArrayBuffer so webcrypto.subtle.importKey sees only our DER blob.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function importPrivateKey(pem: string): Promise<Key> {
  return webcrypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem),
    ALGORITHM,
    false,
    ['sign'],
  );
}

async function exportPrivateKeyPem(key: Key): Promise<string> {
  const der = await webcrypto.subtle.exportKey('pkcs8', key);
  return privateKeyDerToPem(der);
}

// ───── Serial numbers ─────

function randomSerialHex(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(16));
  // Top bit must be 0, ASN.1 INTEGER is signed.
  bytes[0]! &= 0x7f;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ───── CA generation ─────

export async function generateCa(): Promise<CertBundle> {
  const keys = (await webcrypto.subtle.generateKey(
    ALGORITHM,
    true,
    ['sign', 'verify'],
  )) as { publicKey: Key; privateKey: Key };

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerialHex(),
    subject: 'CN=Iceslab CA',
    issuer: 'CN=Iceslab CA',
    notBefore: new Date(),
    notAfter: new Date(Date.now() + TEN_YEARS_MS),
    signingAlgorithm: ALGORITHM,
    publicKey: keys.publicKey,
    signingKey: keys.privateKey,
    extensions: [
      // CA-only: no leaf-cert capability bits, no digitalSignature. The
      // panel uses a *separate* clientAuth-only cert (see generatePanelClientCert)
      // for talking to nodes; the CA private key never appears in a TLS
      // handshake. This prevents a compromised node, which holds the CA
      // *cert* in clientCAs, from being able to mint or impersonate
      // anything under it.
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });

  return {
    certPem: cert.toString('pem'),
    privateKeyPem: await exportPrivateKeyPem(keys.privateKey),
  };
}

// ───── Panel client cert (clientAuth-only, signed by CA) ─────
//
// Slice S6 - used to be: panel presented the CA cert itself as its TLS
// leaf when calling node-agents. Any compromised node leaf could then
// also identify as the CA, talk to other nodes, and steal credentials
// fleet-wide.
//
// New flow: at CA-bootstrap time we also issue a single panel-client
// leaf with EKU=clientAuth ONLY (no serverAuth, no caCertSign). The
// CA private key stays in the DB and never participates in a handshake.
// The panel-client cert's SHA-256 fingerprint is shipped to every node
// in the bootstrap payload; agents pin the leaf and reject anything
// else, even if it's CA-signed.
export async function generatePanelClientCert(ca: CertBundle): Promise<CertBundle> {
  const caCert = new x509.X509Certificate(ca.certPem);
  const caKey = await importPrivateKey(ca.privateKeyPem);

  const keys = (await webcrypto.subtle.generateKey(
    ALGORITHM,
    true,
    ['sign', 'verify'],
  )) as { publicKey: Key; privateKey: Key };

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerialHex(),
    subject: 'CN=Iceslab-Client',
    issuer: caCert.subject,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + TEN_YEARS_MS),
    signingAlgorithm: ALGORITHM,
    publicKey: keys.publicKey,
    signingKey: caKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      // Critical: clientAuth ONLY. No serverAuth means a stolen node
      // can't use this to impersonate the panel as a TLS server either.
      new x509.ExtendedKeyUsageExtension([OID_CLIENT_AUTH], true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
        true,
      ),
    ],
  });

  return {
    certPem: cert.toString('pem'),
    privateKeyPem: await exportPrivateKeyPem(keys.privateKey),
  };
}

// ───── Cert fingerprint helpers ─────

/**
 * SHA-256 fingerprint over the DER-encoded cert. Lowercase hex, no colons.
 * Matches what `openssl x509 -fingerprint -sha256 -noout -in cert.pem`
 * produces when you strip the `:` separators and lowercase.
 */
export async function certFingerprintSha256(certPem: string): Promise<string> {
  const cert = new x509.X509Certificate(certPem);
  const digest = await webcrypto.subtle.digest('SHA-256', cert.rawData);
  return Buffer.from(digest).toString('hex');
}

// ───── Per-node cert (signed by CA) ─────

export async function generateNodeCert(
  ca: CertBundle,
  opts: NodeCertOptions,
): Promise<CertBundle> {
  const caCert = new x509.X509Certificate(ca.certPem);
  const caKey = await importPrivateKey(ca.privateKeyPem);

  const keys = (await webcrypto.subtle.generateKey(
    ALGORITHM,
    true,
    ['sign', 'verify'],
  )) as { publicKey: Key; privateKey: Key };

  const extensions: x509.Extension[] = [
    new x509.BasicConstraintsExtension(false, undefined, true),
    new x509.KeyUsagesExtension(
      x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
      true,
    ),
    new x509.ExtendedKeyUsageExtension([OID_SERVER_AUTH, OID_CLIENT_AUTH], true),
  ];

  if (opts.sans && opts.sans.length > 0) {
    extensions.push(
      new x509.SubjectAlternativeNameExtension(
        opts.sans.map((s) => ({ type: s.type, value: s.value })),
      ),
    );
  }

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerialHex(),
    subject: `CN=${opts.commonName}`,
    issuer: caCert.subject,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + ONE_YEAR_MS),
    signingAlgorithm: ALGORITHM,
    publicKey: keys.publicKey,
    signingKey: caKey,
    extensions,
  });

  return {
    certPem: cert.toString('pem'),
    privateKeyPem: await exportPrivateKeyPem(keys.privateKey),
  };
}
