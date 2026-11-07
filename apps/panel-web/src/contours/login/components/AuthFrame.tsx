import type { ReactNode } from 'react'
import styles from '@/contours/login/components/AuthFrame.module.css'
import { DICT } from '@/contours/login/dict'
import { useBrandName } from '@/lib/domain/brand'
import { isLocale, useDict, useLocale } from '@/lib/i18n'
import { Select } from '@/ui/Select/Select'

const LANGUAGES = [
  { value: 'ru', label: 'RU' },
  { value: 'en', label: 'EN' },
]

export function AuthFrame({ children }: { children: ReactNode }) {
  const brand = useBrandName()
  const words = useDict(DICT)
  const { locale, setLocale } = useLocale()
  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <svg className={styles.mark} viewBox="0 0 22 22" aria-hidden="true">
            <rect x="2" y="2" width="18" height="18" rx="5" className={styles.markEdge} />
            <rect x="7" y="7" width="8" height="8" rx="2" className={styles.markCore} />
          </svg>
          <span className={styles.brandName}>{brand}</span>
        </div>
        <Select
          look="chip"
          aria-label={words.language}
          options={LANGUAGES}
          value={locale}
          onChange={(e) => {
            if (isLocale(e.target.value)) setLocale(e.target.value)
          }}
        />
      </header>
      <main className={styles.center}>{children}</main>
    </div>
  )
}
