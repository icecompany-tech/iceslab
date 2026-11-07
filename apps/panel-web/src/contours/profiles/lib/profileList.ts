/**
 * On how many nodes a profile stands, for its card and the delete window
 * (A-226).
 *
 * The node count from the binding list (nodesByProfile) is the fresh answer;
 * when the list did not arrive (or is still on its way) the profile's own
 * `bindingCount` from the server stands in. It used to be 0 there, and the
 * delete window said «not bound anywhere, safe» over a failed request for a
 * profile deployed on several nodes.
 *
 * A-259: a profile stands on a node once per port, so the stand-in counts
 * bindings and may say more nodes than there are, never fewer: the delete
 * window errs on «careful».
 */
export function profileBindings(
  profile: { id: string; bindingCount: number },
  byProfile: ReadonlyMap<string, number>,
  listArrived: boolean,
): number {
  return listArrived ? (byProfile.get(profile.id) ?? 0) : profile.bindingCount;
}
