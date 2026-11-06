// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SquadSelect, type SquadSelectTexts } from '@/ui/SquadSelect/SquadSelect'

const texts: SquadSelectTexts = {
  placeholder: 'Сквады не выбраны',
  search: 'Найти сквад',
  empty: 'Ничего не найдено',
  allGroup: 'Все сквады',
  clearAll: 'Снять все',
  clearSearch: 'Очистить поиск',
  remove: 'Убрать',
  selectedGroup: (n) => `Выбрано ${n}`,
  selectedFooter: (n, total) => `Выбрано ${n} из ${total}`,
  foundFooter: (n, total) => `Найдено ${n} из ${total}`,
}

const options = [
  { id: 'a', name: 'basic', hint: '4 профиля' },
  { id: 'b', name: 'premium', hint: '9 профилей' },
  { id: 'c', name: 'premium-eu', hint: '4 профиля' },
  { id: 'd', name: 'prepaid' },
  { id: 'e', name: 'family' },
]

function Harness({ initial, spy }: { initial: string[]; spy?: (next: string[]) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <SquadSelect
      label="Сквады"
      options={options}
      value={value}
      texts={texts}
      onChange={(next) => {
        setValue(next)
        spy?.(next)
      }}
    />
  )
}

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /Сквады/ }))
  return screen.findByRole('listbox')
}

describe('ui/SquadSelect', () => {
  it('says nothing is chosen when nothing is', () => {
    render(<Harness initial={[]} />)
    expect(screen.getByText('Сквады не выбраны')).toBeTruthy()
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('shows three tags and counts the rest', () => {
    render(<Harness initial={['a', 'b', 'c', 'd', 'e']} />)
    expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('+2')).toBeTruthy()
  })

  it('removes a tag with its own button and leaves the list closed', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<Harness initial={['a', 'b']} spy={spy} />)
    await user.click(screen.getByRole('button', { name: 'Убрать basic' }))
    expect(spy).toHaveBeenCalledWith(['b'])
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('groups what was chosen on top and keeps the list open while choosing', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<Harness initial={['b']} spy={spy} />)
    const list = await open(user)
    expect(within(list).getByText('Выбрано 1')).toBeTruthy()
    await user.click(within(list).getByRole('option', { name: /family/ }))
    expect(spy).toHaveBeenCalledWith(['b', 'e'])
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getByText('Выбрано 2 из 5')).toBeTruthy()
  })

  it('does not move a row to the chosen group while the list is open', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['b']} />)
    const list = await open(user)
    await user.click(within(list).getByRole('option', { name: /family/ }))
    expect(within(screen.getByRole('listbox')).getByText('Выбрано 1')).toBeTruthy()
  })

  it('filters by what is typed, counts it, and drops the groups', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['b']} />)
    await open(user)
    await user.type(screen.getByRole('searchbox', { name: 'Найти сквад' }), 'PRE')
    const rows = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(rows.map((r) => r.textContent)).toEqual([
      'premium9 профилей',
      'premium-eu4 профиля',
      'prepaid',
    ])
    expect(screen.getByText('Найдено 3 из 5')).toBeTruthy()
    expect(screen.queryByText('Все сквады')).toBeNull()
  })

  it('says when the search found nothing', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[]} />)
    await open(user)
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText('Ничего не найдено')).toBeTruthy()
    expect(screen.getByText('Найдено 0 из 5')).toBeTruthy()
  })

  it('clears the choice from the footer', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<Harness initial={['a', 'b']} spy={spy} />)
    await open(user)
    await user.click(screen.getByRole('button', { name: 'Снять все' }))
    expect(spy).toHaveBeenCalledWith([])
  })

  it('works from the keyboard: arrows move, Enter chooses, Escape closes', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<Harness initial={[]} spy={spy} />)
    await open(user)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(spy).toHaveBeenCalledWith(['a'])
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('keeps an id the list does not know out of the tags', () => {
    render(<Harness initial={['a', 'gone']} />)
    expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(1)
  })
})
