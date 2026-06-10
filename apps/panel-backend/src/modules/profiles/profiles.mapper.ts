import type {
  Profile,
  ProfileNodeBinding,
} from '../../generated/prisma/client.js';

export interface PublicProfileDto {
  id: string;
  name: string;
  protocol: string;
  description: string | null;
  config: unknown;
  enabled: boolean;
  /** Number of node bindings active for this profile. */
  bindingCount: number;
  /** Distinct users who can reach this profile via squad ACL (deduped across
   *  every squad the profile is assigned to, including the system "All" squad). */
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicBindingDto {
  id: string;
  profileId: string;
  nodeId: string;
  port: number;
  publicHost: string | null;
  publicPort: number | null;
  overrides: unknown | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function mapProfile(
  profile: Profile & { _count?: { bindings: number }; bindings?: ProfileNodeBinding[] },
  userCount = 0,
): PublicProfileDto {
  const bindingCount =
    profile._count?.bindings ?? profile.bindings?.length ?? 0;
  return {
    id: profile.id,
    name: profile.name,
    protocol: profile.protocol,
    description: profile.description,
    config: profile.config,
    enabled: profile.enabled,
    bindingCount,
    userCount,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function mapBinding(binding: ProfileNodeBinding): PublicBindingDto {
  return {
    id: binding.id,
    profileId: binding.profileId,
    nodeId: binding.nodeId,
    port: binding.port,
    publicHost: binding.publicHost,
    publicPort: binding.publicPort,
    overrides: binding.overrides,
    enabled: binding.enabled,
    createdAt: binding.createdAt.toISOString(),
    updatedAt: binding.updatedAt.toISOString(),
  };
}
