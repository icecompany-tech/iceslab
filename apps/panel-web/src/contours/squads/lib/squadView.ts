import { loadView } from '@/lib/old/loadView';

type Q = { data: unknown; isError: boolean };

/**
 * The state of one section of the squad page (A-239): profiles, hosts,
 * cascades and policies each wait for the lists they are drawn from. «None»
 * is said only when every list arrived and the section is empty; a list that
 * failed is said in the section with its index, so the retry asks that one.
 * It used to read «no profiles», «no hosts» over a list that never came.
 */
export type SectionState = { kind: 'loading' } | { kind: 'failed'; index: number } | { kind: 'empty' } | { kind: 'list' };

export function sectionState(lists: readonly Q[], count: number): SectionState {
  const failed = lists.findIndex((q) => loadView(q) === 'failed');
  if (failed !== -1) return { kind: 'failed', index: failed };
  if (lists.some((q) => loadView(q) === 'loading')) return { kind: 'loading' };
  return count === 0 ? { kind: 'empty' } : { kind: 'list' };
}

/**
 * The countries a squad card names (A-239, b), or null when they cannot be
 * known: they come from the binding and node lists, and without both of them
 * «nothing granted» would be a claim about the squad.
 */
export function cardCountries(countries: readonly string[], bindings: Q, nodes: Q): readonly string[] | null {
  return loadView(bindings) === 'ready' && loadView(nodes) === 'ready' ? countries : null;
}
