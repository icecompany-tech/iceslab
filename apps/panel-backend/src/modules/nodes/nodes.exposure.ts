import type { InboundDto, UfwPortDto, UfwPortsResponse } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { fetchEnabledInbounds } from '../inbounds/inbounds.queue.js';
import { NodeTransport, NodeRequestError } from './nodes.transport.js';

/**
 * G4 probe-exposure. The node-agent reports which ports ufw allows; the panel
 * compares that to the set it EXPECTS open and surfaces the difference, so an
 * operator notices a stray port (a forgotten test service, a manual `ufw allow`)
 * left exposed on a node that should look like an ordinary host.
 *
 * The comparison is pure + unit-tested; the transport call is best-effort and
 * never throws upward (an old agent without /ufwPorts, an unreachable node, or
 * a ufw-less host all degrade to "not checked", never an error or a flip).
 */

/** Proto(s) ufw opens for a protocol, mirroring the node-agent's protoForInbound
 *  (server.go): hysteria/amneziawg/tuic = udp (tuic rides QUIC), shadowsocks/
 *  mieru = tcp+udp, else tcp (xray/naive/mtproto/anytls/shadowtls). */
export function protosForProtocol(protocol: string): ('tcp' | 'udp')[] {
  switch (protocol) {
    case 'hysteria':
    case 'amneziawg':
    case 'tuic':
      return ['udp'];
    case 'shadowsocks':
    case 'mieru':
      return ['tcp', 'udp'];
    default:
      return ['tcp'];
  }
}

/** The "port/proto" specs the panel expects a node to have open: every enabled
 *  binding (port x proto), SSH 22/tcp, the mTLS agent port, and the ACME helper
 *  80/tcp. Anything ufw allows beyond this set is reported as unexpected. */
export function buildExpectedPortSet(inbounds: InboundDto[], agentPort: number): Set<string> {
  const set = new Set<string>();
  set.add('22/tcp'); // SSH
  set.add(`${agentPort}/tcp`); // mTLS agent endpoint
  set.add('80/tcp'); // ACME HTTP-01 (hysteria / naive)
  for (const ib of inbounds) {
    for (const proto of protosForProtocol(ib.protocol)) {
      set.add(`${ib.port}/${proto}`);
    }
  }
  return set;
}

/** Pure: the allowed ports NOT in the expected set, as sorted "port/proto". */
export function computePortExposure(allowed: UfwPortDto[], expected: Set<string>): string[] {
  const extras: string[] = [];
  for (const p of allowed) {
    const spec = `${p.port}/${p.proto}`;
    if (!expected.has(spec)) extras.push(spec);
  }
  return extras.sort();
}

export interface PortExposureResult {
  /** false when the check could not run (ufw-less host, old/unreachable agent). */
  checked: boolean;
  managed?: boolean;
  expected?: string[];
  extras?: string[];
  /** Human-readable reason when checked=false. */
  note?: string;
}

/** Query a node's ufw-allowed ports and diff against the expected set.
 *  Best-effort: any agent/transport failure or a ufw-less host returns
 *  checked:false instead of throwing, so this is purely advisory. */
export async function checkNodePortExposure(nodeId: string): Promise<PortExposureResult> {
  const node = await prisma.node.findFirst({
    where: { id: nodeId, deletedAt: null },
    select: { address: true },
  });
  if (!node) return { checked: false, note: 'node not found' };

  let resp: UfwPortsResponse;
  try {
    resp = await new NodeTransport({ address: node.address }).getUfwPorts();
  } catch (err) {
    // Old agent (404 /ufwPorts), timeout, or any transport error: skip, never
    // break or flip the node. The exposure check is advisory only.
    const note =
      err instanceof NodeRequestError ? `agent: ${err.message}` : 'node unreachable';
    return { checked: false, note };
  }
  if (!resp.managed) {
    return { checked: false, managed: false, note: 'ufw not installed on node' };
  }

  // node.address is host[:port]; the agent mTLS port defaults to 1337 (see
  // nodes.transport buildUrl) when no port is set.
  const agentPort = node.address.includes(':')
    ? Number(node.address.split(':').pop()) || 1337
    : 1337;
  const inbounds = await fetchEnabledInbounds(nodeId);
  const expected = buildExpectedPortSet(inbounds, agentPort);
  const extras = computePortExposure(resp.ports, expected);
  return { checked: true, managed: true, expected: [...expected].sort(), extras };
}
