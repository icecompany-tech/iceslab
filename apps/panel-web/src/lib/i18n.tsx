// Each contour holds its own dictionary: `{ ru, en }`, with `en: typeof ru`, so a key one
// language lacks breaks the build (F-K8) and a screen's words load with the screen. No
// i18next: it would be most of what the entry budget has left after React.
import { createContext, useContext, useMemo, type ReactNode } from 'react'

export const LOCALES = ['ru', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const isLocale = (v: unknown): v is Locale => v === 'ru' || v === 'en'

interface LocaleState {
  locale: Locale
  setLocale: (next: Locale) => void
}

const LocaleContext = createContext<LocaleState>({ locale: 'ru', setLocale: () => {} })

export function LocaleProvider({ locale, setLocale, children }: LocaleState & { children: ReactNode }) {
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export const useLocale = () => useContext(LocaleContext)

export function useDict<T>(dict: Record<Locale, T>): T {
  return dict[useContext(LocaleContext).locale]
}

/** Russian has three plural forms, English two: `few` is read only where it exists. */
export function plural(locale: Locale, n: number, forms: { one: string; few?: string; many: string }): string {
  const rule = new Intl.PluralRules(locale).select(n)
  if (rule === 'one') return forms.one
  if (rule === 'few') return forms.few ?? forms.many
  return forms.many
}
