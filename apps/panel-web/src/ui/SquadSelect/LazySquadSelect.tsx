import { lazy, Suspense } from 'react'
import { I18nProvider } from '@/ui/DateTimeField/locale'
import type { SquadSelectProps } from '@/ui/SquadSelect/SquadSelect'

const Loaded = lazy(() => import('@/ui/SquadSelect/SquadSelect').then((m) => ({ default: m.SquadSelect })))

export function LazySquadSelect({ locale, ...props }: SquadSelectProps & { locale: string }) {
  return (
    <Suspense>
      <I18nProvider locale={locale === 'ru' ? 'ru-RU' : 'en-US'}>
        <Loaded {...props} />
      </I18nProvider>
    </Suspense>
  )
}
