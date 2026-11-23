import { describe, expect, it } from 'vitest'
import { defaults } from '../lib/profileDefaults'
import { printHysteria, readHysteria } from './hysteriaYaml'

const initial = { ...defaults(null), protocol: 'hysteria' as const, hyMasqueradeUrl: 'https://one.example', hyObfsPassword: 'synthetic-test', hyPortHopStart: 3000, hyPortHopEnd: 3010 }
describe('Hysteria YAML', () => {
  it('preserves a masked password, non-editor fields and a change of URL', () => {
    const text = printHysteria(initial)
    expect(text).not.toContain(initial.hyObfsPassword)
    expect(readHysteria(text.replace('one.example', 'two.example'), initial)).toEqual({ ...initial, hyMasqueradeUrl: 'https://two.example' })
  })
  it('round trips one-way and two-way limits', () => {
    for (const config of [{ ...initial, hyBrutalUp: 25 }, { ...initial, hyBrutalUp: 25, hyBrutalDown: 50 }]) {
      expect(readHysteria(printHysteria(config), config)).toEqual(config)
    }
  })
  it.each(['port: 100', 'bandwidth: [', 'bandwidth: {down: 0 mbps}', 'obfs: null','ignoreClientBandwidth: true\nignoreClientBandwidth: true','masquerade: {type: proxy, proxy: {url: file:///data}}'])('rejects an invalid document', text => {
    expect(() => readHysteria(text, initial)).toThrow()
  })
})
