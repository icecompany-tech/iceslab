import styles from '@/ui/HourBars/HourBars.module.css'

export interface HourBarsProps {
  /** 24 values, an hour each. */
  values: readonly number[]
  label: string
  /** What one bar says on hover: "13:00 UTC, 42". */
  title: (hour: number, value: number) => string
}

const PERCENT = 100
const STUB = 3
const MARKS = ['00', '06', '12', '18', '23']

/** An SVG and not divs with a height: the page's CSP has no room for inline styles. An empty hour keeps a stub, so the shape of the day stays readable. */
export function HourBars({ values, label, title }: HourBarsProps) {
  const max = Math.max(1, ...values)
  const width = PERCENT / Math.max(values.length, 1)
  return (
    <figure className={styles.bars}>
      <svg className={styles.plot} role="img" aria-label={label}>
        {values.map((value, hour) => {
          const height = Math.max(STUB, (value / max) * PERCENT)
          return (
            <rect key={hour} className={value === 0 ? styles.empty : styles.bar} x={`${hour * width + width / 8}%`} y={`${PERCENT - height}%`} width={`${(width * 3) / 4}%`} height={`${height}%`}>
              <title>{title(hour, value)}</title>
            </rect>
          )
        })}
      </svg>
      <figcaption className={styles.marks} aria-hidden>
        {MARKS.map((mark) => (
          <span key={mark}>{mark}</span>
        ))}
      </figcaption>
    </figure>
  )
}
