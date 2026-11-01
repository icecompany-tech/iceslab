import type { BootstrapCoreVersions } from '@iceslab/shared';
import { encodeNodePayload, getPanelClientFingerprint, issueNodeCert } from '../keygen/keygen.service.js';
import { config } from '../../config.js';
import { signHeartbeatToken } from './heartbeat-token.js';

/**
 * A-295: the node's payload, one build for both ways it leaves the panel, the
 * answer to node create (pasted or downloaded, `--payload-file`) and the
 * bootstrap redeem (`--bootstrap`).
 *
 * The create path used to carry the certificate and nothing more: no
 * panelClientFingerprint, so the agent refused to start (server.go, the pin is
 * fail-closed) and systemd restarted it for ever; no panelUrl / nodeId /
 * heartbeatToken, so its heartbeat stayed off. The redeem path built the full
 * set. One function now, so the two cannot differ again.
 *
 * A fresh certificate on every call, as before: the panel keeps no node key.
 */
export async function buildNodePayload(
  node: { id: string; name: string; address: string; heartbeatSecret: Uint8Array },
  coreVersions: BootstrapCoreVersions,
): Promise<string> {
  const cert = await issueNodeCert({ commonName: node.name, sans: buildSans(node.address) });
  return encodeNodePayload({
    ...cert,
    // Slice 38: the agent polls PANEL_URL/api/internal/nodes/me/status with
    // this token and stops on 410 Gone. heartbeat_secret never leaves the
    // panel, only the HMAC of it does.
    panelUrl: config.PUBLIC_URL,
    nodeId: node.id,
    heartbeatToken: signHeartbeatToken(node.id, Buffer.from(node.heartbeatSecret)),
    // Slice S6: the panel-client cert the agent pins; without it the agent
    // does not start.
    panelClientFingerprint: await getPanelClientFingerprint(),
    // The installer's defaults for the core versions (explicit env wins),
    // read through `iceslab-node core-env`.
    coreVersions,
  });
}

/**
 * A-295: whether a node can fetch its payload by bootstrap token from this
 * panel URL. The installer refuses a non-https --panel-url for the redeem
 * (install-iceslab-node.sh, the --panel-url case): the token would cross the
 * network in clear, and a plain-http panel URL can be redirected. Such a
 * panel installs its nodes with --payload-file instead.
 */
export function bootstrapUsable(panelUrl: string): boolean {
  try {
    return new URL(panelUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** The certificate's name for the node's address: an IP, or a DNS name. */
export function buildSans(address: string): { type: 'dns' | 'ip'; value: string }[] {
  const host = address.split(':')[0]!;
  return [{ type: IPV4_RE.test(host) ? 'ip' : 'dns', value: host }];
}
