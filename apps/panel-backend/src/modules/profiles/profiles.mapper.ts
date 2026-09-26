import type { EngineName, Transport } from '@iceslab/shared';
import type {
  Profile,
  ProfileNodeBinding,
} from '../../generated/prisma/client.js';
import { effectiveEngineOf } from '../nodes/node-engines.js';

export interface PublicProfileDto {
  id: string;
  name: string;
  protocol: string;
  /** Proxy core that renders this profile's inbound. NULL = native core;
   *  'singbox' = sing-box engine (engine-choice). This is the STORED value, the
   *  one the form edits. */
  engine: string | null;
  /** The core that will actually render it: the pinned one, or the protocol's
   *  native core. Never null.
   *
   *  Here so that nobody downstream has to resolve the null themselves. The
   *  protocol-to-native-core table exists in the agent and once in the panel;
   *  a third copy in the browser would drift from both without a sound. */
  effectiveEngine: EngineName;
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
  /**
   * Which socket `port` is on (E40). The server has counted a port as taken by
   * (port, transport) all along (hosts.service), and a screen that saw only the
   * port closed 443 to a hy2 host because a vless host sat on 443/tcp. Derived
   * from the protocol and, for xray, its network (kcp is udp); stored on the row.
   */
  transport: Transport;
  publicHost: string | null;
  publicPort: number | null;
  overrides: unknown | null;
  enabled: boolean;
  /**
   * Whether a core on this binding's NODE renders this binding's PROFILE.
   *
   * ⚠ ABSENT means the node has never reported its cores, which is NOT false.
   * Same contract as `provisioned` and `rendersPolicy`: claiming "this will not
   * come up" about a node that may well be running the core is the lie the
   * panel used to tell about the policy.
   *
   * ⚠ THIS FLAG MUST NEVER GATE A PUSH. Not applyInbounds, not a rebuild, not
   * an agent upgrade. It gates creating and editing the pair, and nothing else.
   * The day the fleet starts reporting cores, a batch of existing bindings will
   * turn false at once; if anything on the push path read this, that upgrade
   * would take those nodes down and it would look like the agent broke them.
   * It exists to be SHOWN, so an operator can decide.
   */
  rendersProfile?: boolean;
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
    engine: profile.engine,
    effectiveEngine: effectiveEngineOf(profile),
    description: profile.description,
    config: profile.config,
    enabled: profile.enabled,
    bindingCount,
    userCount,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function mapBinding(
  binding: ProfileNodeBinding,
  rendersProfile?: boolean,
): PublicBindingDto {
  return {
    id: binding.id,
    profileId: binding.profileId,
    nodeId: binding.nodeId,
    port: binding.port,
    // The column is VarChar(3), written only through transportOf; anything but
    // 'udp' is the tcp it has always been.
    transport: binding.transport === 'udp' ? 'udp' : 'tcp',
    publicHost: binding.publicHost,
    publicPort: binding.publicPort,
    overrides: binding.overrides,
    enabled: binding.enabled,
    ...(rendersProfile !== undefined ? { rendersProfile } : {}),
    createdAt: binding.createdAt.toISOString(),
    updatedAt: binding.updatedAt.toISOString(),
  };
}
