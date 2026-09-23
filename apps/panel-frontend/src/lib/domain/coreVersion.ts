import type { NodeCore } from '@/lib/domain/nodes';

/**
 * The version a core row may print, and only its own.
 *
 * Every core reports its version now (sing-box, hysteria, the AWG module, mtg,
 * mita, caddy, not only xray), each in its own `cores[].version`. The trap
 * this guards: `node.coreVersion` is xray's version (T7) and nobody else's, so
 * a row that fell back to it would print xray's number beside sing-box.
 *
 * `null` means print nothing: no field (an agent older than it), an empty
 * string, or a core whose binary is missing (`installed: false`), where a
 * version would claim a file that is not there.
 */
export function coreVersionOf(core: Pick<NodeCore, 'version' | 'installed'>): string | null {
  if (core.installed === false) return null;
  const v = core.version?.trim();
  return v ? v : null;
}
