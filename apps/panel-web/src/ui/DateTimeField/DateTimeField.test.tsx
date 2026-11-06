// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from 'react-aria-components'
import { describe, expect, it, vi } from 'vitest'
import { DateTimeField } from '@/ui/DateTimeField/DateTimeField'

const texts = { open: 'Открыть календарь', previousMonth: 'Прошлый месяц', nextMonth: 'Следующий месяц' }

function field(value: string | null, onChange = vi.fn(), error?: string) {
  render(
    <I18nProvider locale="ru-RU">
      <DateTimeField
        label="Срок"
        value={value}
        onChange={onChange}
        timeZone="Europe/Moscow"
        error={error}
        texts={texts}
      />
    </I18nProvider>,
  )
  return onChange
}

const segments = () => within(screen.getByRole('group', { name: 'Срок' })).getAllByRole('spinbutton')

describe('ui/DateTimeField', () => {
  it('shows the instant in the wall clock it was given, day first, 24 hours', () => {
    field('2026-12-04T11:00:00.000Z')
    expect(segments().map((s) => s.textContent)).toEqual(['04', '12', '2026', '14', '00'])
  })

  it('leaves the segments empty on no date', () => {
    field(null)
    expect(segments().map((s) => s.getAttribute('aria-valuenow'))).toEqual([null, null, null, null, null])
  })

  it('hands back an instant, not a wall clock', async () => {
    const user = userEvent.setup()
    const onChange = field('2026-12-04T11:00:00.000Z')
    const hour = segments()[3]
    if (!hour) throw new Error('no hour segment')
    await user.click(hour)
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenCalledWith('2026-12-04T12:00:00.000Z')
  })

  it('picks a day in the calendar and keeps the time', async () => {
    const user = userEvent.setup()
    const onChange = field('2026-12-04T11:00:00.000Z')
    await user.click(screen.getByRole('button', { name: /Открыть календарь/ }))
    const grid = await screen.findByRole('grid')
    await user.click(within(grid).getByRole('button', { name: /10 декабря/ }))
    expect(onChange).toHaveBeenCalledWith('2026-12-10T11:00:00.000Z')
  })

  it('moves between months', async () => {
    const user = userEvent.setup()
    field('2026-12-04T11:00:00.000Z')
    await user.click(screen.getByRole('button', { name: /Открыть календарь/ }))
    await screen.findByRole('grid')
    expect(screen.getByRole('heading').textContent).toMatch(/декабрь 2026/i)
    await user.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    expect(screen.getByRole('heading').textContent).toMatch(/январь 2027/i)
  })

  it('says the refusal at the field', () => {
    field('2026-12-04T11:00:00.000Z', vi.fn(), 'Срок уже прошёл')
    expect(screen.getByText('Срок уже прошёл')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Срок' }).getAttribute('data-invalid')).toBe('true')
  })
})
