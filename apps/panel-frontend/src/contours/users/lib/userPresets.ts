import type { TrafficLimitStrategy } from '@/lib/domain/users';
export interface Preset {
  id: string;
  name: string;
  trafficGb: number | null;
  expireDays: number | null;
  strategy: TrafficLimitStrategy;
}

export const PRESET_STORAGE_KEY = 'iceslab:user-presets';

export const DEFAULT_PRESETS: Preset[] = [
  { id: 'basic', name: 'basic', trafficGb: 50, expireDays: 30, strategy: 'month' },
  { id: 'premium', name: 'premium', trafficGb: null, expireDays: 90, strategy: 'no_reset' },
  { id: 'trial', name: 'trial', trafficGb: 5, expireDays: 7, strategy: 'no_reset' },
];

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return DEFAULT_PRESETS;
    const parsed = JSON.parse(raw) as Preset[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_PRESETS;
  } catch {
    return DEFAULT_PRESETS;
  }
}
