import { useEffect, useRef, type ReactNode } from 'react'
import styles from '@/ui/Dialog/Dialog.module.css'
import { Icon } from '@/ui/Icon/Icon'

export interface DialogProps {
  title: ReactNode
  closeLabel: string
  onClose: () => void
  /** `window` is the 920 of the user window, `small` the 480 of a question. */
  size?: 'small' | 'window'
  footer?: ReactNode
  children: ReactNode
}

/** The native element: focus trap, Esc and the top layer come with it, no library. */
export function Dialog({ title, closeLabel, onClose, size = 'small', footer, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || el.open) return
    if (typeof el.showModal === 'function') el.showModal()
    else el.setAttribute('open', '')
  }, [])
  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${size === 'window' ? styles.window : ''}`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        {size === 'window' && (
          <button type="button" className={styles.close} aria-label={closeLabel} onClick={onClose}>
            <Icon name="close" size="lg" />
          </button>
        )}
      </header>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.foot}>{footer}</footer>}
    </dialog>
  )
}
