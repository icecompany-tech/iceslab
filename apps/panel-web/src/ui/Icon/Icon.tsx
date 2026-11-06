import styles from '@/ui/Icon/Icon.module.css'

// Paths from the Paper layers that draw them. A new icon is a new line here.
const PATHS = {
  chevronDown: 'M6.5 9.5 L12 15 L17.5 9.5',
  chevronLeft: 'M14.5 6.5 L9 12 L14.5 17.5',
  chevronRight: 'M9.5 6.5 L15 12 L9.5 17.5',
  close: 'M6 6 L18 18 M18 6 L6 18',
  search: 'M10.5 4 A6.5 6.5 0 1 1 10.5 17 A6.5 6.5 0 1 1 10.5 4 Z M15.3 15.3 L20.5 20.5',
  calendar: 'M3 5 H21 V21 H3 Z M3 10 H21 M8 2.5 V6.5 M16 2.5 V6.5',
  check: 'M4.8 12.6 L9.8 17.4 L19.2 7',
} as const

export type IconName = keyof typeof PATHS

type IconSize = 'sm' | 'md' | 'lg'

export interface IconProps {
  name: IconName
  size?: IconSize
}

/** Decorative: the control around it carries the name for a screen reader. */
export function Icon({ name, size = 'lg' }: IconProps) {
  return (
    <svg className={`${styles.icon} ${styles[size]}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
