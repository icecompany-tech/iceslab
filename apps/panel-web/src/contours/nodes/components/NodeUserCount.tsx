import { useCallback, useState } from 'react'
import { DICT } from '@/contours/nodes/dict'
import { useLastNodeCount, userCountForbidden } from '@/lib/domain/nodeUsers'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'

export function NodeUserCount({ id }: { id: string }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const observe = useCallback((el: HTMLSpanElement | null) => {
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const count = useLastNodeCount(id, visible)
  const title = count.isError ? (userCountForbidden(count.error) ? words.usersForbidden : words.usersFailed) : words.lastNodeUsers
  return <span ref={observe} title={title} aria-label={count.isError ? title : undefined}>
    {count.isError ? '—' : count.data === undefined ? '…' : fmtNumber(count.data, locale)}
  </span>
}
