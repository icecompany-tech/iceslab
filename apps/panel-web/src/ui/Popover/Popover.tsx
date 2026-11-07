import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styles from '@/ui/Popover/Popover.module.css'

export interface PopoverProps {
  /** Pressed state and the opener's own props; the anchor is the wrapper. */
  trigger: (props: { 'aria-expanded': boolean; onClick: () => void }) => ReactNode
  align?: 'start' | 'end'
  children: ReactNode | ((close: () => void) => ReactNode)
}

const GAP = 6
const MARGIN = 8

/**
 * Open under its trigger and out of any scrolling parent: `fixed`, the place set on the
 * element, since the page's CSP refuses style attributes. Esc and a click outside close it.
 */
export function Popover({ trigger, align = 'start', children }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect()
    const el = panel.current
    if (!open || !box || !el) return
    const place = el.getBoundingClientRect()
    const left = align === 'end' ? box.right - place.width : box.left
    const below = box.bottom + GAP
    const fits = below + place.height <= window.innerHeight - MARGIN
    el.style.left = `${Math.max(MARGIN, left)}px`
    el.style.top = `${fits ? below : Math.max(MARGIN, box.top - GAP - place.height)}px`
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !anchor.current?.contains(target) && !panel.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={anchor} className={styles.anchor}>
      {trigger({ 'aria-expanded': open, onClick: () => setOpen(!open) })}
      {open && (
        <div ref={panel} className={styles.panel}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </span>
  )
}
