// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Popover, type PopoverProps } from '@/ui/Popover/Popover'

const LOOKS: readonly NonNullable<PopoverProps['look']>[] = ['menu', 'sheet', 'field']

function box(look: NonNullable<PopoverProps['look']>) {
  render(
    <div>
      <button type="button">outside</button>
      <Popover look={look} trigger={(props) => <button type="button" {...props}>open</button>}>
        <p>inside</p>
      </Popover>
      {/* A calendar portalled by the headless library: its own layer, not «outside». */}
      <div data-trigger="DatePicker">
        <button type="button">nested</button>
      </div>
    </div>,
  )
}

describe('ui/Popover closes the same way in every look (owner rule for all popovers)', () => {
  for (const look of LOOKS) {
    it(`${look}: Esc, a press outside and a second press on its button close it`, async () => {
      box(look)
      const open = screen.getByRole('button', { name: 'open' })
      await userEvent.click(open)
      expect(screen.getByText('inside')).toBeTruthy()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByText('inside')).toBeNull()

      await userEvent.click(open)
      await userEvent.click(screen.getByRole('button', { name: 'outside' }))
      expect(screen.queryByText('inside')).toBeNull()

      await userEvent.click(open)
      await userEvent.click(open)
      expect(screen.queryByText('inside')).toBeNull()
    })

    it(`${look}: a press inside it or in a nested calendar keeps it open`, async () => {
      box(look)
      await userEvent.click(screen.getByRole('button', { name: 'open' }))
      await userEvent.click(screen.getByText('inside'))
      await userEvent.click(screen.getByRole('button', { name: 'nested' }))
      expect(screen.getByText('inside')).toBeTruthy()
    })
  }
})
