import { describe, expect, it } from 'vitest'
import { fmtBinaryParts, fmtBytes, fmtBytesLarge, fmtDuration } from '@/lib/format'

const GiB = 1024 ** 3
const nbsp = (s: string) => s.replaceAll(String.fromCharCode(160), ' ')

describe('format', () => {
  it('writes traffic as the frames do', () => {
    expect(fmtBytes(48 * GiB, 'ru')).toBe('48 ГБ')
    expect(fmtBytes(1.1 * GiB, 'ru')).toBe('1,1 ГБ')
    expect(fmtBytes(0, 'ru')).toBe('0 Б')
    expect(fmtBytes(48 * GiB, 'en')).toBe('48 GB')
  })

  it('the big number has three significant digits', () => {
    expect(fmtBytesLarge(3.2 * 1024 * GiB, 'ru')).toBe('3,20 ТБ')
    expect(nbsp(fmtBytesLarge(107 * GiB, 'ru'))).toBe('107 ГБ')
  })

  it('memory is binary, value and unit apart', () => {
    expect(fmtBinaryParts(1.1 * GiB, 'ru')).toEqual({ value: '1,1', unit: 'ГиБ' })
  })

  it('a negative count is not a negative traffic', () => {
    expect(fmtBytes(-5, 'ru')).toBe('0 Б')
  })

  it('reads a duration down to its largest two parts', () => {
    expect(fmtDuration(14 * 86400 + 3 * 3600, 'ru')).toBe('14 дн 3 ч')
    expect(fmtDuration(90, 'ru')).toBe('1 мин')
    expect(fmtDuration(12, 'en')).toBe('12 s')
  })
})
