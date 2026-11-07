/**
 * What the port field of a host means for the node, said before the save
 * (A-259).
 *
 * A profile stands on a node as many times as it has ports: one binding, one
 * inbound per port. So a host is placed by (profile, node, PORT), and the pair
 * alone names no binding. The server follows the same rule (POST /api/hosts
 * picks the binding by port; PUT moves this host or the whole inbound by
 * `portMove`), this function only says it in advance:
 *
 *   join        another inbound of this profile on this node listens there
 *               already, the host stands on it next to its hosts;
 *   newInbound  create: the profile listens on this node on other ports, this
 *               one is one more inbound;
 *   split       edit, `portMove: 'host'`: the host leaves for its own inbound,
 *               the others stay on the old port;
 *   moveAll     edit, `portMove: 'binding'`: the inbound moves with its hosts.
 *
 * `null`: nothing to say (no port yet, the port did not change, the profile is
 * new to the node, a host alone on its inbound, or the lists do not hold the
 * host's binding: an unknown binding is not a plan).
 */
import type { HostPortMove } from '@/lib/old/hosts';

export type HostPortPlan =
  | { kind: 'join'; port: number; hosts: string[] }
  | { kind: 'newInbound'; port: number; ports: number[] }
  | { kind: 'split'; port: number; from: number; others: string[] }
  | { kind: 'moveAll'; port: number; from: number; others: string[] };

type B = { id: string; profileId: string; nodeId: string; port: number };
type H = { id: string; bindingId: string; remark: string };

export function hostPortPlan(input: {
  bindings: readonly B[];
  hosts: readonly H[];
  /** Create: the picked profile and node. Edit: ignored, the host's binding says. */
  profileId: string | null;
  nodeId: string | null;
  port: number | '';
  /** Edit: the host and its binding; null on create. */
  self: { hostId: string; bindingId: string } | null;
  move: HostPortMove;
}): HostPortPlan | null {
  const { bindings, hosts, port, self, move } = input;
  if (typeof port !== 'number' || !Number.isInteger(port)) return null;
  const namesOn = (bindingId: string) =>
    hosts.filter((h) => h.bindingId === bindingId && h.id !== self?.hostId).map((h) => h.remark);

  if (self) {
    const own = bindings.find((b) => b.id === self.bindingId);
    if (!own || own.port === port) return null;
    const others = namesOn(own.id);
    const sibling = bindings.find(
      (b) => b.id !== own.id && b.profileId === own.profileId && b.nodeId === own.nodeId && b.port === port,
    );
    // The whole inbound onto a sibling's port is the server's to refuse; the
    // screen does not promise a join there.
    if (others.length > 0 && move === 'binding') return { kind: 'moveAll', port, from: own.port, others };
    if (sibling) return { kind: 'join', port, hosts: namesOn(sibling.id) };
    if (others.length > 0) return { kind: 'split', port, from: own.port, others };
    return null;
  }

  const { profileId, nodeId } = input;
  if (!profileId || !nodeId) return null;
  const pair = bindings.filter((b) => b.profileId === profileId && b.nodeId === nodeId);
  const sibling = pair.find((b) => b.port === port);
  if (sibling) return { kind: 'join', port, hosts: namesOn(sibling.id) };
  if (pair.length > 0) return { kind: 'newInbound', port, ports: [...new Set(pair.map((b) => b.port))].sort((a, b) => a - b) };
  return null;
}
