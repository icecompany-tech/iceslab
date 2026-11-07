import { ENGINE_NAMES } from '@iceslab/shared'
import { describe, expect, it } from 'vitest'
import { engineLabel, sortEngines } from '@/lib/domain/engines'

describe('engines', () => {
  it('names every engine of the contract and places it', () => {
    for (const name of ENGINE_NAMES) expect(engineLabel(name)).not.toBe('')
    expect(sortEngines([...ENGINE_NAMES])).toHaveLength(ENGINE_NAMES.length)
  })

  it('sorts as the frames do and keeps an unknown name, last', () => {
    expect(sortEngines(['web', 'hysteria', 'singbox', 'xray'])).toEqual(['xray', 'singbox', 'hysteria', 'web'])
    expect(engineLabel('web')).toBe('web')
  })
})
