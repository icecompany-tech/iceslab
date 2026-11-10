import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styles from '@/ui/Popover/Popover.module.css'

export interface PopoverProps {
  /** Pressed state and the opener's own props; the anchor is the wrapper. */
  trigger: (props: { 'aria-expanded': boolean; onClick: () => void }) => ReactNode
  align?: 'start' | 'end'
  /**
   * menu: 6 under the trigger. sheet (ui/ColumnsPanel): radius lg, the deeper shadow, no gap.
   * field (ui/Popover/срок): 5 under a column filter, the deeper shadow.
   */
  look?: 'menu' | 'sheet' | 'field'
  children: ReactNode | ((close: () => void) => ReactNode)
}

// As drawn: a sheet hangs from its button's bottom edge, a filter's box sits 5 under the field.
const GAPS = { menu: 6, sheet: 0, field: 5 } as const
const MARGIN = 8

/** A calendar or a list that a field inside the box opens lives in its own layer: a press there is not «outside». */
const inNestedLayer = (target: Element) => target.closest('[data-trigger]') !== null

/**
 * Open under its trigger and out of any scrolling parent: `fixed`, the place set on the
 * element, since the page's CSP refuses style attributes. Esc and a click outside close it.
 */
export function Popover({ trigger, align = 'start', look = 'menu', children }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect()
    const el = panel.current
    if (!open || !box || !el) return
    const place = el.getBoundingClientRect()
    const left = align === 'end' ? box.right - place.width : box.left
    const gap = GAPS[look]
    const below = box.bottom + gap
    const fits = below + place.height <= window.innerHeight - MARGIN
    el.style.left = `${Math.max(MARGIN, left)}px`
    el.style.top = `${fits ? below : Math.max(MARGIN, box.top - gap - place.height)}px`
  }, [open, align, look])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || anchor.current?.contains(target) || panel.current?.contains(target) || inNestedLayer(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      // An Esc a nested calendar already took closes only it.
      if (event.key === 'Escape' && !event.defaultPrevented) setOpen(false)
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
        <div ref={panel} className={`${styles.panel} ${look === 'menu' ? '' : styles[look]}`}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </span>
  )
}
