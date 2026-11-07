import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/ui/Icon/Icon'
import styles from '@/ui/Toast/Toast.module.css'
import { ToastContext, type ToastTone } from '@/ui/Toast/useToast'

interface Item {
  id: number
  message: string
  tone: ToastTone
}

const MAX = 3
const DONE_MS = 4000

/** A result, not a refusal at a field. A success leaves by itself, the rest wait for the cross. */
export function ToastProvider({ closeLabel, children }: { closeLabel: string; children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const nextId = useRef(1)
  const close = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), [])
  const show = useCallback(
    (message: string, tone: ToastTone = 'done') => {
      const id = nextId.current++
      setItems((all) => [...all, { id, message, tone }].slice(-MAX))
      if (tone === 'done') setTimeout(() => close(id), DONE_MS)
    },
    [close],
  )
  const api = useMemo(() => ({ show }), [show])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.stack}>
        {items.map((item) => (
          <div key={item.id} role={item.tone === 'failed' ? 'alert' : 'status'} className={styles.toast}>
            <span className={styles[item.tone]}>
              <Icon name={item.tone === 'done' ? 'check' : 'warn'} size="lg" />
            </span>
            <span className={styles.text}>{item.message}</span>
            {item.tone !== 'done' && (
              <button type="button" className={styles.close} aria-label={closeLabel} onClick={() => close(item.id)}>
                <Icon name="close" size="md" />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
