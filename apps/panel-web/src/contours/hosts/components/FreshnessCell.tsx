import { useState } from 'react'
import styles from '@/contours/hosts/components/hosts.module.css'
import { DICT } from '@/contours/hosts/dict'
import { useFreshness } from '@/contours/hosts/hooks/useHosts'
import { fmtDateTime, fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { Button } from '@/ui/Button/Button'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Meter } from '@/ui/Meter/Meter'

/** Asked only while the column is on: on ten rows it is ten requests (design 06.11). */
export function FreshnessCell({ id, name }: { id: string; name: string }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const fresh = useFreshness(id, true)
  const [open, setOpen] = useState(false)
  if (fresh.isError) return <span className={styles.muted}>{words.unknown}</span>
  if (!fresh.data) return <span className={styles.muted}>…</span>
  const { stale, total, current, neverFetched, configChangedAt, retentionDays } = fresh.data
  if (stale === 0) return <span className={styles.muted}>-</span>
  return (
    <>
      <button
        type="button"
        className={styles.staleButton}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        {words.staleOf(fmtNumber(stale, locale), fmtNumber(total, locale))}
      </button>
      {open && (
        <Dialog title={`${words.freshTitle}: ${name}`} closeLabel={words.close} onClose={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>{words.close}</Button>}>
          <p>{words.freshLead(fmtDateTime(configChangedAt, locale))}</p>
          <p>
            {words.freshCurrent}: {fmtNumber(current, locale)} / {fmtNumber(total, locale)}
          </p>
          <Meter percent={total > 0 ? (current / total) * 100 : 0} />
          <p className={styles.amber}>
            {words.freshStale}: {fmtNumber(stale, locale)}
          </p>
          <p className={styles.amber}>
            {words.freshNever}: {fmtNumber(neverFetched, locale)}
          </p>
          <p className={styles.note}>{words.freshRetention(retentionDays)}</p>
        </Dialog>
      )}
    </>
  )
}
