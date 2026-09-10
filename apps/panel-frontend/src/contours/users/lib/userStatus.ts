import { isOnlineAt } from '@iceslab/shared';
import type { User } from '@/lib/domain/users';
import { AMBER, MIST, MOSS, RED } from '@/contours/users/lib/colors';
export type ComputedStatus = 'online' | 'offline' | 'limited' | 'expired' | 'disabled';

export function computedStatus(u: User): ComputedStatus {
  if (u.status === 'expired') return 'expired';
  if (u.status === 'limited') return 'limited';
  if (u.status === 'disabled') return 'disabled';
  return isOnlineAt(u.lastOnlineAt, Date.now()) ? 'online' : 'offline';
}

export const COMPUTED_STATUS_ACCENT: Record<ComputedStatus, string> = {
  online: MOSS,
  // Dim, not another alarm colour: being away is the ordinary state of a
  // working account, not something to act on.
  offline: MIST,
  limited: AMBER,
  expired: RED,
  disabled: MIST,
};

export type StatusFilter = 'all' | 'active' | 'expired' | 'limited' | 'disabled';
