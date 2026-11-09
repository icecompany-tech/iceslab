import { FLAGS } from '@/ui/Flag/flags'
import styles from '@/ui/Flag/Flag.module.css'

const CROSS_AT = 5

/** Drawn when the flag is stripes or a Nordic cross; any other country reads as its code. */
export function Flag({ code }: { code: string | null }) {
  if (!code) return <span className={styles.flag} aria-hidden="true" />
  const upper = code.toUpperCase()
  const flag = FLAGS[upper]
  if (!flag) return <span className={`${styles.flag} ${styles.code}`}>{upper}</span>
  const n = flag.colors.length
  return (
    <svg className={styles.flag} viewBox="0 0 18 13" preserveAspectRatio="none" role="img" aria-label={upper}>
      {flag.kind === 'kz' ? (
        <>
          <rect width="18" height="13" fill={flag.colors[0]} />
          <circle cx="10" cy="6.5" r="2.8" fill={flag.colors[1]} />
          <rect x="1.5" width="1.5" height="13" fill={flag.colors[1]} />
        </>
      ) : flag.kind === 'cross' ? (
        <>
          <rect width="18" height="13" fill={flag.colors[0]} />
          <rect x={CROSS_AT} width="3" height="13" fill={flag.colors[1]} />
          <rect y="5" width="18" height="3" fill={flag.colors[1]} />
        </>
      ) : (
        flag.colors.map((color, i) =>
          flag.kind === 'h' ? <rect key={i} y={(13 * i) / n} width="18" height={13 / n} fill={color} /> : <rect key={i} x={(18 * i) / n} width={18 / n} height="13" fill={color} />,
        )
      )}
    </svg>
  )
}
