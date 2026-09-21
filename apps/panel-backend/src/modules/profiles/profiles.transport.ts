import { transportOf, type ProtocolName, type Transport } from '@iceslab/shared';

/**
 * Which socket a binding of this profile occupies on its node.
 *
 * Derived, never asked of the operator, and stored on the row because a unique
 * index cannot reach into `profiles` to find the protocol.
 *
 * The per-binding overrides are merged over the profile config first, for the
 * same reason they are merged everywhere else: a binding may pin a different
 * `network`, and it is the merged value that the node ends up listening with.
 * Reading the profile alone would file such a binding under the wrong socket,
 * which is the exact failure this column exists to prevent.
 */
export function transportForBinding(
  profile: { protocol: string; config: unknown },
  overrides?: unknown,
): Transport {
  const base = (profile.config ?? {}) as Record<string, unknown>;
  const over = (overrides ?? {}) as Record<string, unknown>;
  const merged = { ...base, ...over } as { network?: string };
  return transportOf(profile.protocol as ProtocolName, merged);
}
