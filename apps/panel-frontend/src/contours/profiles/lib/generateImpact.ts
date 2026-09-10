import { listBindings } from '@/lib/domain/profiles';
import { listHosts } from '@/lib/domain/hosts';
import { useQuery } from '@tanstack/react-query';

export interface GenerateImpact {
  /** Hosts pointing at this profile. Every one of them hands out the key. */
  hosts: number;
  /** Nodes that have to be rebuilt and restarted once the key changes. */
  nodes: number;
  /**
   * Configs that stop working the moment it changes. Null because the panel
   * cannot count them: it would have to run the subscription pipeline for
   * every member of every squad that reaches this profile, and no endpoint
   * offers that number.
   */
  configs: number | null;
  loading: boolean;
}

/**
 * What a new key pair would cost.
 *
 * The key is shared by every node of every host on the profile, so regenerating
 * it is not a field edit: it is a fleet-wide event with no undo. Two of the
 * three numbers are honest counts the panel already holds; the third is named
 * and left empty rather than guessed.
 */
export function useGenerateImpact(profileId: string | null): GenerateImpact {
  const enabled = profileId !== null;

  const hostsQuery = useQuery({
    queryKey: ['hosts', { profileId }],
    queryFn: () => listHosts({ profileId: profileId! }),
    enabled,
    staleTime: 30_000,
  });

  const bindingsQuery = useQuery({
    queryKey: ['bindings', { profileId }],
    queryFn: () => listBindings({ profileId: profileId! }),
    enabled,
    staleTime: 30_000,
  });

  const bindings = bindingsQuery.data?.bindings ?? [];

  return {
    hosts: hostsQuery.data?.hosts.length ?? 0,
    // Distinct nodes: one node can carry several bindings of the same profile
    // on different ports, and it is still one rebuild.
    nodes: new Set(bindings.map((b) => b.nodeId)).size,
    configs: null,
    loading: hostsQuery.isLoading || bindingsQuery.isLoading,
  };
}
