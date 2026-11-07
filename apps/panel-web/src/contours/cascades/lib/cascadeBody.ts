import { entryPolicyPatch, entryPolicyPlace, toDirectionInputs, toPositionInputs, withEntryConfirm } from '@/contours/cascades/lib/cascadeForm'
import type { CascadeDraft } from '@/contours/cascades/lib/draft'
import type { CreateCascadeV4Input, UpdateCascadeV4Input } from '@/lib/old/cascades'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Only what the operator changed goes out (F-K3). The server takes positions and directions
 * together or not at all, so a change in either sends both lists whole; a leg nobody touched
 * stays absent inside them and the server keeps it.
 */
export function cascadeUpdateBody(stored: CascadeDraft, draft: CascadeDraft, confirmed = false): UpdateCascadeV4Input {
  const positions = toPositionInputs(draft.pools)
  const directions = toDirectionInputs(draft.directions)
  const pathChanged = !same(positions, toPositionInputs(stored.pools)) || !same(directions, toDirectionInputs(stored.directions))
  const body: UpdateCascadeV4Input = {
    ...(draft.name.trim() !== stored.name ? { name: draft.name.trim() } : {}),
    ...(draft.enabled !== stored.enabled ? { enabled: draft.enabled } : {}),
    ...(draft.hideHops !== stored.hideHops ? { hideHopsFromSub: draft.hideHops } : {}),
    ...(draft.autoProfile !== stored.autoProfile ? { autoProfile: draft.autoProfile } : {}),
    ...(pathChanged ? { positions, directions } : {}),
    ...entryPolicyPatch(draft.entryPolicyId, stored.entryPolicyId),
  }
  return withEntryConfirm(body, confirmed)
}

export const isUntouched = (body: UpdateCascadeV4Input) => Object.keys(body).length === 0

export function cascadeCreateBody(draft: CascadeDraft): CreateCascadeV4Input {
  const policy = draft.entryPolicyId && entryPolicyPlace(draft.pools[0]?.entryProtocol, true) === 'select' ? { entryPolicyId: draft.entryPolicyId } : {}
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    hideHopsFromSub: draft.hideHops,
    positions: toPositionInputs(draft.pools),
    directions: toDirectionInputs(draft.directions),
    ...policy,
  }
}
