import { UNSAFE_createBrowserHistory } from 'react-router-dom'
import { guardedLeave, leaveGuarded } from '@/lib/leaveGuard'

const history = UNSAFE_createBrowserHistory({ v5Compat: true })

export const panelHistory: typeof history = {
  ...history,
  get action() { return history.action },
  get location() { return history.location },
  listen(listener) {
    let visible = history.location
    let rewinding: { key: string; delta: number } | null = null
    let permitted: string | null = null
    return history.listen((update) => {
      const { action, delta, location } = update
      if (rewinding && location.key === visible.key) {
        // Restore the displayed entry before asking, so Stay keeps its URL and form.
        const target = rewinding
        rewinding = null
        guardedLeave(() => {
          if (history.location.key !== visible.key) return
          permitted = target.key
          history.go(target.delta)
        })
        return
      }
      if (action === 'POP' && delta && location.key !== permitted && leaveGuarded()) {
        const fromVisible = (rewinding?.delta ?? 0) + delta
        if (fromVisible) {
          rewinding = { key: location.key, delta: fromVisible }
          history.go(-fromVisible)
          return
        }
      }
      permitted = null
      rewinding = null
      visible = location
      listener(update)
    })
  },
}
