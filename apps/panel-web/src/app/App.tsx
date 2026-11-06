import { lazy, Suspense } from 'react'
import '@/ui/tokens.css'
import '@/ui/base.css'

// Lazy from the first page: react-aria-components with these two widgets is about 90 KB
// gzip on top of 67 for React and the entry budget is 120, so what uses it stays out.
const TrialPage = lazy(() => import('@/app/TrialPage'))

export function App() {
  return (
    <Suspense>
      <TrialPage />
    </Suspense>
  )
}
