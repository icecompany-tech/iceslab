// A screen that shows something once (F-29: the node payload) holds the way out: the menu and the
// sign-out ask it first, and the browser asks before the tab closes. The router of this app has no
// blocker of its own, so the shell links go through here.
import { useEffect, useRef } from 'react'

type Ask = (go: () => void) => void

let current: { ask: Ask } | null = null

/** While `active`, every guarded way out calls `ask` with the leave it would have done. */
export function useLeaveGuard(active: boolean, ask: Ask): void {
  const latest = useRef(ask)
  useEffect(() => {
    latest.current = ask
  })
  useEffect(() => {
    if (!active) return
    const holder = { ask: (go: () => void) => latest.current(go) }
    current = holder
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      if (current === holder) current = null
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [active])
}

export const leaveGuarded = () => current !== null

/** The shell's way out: straight on with no guard, through the screen's question with one. */
export function guardedLeave(go: () => void): void {
  if (current) current.ask(go)
  else go()
}
