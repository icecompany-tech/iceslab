import { cascadeShapeError, nodeInOtherCascadeRefusal, type NodeInOtherCascade } from '@/lib/old/cascades'
import { entryPolicyRefusal, refusedCells, refusedDirection, refusedEntryChain, refusedEntryChange, refusedEntryNodes, refusedLinkPorts, refusedPositionMoved, refusedUnderlay, type CellRefusal, type DirectionRefusal, type EntryChainConflict, type EntryChangeRefusal, type EntryNodesDropped, type LinkPortConflict } from '@/contours/cascades/lib/cascadeForm'

/** 409 DIRECTION_TAGS_EXHAUSTED: this cascade has spent its tags, they never come back (F-6). */
export function refusedTags(err: unknown): { needed: number; available: number } | null {
  if (!err || typeof err !== 'object') return null
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response
  if (!res || res.status !== 409 || !res.data || typeof res.data !== 'object') return null
  const d = res.data as { error?: unknown; needed?: unknown; available?: unknown }
  if (d.error !== 'DIRECTION_TAGS_EXHAUSTED' || typeof d.needed !== 'number' || typeof d.available !== 'number') return null
  return { needed: d.needed, available: d.available }
}

export type SaveRefusal =
  | { kind: 'entryChain'; conflicts: EntryChainConflict[] }
  | { kind: 'direction'; refusal: DirectionRefusal }
  | { kind: 'entryChange'; asked: EntryChangeRefusal }
  | { kind: 'entryNodes'; groups: EntryNodesDropped[] }
  | { kind: 'cells'; cells: CellRefusal[] }
  | { kind: 'ports'; ports: LinkPortConflict[] }
  | { kind: 'underlay'; names: string[] }
  | { kind: 'policyGone' }
  | { kind: 'moved'; position: number; stored: number }
  | { kind: 'otherCascade'; taken: NodeInOtherCascade }
  | { kind: 'tags'; needed: number; available: number }
  | { kind: 'shape'; message: string }

/** In the server's order: after a consent the next question is a legal next step, not an error. */
export function readRefusal(err: unknown): SaveRefusal | null {
  const conflicts = refusedEntryChain(err)
  if (conflicts) return { kind: 'entryChain', conflicts }
  const direction = refusedDirection(err)
  if (direction) return { kind: 'direction', refusal: direction }
  const asked = refusedEntryChange(err)
  if (asked) return { kind: 'entryChange', asked }
  const groups = refusedEntryNodes(err)
  if (groups) return { kind: 'entryNodes', groups }
  const cells = refusedCells(err)
  if (cells) return { kind: 'cells', cells }
  const ports = refusedLinkPorts(err)
  if (ports) return { kind: 'ports', ports }
  const names = refusedUnderlay(err)
  if (names) return { kind: 'underlay', names }
  if (entryPolicyRefusal(err)) return { kind: 'policyGone' }
  const moved = refusedPositionMoved(err)
  if (moved) return { kind: 'moved', ...moved }
  const taken = nodeInOtherCascadeRefusal(err)
  if (taken) return { kind: 'otherCascade', taken }
  const tags = refusedTags(err)
  if (tags) return { kind: 'tags', ...tags }
  const message = cascadeShapeError(err)
  return message ? { kind: 'shape', message } : null
}

/** How many things the top line counts: each named place is one refusal to walk to. */
export function refusalCount(r: SaveRefusal): number {
  switch (r.kind) {
    case 'entryChain':
      return r.conflicts.length
    case 'cells':
      return r.cells.length
    case 'ports':
      return r.ports.length
    case 'underlay':
      return Math.max(r.names.length, 1)
    case 'direction':
      return r.refusal.kind === 'needsChain' ? r.refusal.conflicts.length : 1
    case 'entryChange':
    case 'entryNodes':
    case 'policyGone':
    case 'moved':
    case 'otherCascade':
    case 'tags':
    case 'shape':
      return 1
  }
}
