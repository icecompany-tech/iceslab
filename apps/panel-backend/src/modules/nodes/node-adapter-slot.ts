import { adapterSlot, MULTI_INBOUND_ADAPTERS } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { pushedBindingsWhere } from './pushed-bindings.js';

/**
 * A-055: one inbound per adapter on a node, where the agent holds one.
 *
 * The agent hands an inbound to an adapter by the pair (protocol, engine),
 * and for AmneziaWG by (protocol, generation) (server.go:1113-1127, adapterFor).
 * Every adapter but native xray keeps ONE inbound: a second one pushed to it
 * silently replaces the first, so the operator sees two hosts and the node
 * serves one. List from the agent window, read in code 22.10:
 *   - single: hysteria, naive, shadowsocks, mtproto, mieru (native);
 *   - AmneziaWG: one per generation, 1.x and 3.1 apart;
 *   - sing-box: one per protocol (tuic, anytls, the xray family, hysteria,
 *     shadowsocks, shadowtls);
 *   - many: xray on xray, and mieru since the agent's f8bac16.
 *
 * Refused here, by name, until the agent ships multi-inbound for a pair; then
 * that pair joins MULTI_INBOUND_ADAPTERS (packages/shared, adapters.ts, one
 * line, read by the screen too) and the refusal lifts for it alone.
 */
const MULTI = new Set(MULTI_INBOUND_ADAPTERS);

export { adapterSlot };

/** mieru's MTU as the node would get it: the profile merged with the
 *  binding's overrides (resolveBindingConfig, shallow), 1400 by default. */
const MIERU_DEFAULT_MTU = 1400;
function mieruMtu(config: unknown, overrides?: unknown): number {
  const merged = { ...((config ?? {}) as object), ...((overrides ?? {}) as object) } as { mtu?: unknown };
  return typeof merged.mtu === 'number' ? merged.mtu : MIERU_DEFAULT_MTU;
}

export class MieruMtuMismatchError extends Error {
  readonly code = 'MIERU_MTU_MISMATCH';
  constructor(
    public nodeName: string,
    public mtu: number,
    public wanted: number,
    public heldBy: string,
  ) {
    super(
      `mieru on node "${nodeName}" already runs with MTU ${mtu} ("${heldBy}"); a second mieru inbound ` +
        `there must use the same MTU, not ${wanted}. One mita process holds one MTU, and the agent ` +
        `would refuse the push.`,
    );
    this.name = 'MieruMtuMismatchError';
  }
}

export class AdapterSlotTakenError extends Error {
  readonly code = 'ADAPTER_SLOT_TAKEN';
  constructor(
    public nodeName: string,
    public protocol: string,
    public engine: string,
    public heldBy: string,
  ) {
    super(
      `node "${nodeName}" already has an inbound ${protocol} on the ${engine} engine: "${heldBy}". ` +
        `The node holds one such inbound today; a second one would silently replace the first.`,
    );
    this.name = 'AdapterSlotTakenError';
  }
}

/** Two or more pushed bindings on one single-inbound adapter of a node. */
export interface AdapterSlotConflict {
  protocol: string;
  /** The engine, or for AmneziaWG its generation ('1' or '3'). */
  engine: string;
  /** Port order, the order the push sends them in. */
  bindings: { bindingId: string; profileName: string; port: number }[];
  /** The one the node serves: the agent keeps the last it is pushed. */
  servedBindingId: string;
}

/**
 * A-195: the nodes A-055 came too late for. Its refusal stops a NEW second
 * binding on an adapter that holds one; bindings that stood before it stay,
 * the agent serves one of them (the last by port, the order of the push), and
 * the subscription hands out both. Answered so the sync status can say it;
 * the bindings themselves are not touched. Pushed bindings only, by the push's
 * own filter: a disabled one takes no slot on the node.
 */
export async function adapterSlotConflicts(nodeId: string): Promise<AdapterSlotConflict[]> {
  const rows = await prisma.profileNodeBinding.findMany({
    // The push's own filter, one function for the push and every report (A-204).
    where: pushedBindingsWhere(nodeId),
    orderBy: { port: 'asc' },
    select: {
      id: true,
      port: true,
      profile: { select: { name: true, protocol: true, engine: true, awgProtocol: true } },
    },
  });
  const bySlot = new Map<string, typeof rows>();
  for (const r of rows) {
    const slot = adapterSlot(r.profile);
    if (MULTI.has(slot)) continue;
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), r]);
  }
  const out: AdapterSlotConflict[] = [];
  for (const [slot, held] of bySlot) {
    if (held.length < 2) continue;
    const [protocol, engine] = slot.split('|') as [string, string];
    out.push({
      protocol,
      engine,
      bindings: held.map((b) => ({ bindingId: b.id, profileName: b.profile.name, port: b.port })),
      servedBindingId: held.at(-1)!.id,
    });
  }
  return out;
}

/**
 * Refuses a binding of `profile` on the node when its adapter already serves
 * another binding there. `exceptBindingId` is the binding being saved, left
 * out of the count; a new binding has none.
 *
 * A-259: by BINDING, not by profile. Since one profile may sit on a node on
 * several ports, the profile's own other bindings are bindings like any other:
 * a second hysteria of the same profile takes the one slot the first holds.
 * Leaving out every binding of the profile let exactly that through. They are
 * counted with the slot and config given here, which is the profile as it is
 * about to be (an engine switch, A-194, moves all of them at once).
 */
export async function assertAdapterSlotFree(
  node: { id: string; name: string },
  profile: { id: string; protocol: string; engine: string | null; awgProtocol?: number | null; config?: unknown },
  overrides?: unknown,
  exceptBindingId?: string,
  db: Pick<typeof prisma, 'profileNodeBinding'> = prisma,
): Promise<void> {
  const slot = adapterSlot(profile);
  const others = await db.profileNodeBinding.findMany({
    where: { nodeId: node.id, ...(exceptBindingId ? { id: { not: exceptBindingId } } : {}) },
    select: {
      profileId: true,
      overrides: true,
      profile: { select: { name: true, protocol: true, engine: true, awgProtocol: true, config: true } },
      hosts: { select: { remark: true }, orderBy: { priority: 'asc' }, take: 1 },
    },
  });
  const own = (b: (typeof others)[number]) => b.profileId === profile.id;
  const held = others.find((b) => (own(b) ? slot : adapterSlot(b.profile)) === slot);
  if (!held) return;
  if (MULTI.has(slot)) {
    // P2: what the agent would refuse on the push is refused at the save.
    if (slot === 'mieru|mieru') {
      const mtu = mieruMtu(own(held) ? profile.config : held.profile.config, held.overrides);
      const wanted = mieruMtu(profile.config, overrides);
      if (mtu !== wanted) {
        throw new MieruMtuMismatchError(node.name, mtu, wanted, held.hosts[0]?.remark ?? held.profile.name);
      }
    }
    return;
  }
  const [protocol, engine] = slot.split('|') as [string, string];
  throw new AdapterSlotTakenError(
    node.name,
    protocol,
    protocol === 'amneziawg' ? `AmneziaWG ${engine === '3' ? '3.1' : '1.x'}` : engine,
    held.hosts[0]?.remark ?? held.profile.name,
  );
}
