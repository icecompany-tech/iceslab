import { lazy, type ReactNode } from 'react'

const Provider = lazy(() => import('react-aria-components').then((m) => ({ default: m.I18nProvider })))

export function I18nProvider({ locale, children }: { locale: string; children: ReactNode }) {
  return <Provider locale={locale}>{children}</Provider>
}
