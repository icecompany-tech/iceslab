import { Suspense, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { routeAt } from '@/app/contours'
import styles from '@/app/shell/Shell.module.css'
import { Sidebar } from '@/app/shell/Sidebar'
import { Topbar } from '@/app/shell/Topbar'
import { useDict, useLocale } from '@/lib/i18n'
import { Icon } from '@/ui/Icon/Icon'

const DICT = {
  ru: { openPanel: 'Открыть правую панель', closePanel: 'Закрыть правую панель', panel: 'Правая панель' },
  en: { openPanel: 'Open the right panel', closePanel: 'Close the right panel', panel: 'Right panel' },
}

export function Shell() {
  const [panelOpen, setPanelOpen] = useState(false)
  const { pathname } = useLocation()
  const { locale } = useLocale()
  const words = useDict(DICT)
  const title = routeAt(pathname)?.title?.[locale] ?? ''
  // Reset the center on navigation while keeping the menu at its current scroll position.
  const main = useRef<HTMLElement>(null)
  useEffect(() => {
    main.current?.scrollTo?.({ top: 0 })
  }, [pathname])
  // The open panel closes by Esc, by a press outside it and by its button (owner 10.11).
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!panelOpen) return
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) setPanelOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setPanelOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [panelOpen])

  return (
    <div className={styles.shell}>
      <Topbar title={title} />
      <div className={styles.body}>
        <Sidebar />
        <main ref={main} className={styles.main}>
          <div className={`${styles.center} ${routeAt(pathname)?.wide ? styles.wide : ''}`}>
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
          <aside ref={panel} className={styles.panel} aria-label={words.panel}>
            <button type="button" className={styles.railButton} aria-label={words.closePanel} autoFocus onClick={() => setPanelOpen(false)}>
              <Icon name="panelClose" size="xl" />
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}
