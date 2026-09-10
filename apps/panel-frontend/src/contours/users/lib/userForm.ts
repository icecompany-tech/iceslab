import type { TrafficLimitStrategy, User } from '@/lib/domain/users';
import { MIST, MONO } from '@/contours/users/lib/colors';
export const LABEL = {
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: MIST,
  lineHeight: '12px',
};

export const GiB = 1_073_741_824;

export const STRATEGY_VALUES: TrafficLimitStrategy[] = ['no_reset', 'day', 'week', 'month', 'rolling'];

/**
 * Quick presets. Stored per browser rather than in the database: they are a
 * personal shortcut, the panel has no template table, and inventing one would
 * mean a migration for what is today one operator's muscle memory. Moving them
 * server-side later is additive.
 */

export interface FormValues {
  username: string;
  subscriptionToken: string;
  trafficLimitGb: number | '';
  trafficLimitStrategy: TrafficLimitStrategy;
  expireDays: number | '';
  /**
   * Whether this session actually chose an expiry. An edit that never touched
   * the field must send no date at all: restating one would recompute "now +
   * 30 days" on every save and walk the expiry forward a month at a time.
   */
  expirySet: boolean;
  status: 'active' | 'disabled';
  description: string;
  tag: string;
  email: string;
  telegramId: string;
  hwidDeviceLimit: number | '';
  groupIds: string[];
  routingPreset: string;
}

export function defaultValues(user: User | null): FormValues {
  return {
    username: user?.username ?? '',
    subscriptionToken: '',
    trafficLimitGb: user?.trafficLimitBytes != null ? Math.round(user.trafficLimitBytes / GiB) : '',
    trafficLimitStrategy: user?.trafficLimitStrategy ?? 'no_reset',
    expireDays: '',
    expirySet: false,
    // limited/expired are cron-managed and rejected by UpdateUserSchema, so an
    // edit can only set active or disabled. Saving a limited user reactivates
    // them; the review cron re-limits if they are still over quota.
    status: user?.status === 'disabled' ? 'disabled' : 'active',
    description: user?.description ?? '',
    tag: user?.tag ?? '',
    email: user?.email ?? '',
    telegramId: user?.telegramId ?? '',
    hwidDeviceLimit: user?.hwidDeviceLimit ?? '',
    groupIds: user?.groupIds ?? [],
    routingPreset: user?.routingPreset ?? '',
  };
}
