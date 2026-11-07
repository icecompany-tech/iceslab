import { useState } from 'react';
import { getProfileKeyImpact, type ProfileKeyImpact } from '@/lib/old/profiles';
import { useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * What a new key pair would cost, as the server counts it (A-225).
 *
 * The key is shared by every node of every host on the profile, so a new pair
 * is a fleet-wide event with no undo. The count used to be made here from the
 * host and binding lists, and a failed or unanswered list read as «0 hosts, 0
 * nodes», which let the key change on a deployed profile with no question
 * asked. Now the server's own count (GET /api/profiles/:id/key-impact) is the
 * only source, and not knowing it is a state of its own.
 *
 *   none     a profile not saved yet: there is nothing to break;
 *   loading  no answer yet: the button waits;
 *   failed   no count: the window still opens, with words saying so;
 *   ready    the counts.
 */
export type GenerateImpact =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | ({ kind: 'ready' } & ProfileKeyImpact);

export function useGenerateImpact(profileId: string | null): GenerateImpact {
  const query = useQuery({
    queryKey: keyImpactKey(profileId),
    queryFn: () => getProfileKeyImpact(profileId!),
    enabled: profileId !== null,
    staleTime: 30_000,
  });
  if (profileId === null) return { kind: 'none' };
  if (query.data) return { kind: 'ready', ...query.data };
  if (query.isError) return { kind: 'failed' };
  return { kind: 'loading' };
}

/** The cache address of a profile's key impact; the deploy window resets it. */
export function keyImpactKey(profileId: string | null) {
  return ['profile-key-impact', profileId] as const;
}

/**
 * The press of Generate decides on a FRESH count, never on the cached one
 * (A-225 tail): the warning above the button is a cached read, and a profile
 * deployed on the same page, a host edited elsewhere or another admin's change
 * would leave «0/0/0/0» there and let the key change with no question asked.
 * `fetchFresh` asks the server now; its failure is «unknown», which still asks.
 */
export async function pressGenerate(
  fetchFresh: () => Promise<ProfileKeyImpact>,
  decide: (impact: GenerateImpact) => void,
): Promise<void> {
  let fresh: GenerateImpact;
  try {
    fresh = { kind: 'ready', ...(await fetchFresh()) };
  } catch {
    fresh = { kind: 'failed' };
  }
  decide(fresh);
}

/**
 * The cached count for the warning, and the press that asks the server again.
 * `checking` keeps the button waiting while the fresh count is on its way.
 */
export function useGenerateGate(profileId: string | null): {
  impact: GenerateImpact;
  checking: boolean;
  press: (decide: (impact: GenerateImpact) => void) => void;
} {
  const qc = useQueryClient();
  const impact = useGenerateImpact(profileId);
  const [checking, setChecking] = useState(false);
  const press = (decide: (impact: GenerateImpact) => void) => {
    if (profileId === null) {
      decide({ kind: 'none' });
      return;
    }
    setChecking(true);
    void pressGenerate(
      () => qc.fetchQuery({ queryKey: keyImpactKey(profileId), queryFn: () => getProfileKeyImpact(profileId), staleTime: 0 }),
      decide,
    ).finally(() => setChecking(false));
  };
  return { impact, checking, press };
}

/**
 * What pressing Generate does:
 *   wait     the count has not answered: nothing happens yet;
 *   run      nothing to break (a new profile, or the server counts zero
 *            everywhere): the pair is generated straight away;
 *   confirm  the window with the server's numbers;
 *   unknown  the window without numbers, saying the cost is not known.
 */
export type GenerateStep = 'wait' | 'run' | 'confirm' | 'unknown';

export function generateStep(impact: GenerateImpact): GenerateStep {
  switch (impact.kind) {
    case 'none':
      return 'run';
    case 'loading':
      return 'wait';
    case 'failed':
      return 'unknown';
    case 'ready':
      return impact.hosts === 0 && impact.nodes === 0 && impact.bindings === 0 && impact.configs === 0
        ? 'run'
        : 'confirm';
  }
}

/** The warning above the button: shown when there is a cost, or when it is unknown. */
export function showGenerateWarning(impact: GenerateImpact): boolean {
  const step = generateStep(impact);
  return step === 'confirm' || step === 'unknown';
}
