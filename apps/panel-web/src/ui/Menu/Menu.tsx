import { Icon, type IconName } from '@/ui/Icon/Icon'
import styles from '@/ui/Menu/Menu.module.css'
import { Popover } from '@/ui/Popover/Popover'

export interface MenuItem {
  id: string
  label: string
  icon: IconName
  tone?: 'danger'
  /** Closed with its reason. A closed item stays visible: it says the action exists. */
  disabledReason?: string
  divider?: boolean
  onSelect: () => void
}

export function Menu({ label, items }: { label: string; items: readonly MenuItem[] }) {
  return (
    <Popover
      align="end"
      trigger={(props) => (
        <button type="button" className={styles.opener} aria-label={label} aria-haspopup="menu" {...props}>
          <Icon name="more" size="lg" />
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label={label} className={styles.menu}>
          {items.map((item) => (
            <div key={item.id}>
              {item.divider && <div className={styles.divider} />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabledReason !== undefined}
                className={`${styles.item} ${item.tone === 'danger' ? styles.danger : ''}`}
                onClick={() => {
                  close()
                  item.onSelect()
                }}
              >
                <Icon name={item.icon} size="lg" />
                <span className={styles.text}>
                  {item.label}
                  {item.disabledReason && <span className={styles.reason}>{item.disabledReason}</span>}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </Popover>
  )
}
