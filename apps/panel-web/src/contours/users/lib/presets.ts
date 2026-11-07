// Tariff presets are kept per browser in the old panel too: the server has no such thing.
import { arr, nullable, num, obj, str } from '@/lib/net/parse'
import { readStored } from '@/lib/storage'

const parsePreset = obj({ id: str, name: str, trafficGb: nullable(num), expireDays: nullable(num), strategy: str })

export type UserPreset = ReturnType<typeof parsePreset>

export const PRESET_KEY = 'iceslab:user-presets'

export const DEFAULT_PRESETS: readonly UserPreset[] = [
  { id: 'basic', name: 'basic', trafficGb: 50, expireDays: 30, strategy: 'month' },
  { id: 'premium', name: 'premium', trafficGb: null, expireDays: 90, strategy: 'no_reset' },
  { id: 'trial', name: 'trial', trafficGb: 5, expireDays: 7, strategy: 'no_reset' },
]

export function loadPresets(): readonly UserPreset[] {
  const stored = readStored(PRESET_KEY, arr(parsePreset))
  return stored && stored.length > 0 ? stored : DEFAULT_PRESETS
}
