import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root')

// The old panel kept the session token here (lib/auth/session.ts of panel-frontend). The
// new one signs in by the httpOnly cookie alone, F-14: a copy left behind is removed.
try {
  localStorage.removeItem('iceslab-auth')
} catch {
  // Storage is blocked, so nothing could have been read from it either.
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
