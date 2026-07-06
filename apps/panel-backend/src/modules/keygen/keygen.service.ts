import { prisma } from '../../prisma.js';
import { notifyTelegramAsync } from '../../lib/telegram-notify.js';
import {
  generateCa,
  generateNodeCert,
  generatePanelClientCert,
  certFingerprintSha256,
  type CertBundle,
  type NodeCertOptions,
} from './keygen.crypto.js';

const SINGLETON_ID = 1;

/**
 * Payload handed to a node on registration. Encoded into a base64url blob
 * via {@link encodeNodePayload}; the node decodes it on first boot to learn
 * its identity and trust anchor.
 *
 * Slice 38: added `panelUrl`, `nodeId`, `heartbeatToken` for the agent's
 * heartbeat self-destruct loop. They're optional in the type so existing
 * payloads that lack them (issued before the migration landed) still
 * decode; agents whose payloads are missing them simply skip heartbeats.
 */
export interface NodePayload {
  nodeCertPem: string;
  nodeKeyPem: string;
  caCertPem: string;
  panelUrl?: string;
  nodeId?: string;
  heartbeatToken?: string;
  // Slice S6: SHA-256 fingerprint (lowercase hex, no colons) of the
  // panel-client cert. Agents pin this and reject any TLS leaf whose
  // SHA-256 doesn't match, even if it's CA-signed. Closes the lateral-
  // movement window where a compromised node's leaf could be replayed
  // against other nodes.
  panelClientFingerprint?: string;
}

/**
 * Idempotent: load the panel CA from the database, generating one on the very
 * first call. The CA never rotates automatically, operators wanting rotation
 * must wipe `keygen_ca` and re-issue every node cert.
 */
export async function bootstrapCa(): Promise<CertBundle> {
  const existing = await prisma.keygenCa.findUnique({
    where: { id: SINGLETON_ID },
  });
  if (existing) {
    return {
      certPem: existing.certPem,
      privateKeyPem: existing.privateKeyPem,
    };
  }

  const ca = await generateCa();
  // First-time bootstrap: also generate the panel-client cert so the
  // single DB row is always self-consistent. Existing rows from before
  // S6 lazily backfill via getPanelClientCert() below.
  const panelClient = await generatePanelClientCert(ca);
  await prisma.keygenCa.create({
    data: {
      id: SINGLETON_ID,
      certPem: ca.certPem,
      privateKeyPem: ca.privateKeyPem,
      panelClientCertPem: panelClient.certPem,
      panelClientKeyPem: panelClient.privateKeyPem,
    },
  });
  // CA generation only happens on first-ever panel boot OR after a manual
  // `keygen_ca` wipe, both are events admins want to know about. (A surprise
  // CA bootstrap = panel DB got wiped without anyone meaning to, every node
  // will fail mTLS until re-bootstrapped.)
  notifyTelegramAsync(
    `🔑 *Panel CA bootstrapped*\nEvery existing node must be re-installed with the new bootstrap token.`,
  );
  return ca;
}

/**
 * Slice S6: separate clientAuth-only leaf for panel→node mTLS handshakes.
 * The CA private key never appears in a TLS handshake.
 *
 * Lazy-backfilled: rows that pre-date S6 had NULL panel_client_*; on the
 * first call we generate the leaf (signed by the CA), persist, and return.
 * Subsequent calls are a single SELECT.
 */
export async function getPanelClientCert(): Promise<CertBundle> {
  const ca = await bootstrapCa();
  const row = await prisma.keygenCa.findUnique({
    where: { id: SINGLETON_ID },
  });
  if (row?.panelClientCertPem && row.panelClientKeyPem) {
    return {
      certPem: row.panelClientCertPem,
      privateKeyPem: row.panelClientKeyPem,
    };
  }
  // Backfill: only happens once per upgraded install.
  const panelClient = await generatePanelClientCert(ca);
  await prisma.keygenCa.update({
    where: { id: SINGLETON_ID },
    data: {
      panelClientCertPem: panelClient.certPem,
      panelClientKeyPem: panelClient.privateKeyPem,
    },
  });
  return panelClient;
}

/**
 * SHA-256 fingerprint of the panel-client cert. Each node payload bundles
 * this string; the agent pins the leaf and rejects any other cert during
 * mTLS handshakes, even valid CA-signed leaves from a compromised peer.
 */
export async function getPanelClientFingerprint(): Promise<string> {
  const cert = await getPanelClientCert();
  return certFingerprintSha256(cert.certPem);
}

/**
 * Issue a per-node mTLS certificate signed by the panel CA. Returns the
 * complete payload the node needs (its cert, its key, and the CA cert).
 */
export async function issueNodeCert(opts: NodeCertOptions): Promise<NodePayload> {
  const ca = await bootstrapCa();
  const nodeCert = await generateNodeCert(ca, opts);
  return {
    nodeCertPem: nodeCert.certPem,
    nodeKeyPem: nodeCert.privateKeyPem,
    caCertPem: ca.certPem,
  };
}

/**
 * Encode a node payload as a base64url JSON blob, suitable for passing as a
 * single env-var or query param to the node-agent on first boot.
 */
export function encodeNodePayload(payload: NodePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode a base64url payload back into structured data. Mirror of
 * {@link encodeNodePayload}; used by tests and (in slice 10) by the Go agent.
 */
export function decodeNodePayload(encoded: string): NodePayload {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as NodePayload;
}
