import { adapterSlot, MULTI_INBOUND_ADAPTERS } from '@iceslab/shared';

/**
 * One inbound per adapter on a node (A-055), what the screens do with it.
 *
 * The rule itself, the adapter key and the adapters that take several
 * inbounds, lives in `@iceslab/shared` (adapters.ts, A-175/A-196): the server's
 * gate and the screens read one table. This file holds only what the screens
 * add on top: which pick to not offer in the wizard, and how a refusal reads.
 */

export { adapterSlot };

/** The adapter takes more than one inbound on one node. */
export function slotShared(slot: string): boolean {
  return MULTI_INBOUND_ADAPTERS.includes(slot);
}

type SlotProfile = { id: string; name: string; protocol: string; engine: string | null; awgProtocol?: number | null };

/**
 * Candidates that cannot be picked because a picked profile already holds
 * their adapter on this node: id -> the name of the one that holds it.
 */
export function slotHeldBy(candidates: readonly SlotProfile[], selected: readonly string[]): Map<string, string> {
  const picked = new Set(selected);
  const holder = new Map<string, string>();
  for (const p of candidates) {
    if (!picked.has(p.id)) continue;
    const slot = adapterSlot(p);
    if (!slotShared(slot) && !holder.has(slot)) holder.set(slot, p.name);
  }
  const out = new Map<string, string>();
  for (const p of candidates) {
    if (picked.has(p.id)) continue;
    const by = holder.get(adapterSlot(p));
    if (by !== undefined) out.set(p.id, by);
  }
  return out;
}

/**
 * «Select all» that stays within one inbound per adapter: keeps the current
 * picks and adds candidates in order, skipping any whose adapter is taken.
 */
export function addOnePerSlot(selected: readonly string[], candidates: readonly SlotProfile[]): string[] {
  const out = [...selected];
  const taken = new Set(
    candidates.filter((p) => selected.includes(p.id)).map(adapterSlot).filter((s) => !slotShared(s)),
  );
  for (const p of candidates) {
    if (out.includes(p.id)) continue;
    const slot = adapterSlot(p);
    if (!slotShared(slot)) {
      if (taken.has(slot)) continue;
      taken.add(slot);
    }
    out.push(p.id);
  }
  return out;
}

/**
 * The two 409s a binding can meet on a node's adapter, read with the input
 * checked first:
 *   slot  ADAPTER_SLOT_TAKEN { protocol, engine, heldBy } (A-055): the adapter
 *         holds one inbound and serves another already;
 *   mtu   MIERU_MTU_MISMATCH { nodeName, mtu, wanted, heldBy }: mieru takes
 *         several inbounds, but one MTU per process.
 * `nodeName` is there when the server names the node (PUT /api/profiles/:id
 * names it for both; POST /api/hosts and /api/bindings name it for MTU only).
 */
export type AdapterRefusal =
  | { kind: 'slot'; nodeName: string | null; protocol: string; engine: string; heldBy: string }
  | { kind: 'mtu'; nodeName: string | null; mtu: number | null; wanted: number | null; heldBy: string };

export function adapterRefusal(err: unknown): AdapterRefusal | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return null;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (status !== 409 || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const nodeName = typeof d.nodeName === 'string' && d.nodeName !== '' ? d.nodeName : null;
  if (d.error === 'ADAPTER_SLOT_TAKEN') {
    return { kind: 'slot', nodeName, protocol: str(d.protocol), engine: str(d.engine), heldBy: str(d.heldBy) };
  }
  if (d.error === 'MIERU_MTU_MISMATCH') {
    return { kind: 'mtu', nodeName, mtu: num(d.mtu), wanted: num(d.wanted), heldBy: str(d.heldBy) };
  }
  return null;
}

/**
 * The refusal in the panel's words; the node is named when the server named it.
 * A-259: when the holder is the very profile being placed (`profileName`), the
 * profile stands on the node on another port and the adapter takes one inbound,
 * so a second port for it is what is refused, not a stranger's inbound.
 */
export function adapterRefusalWords(
  r: AdapterRefusal,
  t: (key: string, opts?: Record<string, unknown>) => string,
  profileName?: string,
): string {
  const body =
    r.kind === 'slot'
      ? t(r.heldBy !== '' && r.heldBy === profileName ? 'hostEdit.adapterSlotSelf' : 'hostEdit.adapterSlotTaken', {
          protocol: r.protocol,
          engine: r.engine,
          heldBy: r.heldBy,
        })
      : t('hostEdit.mieruMtuMismatch', { mtu: r.mtu ?? '?', wanted: r.wanted ?? '?', heldBy: r.heldBy });
  return r.nodeName ? `${t('hostEdit.onNode', { name: r.nodeName })} ${body}` : body;
}
