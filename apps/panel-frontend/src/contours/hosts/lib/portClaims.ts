import type { Transport } from '@iceslab/shared';

/**
 * Какие ноды закрыты для этого хоста занятым портом, и кем (E40).
 *
 * Порт занят парой (порт, транспорт), как считают сервер и checkNodePort:
 * hysteria на 443/udp стоит рядом с REALITY на 443/tcp. Раньше строка ноды
 * закрывалась по одному номеру порта, то есть hy2 на 443 не ставился рядом с
 * vless на 443, хотя сервер это пускает.
 *
 * Привязка без `transport` (сервер старше поля) закрывает по номеру, как
 * раньше: неполный факт не повод открыть порт, который может быть занят.
 * Свой же хост (правка) порт не занимает.
 */
export interface PortClaim {
  /** Имя хоста, который держит порт. */
  host: string;
  /** «443/tcp», когда транспорт держателя известен; иначе «443». */
  label: string;
}

export function nodePortClaims(
  bindings: readonly { id: string; nodeId: string; port: number; transport?: Transport }[],
  hosts: readonly { id: string; bindingId: string; remark: string }[],
  port: number | '',
  transport: Transport,
  selfHostId: string | undefined,
): Map<string, PortClaim> {
  const out = new Map<string, PortClaim>();
  if (port === '') return out;
  for (const b of bindings) {
    if (b.port !== Number(port)) continue;
    if (b.transport !== undefined && b.transport !== transport) continue;
    const claimant = hosts.find((h) => h.bindingId === b.id);
    if (!claimant || claimant.id === selfHostId) continue;
    out.set(b.nodeId, { host: claimant.remark, label: b.transport ? `${b.port}/${b.transport}` : `${b.port}` });
  }
  return out;
}
