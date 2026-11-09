import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESETS, withPreset } from '@/contours/users/lib/presets'

describe('withPreset', () => {
  it('a new name joins the list at the end', () => {
    const { list, saved } = withPreset(DEFAULT_PRESETS, { name: ' family ', trafficGb: 100, expireDays: 30, strategy: 'month' })
    expect(list).toHaveLength(DEFAULT_PRESETS.length + 1)
    expect(list.at(-1)).toEqual(saved)
    expect(saved.name).toBe('family')
  })

  it('a taken name replaces that preset and keeps its id, so the list never shows two the same', () => {
    const { list, saved } = withPreset(DEFAULT_PRESETS, { name: 'trial', trafficGb: 10, expireDays: 3, strategy: 'no_reset' })
    expect(list).toHaveLength(DEFAULT_PRESETS.length)
    expect(saved.id).toBe('trial')
    expect(list.find((p) => p.id === 'trial')?.trafficGb).toBe(10)
  })

  it('the defaults are not changed in place', () => {
    withPreset(DEFAULT_PRESETS, { name: 'trial', trafficGb: 1, expireDays: 1, strategy: 'no_reset' })
    expect(DEFAULT_PRESETS.find((p) => p.id === 'trial')?.trafficGb).toBe(5)
  })
})
