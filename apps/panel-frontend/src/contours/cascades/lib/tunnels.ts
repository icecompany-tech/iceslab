import type { CascadeTunnel } from '@/lib/domain/cascades';

/**
 * The AmneziaWG tunnels of a cascade as the page lists them (phase 8.3).
 *
 * A row per node pair, named by the nodes rather than their ids, in the order
 * the server keeps (by tunnel index). `openPorts` names the receiving nodes
 * whose leg port stays reachable from the internet: there a leg arrives
 * without a tunnel, and a wildcard listener cannot share the port with an
 * inner one, so the tunnel does not hide that port.
 *
 * `tunnels` absent (a server older than the field) and empty are both «nothing
 * to list»: the block is not drawn.
 */
export interface TunnelRow {
  key: string;
  fromNodeId: string;
  toNodeId: string;
  fromName: string;
  toName: string;
  iface: string;
  network: string;
  fromAddress: string;
  toAddress: string;
  port: number;
  publicLinkPortOpen: boolean;
}

export function tunnelRows(
  tunnels: CascadeTunnel[] | undefined,
  nodeById: ReadonlyMap<string, { name: string }>,
): { rows: TunnelRow[]; openPorts: string[] } {
  const name = (id: string) => nodeById.get(id)?.name ?? id.slice(0, 8);
  const rows = (tunnels ?? []).map((t) => ({
    key: `${t.fromNodeId}>${t.toNodeId}`,
    fromNodeId: t.fromNodeId,
    toNodeId: t.toNodeId,
    fromName: name(t.fromNodeId),
    toName: name(t.toNodeId),
    iface: t.iface,
    network: t.network,
    fromAddress: t.fromAddress,
    toAddress: t.toAddress,
    port: t.port,
    publicLinkPortOpen: t.publicLinkPortOpen,
  }));
  const openPorts = [...new Set(rows.filter((r) => r.publicLinkPortOpen).map((r) => r.toName))];
  return { rows, openPorts };
}

/**
 * 404 TUNNEL_NOT_FOUND: the pair is gone (the cascade was saved without it
 * since the page loaded). The server's sentence, or null for any other error.
 * The input is checked first.
 */
export function tunnelNotFound(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || res.status !== 404 || !res.data || typeof res.data !== 'object') return null;
  const d = res.data as { error?: unknown; message?: unknown };
  if (d.error !== 'TUNNEL_NOT_FOUND') return null;
  return typeof d.message === 'string' ? d.message : '';
}
