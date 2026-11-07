import { ENGINE_NAMES, type EngineName } from '@iceslab/shared';
import { engineCoreWord } from '@/lib/old/engines';
import type { ProfileNotOnNode } from '@/lib/old/hosts';

type T = (key: string, vars?: Record<string, unknown>) => string;

/** An engine the contract knows gets its word; one it does not, its name as sent. */
function engineName(e: string, t: T): string {
  return (ENGINE_NAMES as readonly string[]).includes(e) ? engineCoreWord(e as EngineName, t) : e;
}

/**
 * 409 PROFILE_DOES_NOT_RUN_ON_NODE in the panel's words (A-235): which node,
 * which core the profile needs, what the node reported, and whether waiting
 * helps. One function for the host page and the deploy window (A-246): the
 * same refusal is said the same way wherever a binding is written.
 */
export function profileNotOnNodeWords(r: ProfileNotOnNode, t: T): string {
  const reported = r.reportedEngines.length
    ? r.reportedEngines.map((e) => engineName(e, t)).join(', ')
    : t('hostEdit.notOnNodeNothing');
  const head = t('hostEdit.notOnNode', { node: r.nodeName, needed: engineName(r.neededEngine, t), reported });
  return r.canWait ? `${head} ${t('hostEdit.notOnNodeWait', { needed: engineName(r.neededEngine, t) })}` : head;
}
