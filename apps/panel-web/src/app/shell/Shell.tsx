import { Suspense, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { routeAt } from '@/app/contours'
import styles from '@/app/shell/Shell.module.css'
import { Sidebar } from '@/app/shell/Sidebar'
import { Topbar } from '@/app/shell/Topbar'
import { useDict, useLocale } from '@/lib/i18n'
import { Icon } from '@/ui/Icon/Icon'

const DICT = {
  ru: { openPanel: 'Открыть правую панель', closePanel: 'Закрыть правую панель' },
  en: { openPanel: 'Open the right panel', closePanel: 'Close the right panel' },
}

export function Shell() {
  const [panelOpen, setPanelOpen] = useState(false)
  const { pathname } = useLocation()
  const { locale } = useLocale()
  const words = useDict(DICT)
  const title = routeAt(pathname)?.title?.[locale] ?? ''

  return (
    <div className={styles.shell}>
      <Topbar title={title} />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.main}>
          <div className={styles.center}>
            <Suspense>
              <Outlet />
            </Suspense>
          </div>
        </main>
        <aside className={styles.rail}>
          <button type="button" className={styles.railButton} aria-label={words.openPanel} aria-expanded={panelOpen} onClick={() => setPanelOpen(true)}>
            <Icon name="panelOpen" size="xl" />
          </button>
        </aside>
        {/* Over the screen, the center does not narrow: owner 2026-11-05. Empty until the
            owner names its tasks. */}
        {panelOpen && (
          <aside className={styles.panel}>
            <button type="button" className={styles.railButton} aria-label={words.closePanel} autoFocus onClick={() => setPanelOpen(false)}>
              <Icon name="panelClose" size="xl" />
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}
