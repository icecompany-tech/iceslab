import { ENGINE_NAMES, type EngineName } from '@iceslab/shared'

// A new engine in the contract breaks the build here until it has a name and a place.
const LABEL: Record<EngineName, string> = {
  xray: 'xray',
  singbox: 'sing-box',
  amneziawg: 'awg',
  hysteria: 'hy2',
  naive: 'naive',
  mieru: 'mieru',
  mtproto: 'mtproto',
}

// The order of the frames (design 2026-11-04), not the order of the contract.
const ORDER: readonly EngineName[] = ['xray', 'singbox', 'amneziawg', 'hysteria', 'naive', 'mieru', 'mtproto']

export const isEngine = (name: string): name is EngineName => (ENGINE_NAMES as readonly string[]).includes(name)

/** A name this panel does not know yet is shown as the server wrote it, last. */
export const engineLabel = (name: string) => (isEngine(name) ? LABEL[name] : name)

export function sortEngines(names: readonly string[]): string[] {
  const place = (name: string) => (isEngine(name) ? ORDER.indexOf(name) : ORDER.length)
  return [...names].sort((a, b) => place(a) - place(b))
}
