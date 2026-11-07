import styles from '@/ui/HopMeter/HopMeter.module.css'

export interface HopMeterProps {
  count: number
  max: number
  /** «3 из 5 хопов», and on the last «больше нельзя». */
  label: string
}

/** Five points on a line: how much of the path is used. The path counts the entry, the transits and the exit together. */
export function HopMeter({ count, max, label }: HopMeterProps) {
  return (
    <span className={styles.meter}>
      <span className={styles.points} aria-hidden>
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={i < count ? styles.on : styles.point} />
        ))}
      </span>
      {label}
    </span>
  )
}
