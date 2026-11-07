import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import styles from '@/app/shell/Topbar.module.css'
import { useNow } from '@/lib/clock'
import { useBrandName } from '@/lib/domain/brand'
import { fmtDuration } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { request } from '@/lib/net/client'
import { bool, nullable, num, obj, str } from '@/lib/net/parse'
import { Icon } from '@/ui/Icon/Icon'

const parseVersion = obj({ current: str, latest: nullable(str), updateAvailable: bool, releaseUrl: nullable(str), stars: nullable(num) })

const DICT = {
  ru: {
    checked: (ago: string) => `проверено ${ago} назад`,
    notChecked: 'ещё не проверено',
    refresh: 'Обновить данные экрана',
    serverVersion: (v: string) => `сервер v${v}`,
    update: (v: string) => `вышла ${v}`,
    updateTitle: 'Открыть заметки выпуска',
    docs: 'Документация',
    support: 'Поддержать',
  },
  en: {
    checked: (ago: string) => `checked ${ago} ago`,
    notChecked: 'not checked yet',
    refresh: 'Refresh this screen',
    serverVersion: (v: string) => `server v${v}`,
    update: (v: string) => `${v} is out`,
    updateTitle: 'Open the release notes',
    docs: 'Documentation',
    support: 'Support the project',
  },
}

const link = (value: string | undefined, fallback = '') => {
  const v = (value ?? fallback).trim()
  return v.startsWith('http') ? v : ''
}

// A blank link renders nothing: an install shows only the channels it has.
const GITHUB_URL = link(import.meta.env.VITE_GITHUB_URL, 'https://github.com/icecompany-tech/iceslab')
const TELEGRAM_URL = link(import.meta.env.VITE_TELEGRAM_URL)
const DISCORD_URL = link(import.meta.env.VITE_DISCORD_URL)
const DOCS_URL = link(import.meta.env.VITE_DOCS_URL)
const SUPPORT_URL = link(import.meta.env.VITE_SUPPORT_URL)

/** The newest answer among the queries this screen is showing. */
function useLastChecked(): number | null {
  const queryClient = useQueryClient()
  const now = useNow()
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  const times = queryClient
    .getQueryCache()
    .findAll({ type: 'active' })
    .map((q) => q.state.dataUpdatedAt)
    .filter((t) => t > 0)
  return times.length === 0 ? null : Math.max(0, (now() - Math.max(...times)) / 1000)
}

export function Topbar({ title }: { title: string }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const queryClient = useQueryClient()
  const brand = useBrandName()
  const ago = useLastChecked()
  const version = useQuery({ queryKey: ['system', 'version'], queryFn: () => request('/api/system/version', parseVersion), staleTime: 3_600_000 })
  const stars = version.data?.stars

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <div className={styles.brand}>
          <svg className={styles.mark} viewBox="0 0 22 22" aria-hidden="true">
            <rect x="2" y="2" width="18" height="18" rx="5" className={styles.markEdge} />
            <rect x="7" y="7" width="8" height="8" rx="2" className={styles.markCore} />
          </svg>
          <span className={styles.brandName}>{brand}</span>
        </div>
        <span className={styles.divider} />
        <span className={styles.title}>{title}</span>
        <span className={styles.checked}>
          {ago === null ? words.notChecked : words.checked(fmtDuration(ago, locale))}
          <button type="button" className={styles.refresh} aria-label={words.refresh} onClick={() => void queryClient.refetchQueries({ type: 'active' })}>
            <Icon name="refresh" />
          </button>
        </span>
      </div>
      <div className={styles.right}>
        <span className={styles.chip}>
          <span className={styles.version}>v{__APP_VERSION__}</span>
        </span>
        {/* F-7: the served build and the server can differ after a half-done update. */}
        {version.data && version.data.current !== __APP_VERSION__ && <span className={`${styles.chip} ${styles.update}`}>{words.serverVersion(version.data.current)}</span>}
        {version.data?.updateAvailable && version.data.latest && version.data.releaseUrl && (
          <a className={`${styles.chip} ${styles.update}`} href={version.data.releaseUrl} target="_blank" rel="noreferrer" title={words.updateTitle}>
            {words.update(version.data.latest)}
          </a>
        )}
        <span className={styles.divider} />
        <div className={styles.links}>
          {TELEGRAM_URL && (
            <a className={`${styles.chip} ${styles.square} ${styles.telegram}`} href={TELEGRAM_URL} target="_blank" rel="noreferrer" aria-label="Telegram">
              <Icon name="telegram" size="xl" />
            </a>
          )}
          {DISCORD_URL && (
            <a className={`${styles.chip} ${styles.square} ${styles.discord}`} href={DISCORD_URL} target="_blank" rel="noreferrer" aria-label="Discord">
              <Icon name="discord" size="xl" />
            </a>
          )}
          {GITHUB_URL && (
            <a className={`${styles.chip} ${styles.github}`} href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub">
              <Icon name="github" />
              {typeof stars === 'number' && (
                <span className={styles.stars}>
                  <Icon name="star" size="sm" />
                  {stars}
                </span>
              )}
            </a>
          )}
          {DOCS_URL && (
            <a className={`${styles.chip} ${styles.square} ${styles.docs}`} href={DOCS_URL} target="_blank" rel="noreferrer" aria-label={words.docs}>
              <Icon name="book" size="xl" />
            </a>
          )}
          {SUPPORT_URL && (
            <a className={`${styles.chip} ${styles.support}`} href={SUPPORT_URL} target="_blank" rel="noreferrer">
              <span className={styles.heart}>
                <Icon name="heart" />
              </span>
              {words.support}
            </a>
          )}
        </div>
      </div>
    </header>
  )
}
