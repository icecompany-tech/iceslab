// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { guardedLeave, leaveGuarded, useLeaveGuard } from '@/lib/leaveGuard'

function Holder({ active, ask }: { active: boolean; ask: (go: () => void) => void }) {
  useLeaveGuard(active, ask)
  return null
}

describe('leaveGuard', () => {
  it('without a guard the way out goes straight on', () => {
    const go = vi.fn()
    guardedLeave(go)
    expect(go).toHaveBeenCalledTimes(1)
    expect(leaveGuarded()).toBe(false)
  })

  it('an active guard gets the leave instead, and the browser asks before the tab closes', () => {
    const ask = vi.fn()
    const go = vi.fn()
    const view = render(<Holder active ask={ask} />)
    expect(leaveGuarded()).toBe(true)
    guardedLeave(go)
    expect(go).not.toHaveBeenCalled()
    expect(ask).toHaveBeenCalledWith(go)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    view.unmount()
    expect(leaveGuarded()).toBe(false)
  })

  it('an inactive or released guard holds nothing', () => {
    const ask = vi.fn()
    const view = render(<Holder active={false} ask={ask} />)
    const go = vi.fn()
    guardedLeave(go)
    expect(go).toHaveBeenCalledTimes(1)
    view.rerender(<Holder active ask={ask} />)
    view.rerender(<Holder active={false} ask={ask} />)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })
})
