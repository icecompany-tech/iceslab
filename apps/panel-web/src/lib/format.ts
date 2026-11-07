import type { Locale } from '@/lib/i18n'

const UNITS: Record<Locale, readonly string[]> = {
  ru: ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'],
  en: ['B', 'KB', 'MB', 'GB', 'TB', 'PB'],
}
const BINARY_UNITS: Record<Locale, readonly string[]> = {
  ru: ['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ', 'ПиБ'],
  en: ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'],
}

export const fmtNumber = (n: number, locale: Locale, digits = 0) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n)

function scale(bytes: number): { value: number; unit: number } {
  let value = Math.max(bytes, 0)
  let unit = 0
  while (value >= 1024 && unit < 5) {
    value /= 1024
    unit += 1
  }
  return { value, unit }
}

const digitsFor = (value: number, unit: number) => (unit === 0 || value >= 10 ? 0 : 1)

/** The panel counts in 1024 and writes "ГБ", as the old panel and the frames do. */
export function fmtBytes(bytes: number, locale: Locale): string {
  const { value, unit } = scale(bytes)
  return `${fmtNumber(value, locale, digitsFor(value, unit))} ${UNITS[locale][unit]}`
}

/** Three significant digits, for the one big number of a block: "3,20 ТБ". */
export function fmtBytesLarge(bytes: number, locale: Locale): string {
  const { value, unit } = scale(bytes)
  if (unit === 0) return fmtBytes(bytes, locale)
  const number = new Intl.NumberFormat(locale, { minimumSignificantDigits: 3, maximumSignificantDigits: 3 }).format(value)
  return `${number} ${UNITS[locale][unit]}`
}

/** Memory and disk are written as binary units on the frames, the value and the unit apart. */
export function fmtBinaryParts(bytes: number, locale: Locale): { value: string; unit: string } {
  const { value, unit } = scale(bytes)
  return { value: fmtNumber(value, locale, digitsFor(value, unit)), unit: BINARY_UNITS[locale][unit] ?? '' }
}

export const fmtPercent = (n: number, locale: Locale, digits = 0) => `${fmtNumber(n, locale, digits)}%`

const MINUTE = 60
const HOUR = 3600
const DAY = 86400

export function fmtDuration(seconds: number, locale: Locale): string {
  const words = locale === 'ru' ? { d: 'дн', h: 'ч', m: 'мин', s: 'сек' } : { d: 'd', h: 'h', m: 'min', s: 's' }
  if (seconds >= DAY) return `${Math.floor(seconds / DAY)} ${words.d} ${Math.floor((seconds % DAY) / HOUR)} ${words.h}`
  if (seconds >= HOUR) return `${Math.floor(seconds / HOUR)} ${words.h} ${Math.floor((seconds % HOUR) / MINUTE)} ${words.m}`
  if (seconds >= MINUTE) return `${Math.floor(seconds / MINUTE)} ${words.m}`
  return `${Math.max(Math.floor(seconds), 0)} ${words.s}`
}

/** One unit, for a column: 3 days, 2 hours, 5 minutes. */
export function fmtAge(seconds: number, locale: Locale): string {
  const words = locale === 'ru' ? { d: 'дн', h: 'ч', m: 'мин' } : { d: 'd', h: 'h', m: 'min' }
  if (seconds >= DAY) return `${Math.floor(seconds / DAY)} ${words.d}`
  if (seconds >= HOUR) return `${Math.floor(seconds / HOUR)} ${words.h}`
  return `${Math.max(Math.floor(seconds / MINUTE), 1)} ${words.m}`
}

export const fmtTime = (at: number, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(at)

export const fmtDateTime = (at: number | string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at))

export const fmtDate = (at: number | string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(at))
