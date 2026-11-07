import { lazy, Suspense } from 'react'
import type { DateTimeFieldProps } from '@/ui/DateTimeField/DateTimeField'
import { I18nProvider } from '@/ui/DateTimeField/locale'

const Loaded = lazy(() => import('@/ui/DateTimeField/DateTimeField').then((m) => ({ default: m.DateTimeField })))

/** The calendar and the headless library load with the first field, not with the screen. */
export function LazyDateTimeField({ locale, ...props }: DateTimeFieldProps & { locale: string }) {
  return (
    <Suspense>
      <I18nProvider locale={locale === 'ru' ? 'ru-RU' : 'en-US'}>
        <Loaded {...props} />
      </I18nProvider>
    </Suspense>
  )
}
