import { QueryClientProvider } from '@tanstack/react-query'
import { Suspense, useCallback, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ROUTES } from '@/app/contours'
import { createQueryClient } from '@/app/queryClient'
import { RequireSession } from '@/app/RequireSession'
import { Shell } from '@/app/shell/Shell'
import { ClockProvider } from '@/lib/clock'
import { isLocale, LocaleProvider, type Locale } from '@/lib/i18n'
import { ToastProvider } from '@/ui/Toast/Toast'
import '@/ui/tokens.css'
import '@/ui/base.css'

const LOCALE_KEY = 'iceslab-locale'

// A convenience: the screen must work with storage blocked, so every touch is guarded.
function storedLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    // Private window, or blocked site data.
  }
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

const queryClient = createQueryClient()
const now = () => Date.now()

export function App() {
  const [locale, setLocaleState] = useState<Locale>(storedLocale)
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    document.documentElement.lang = next
    try {
      localStorage.setItem(LOCALE_KEY, next)
    } catch {
      // Stays for this page's life.
    }
  }, [])

  const publicRoutes = ROUTES.filter((r) => r.public)
  const privateRoutes = ROUTES.filter((r) => !r.public)

  return (
    <ClockProvider value={now}>
      <LocaleProvider locale={locale} setLocale={setLocale}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider closeLabel={locale === 'ru' ? 'Закрыть' : 'Close'}>
            <BrowserRouter>
              <Suspense>
                <Routes>
                  {publicRoutes.map(({ path, Screen }) => (
                    <Route key={path} path={path} element={<Screen />} />
                  ))}
                  <Route element={<RequireSession />}>
                    <Route element={<Shell />}>
                      {privateRoutes.map(({ path, Screen }) => (
                        <Route key={path} path={path} element={<Screen />} />
                      ))}
                    </Route>
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </ToastProvider>
        </QueryClientProvider>
      </LocaleProvider>
    </ClockProvider>
  )
}
