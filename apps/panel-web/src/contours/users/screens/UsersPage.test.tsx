// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UsersPage from '@/contours/users/screens/UsersPage'
import { ALL_SQUAD_ID } from '@/lib/domain/squads'
import { renderApp, stubServer, NOW } from '@/test/app'

const GiB = 1024 ** 3
const iso = (fromNowDays: number) => new Date(NOW + fromNowDays * 86_400_000).toISOString()

const user = (over: object = {}) => ({
  id: 'u1',
  shortId: 'a7f3c1xx',
  username: 'kate_m',
  status: 'active',
  expireAt: iso(6),
  trafficLimitBytes: 50 * GiB,
  trafficUsedBytes: 39 * GiB,
  lifetimeTrafficBytes: 100 * GiB,
  trafficLimitStrategy: 'month',
  lastTrafficResetAt: null,
  lastOnlineAt: new Date(NOW - 60_000).toISOString(),
  firstConnectedAt: iso(-30),
  lastConnectedNodeId: 'n1',
  lastConnectedNodeName: 'nl-02',
  subscriptionToken: 'tok',
  subRevokedAt: null,
  hwidDeviceLimit: null,
  routingPreset: null,
  customRoutingPresetId: null,
  description: null,
  tag: null,
  telegramId: null,
  email: null,
  groupIds: [ALL_SQUAD_ID],
  createdAt: iso(-60),
  updatedAt: iso(-1),
  ...over,
})

const OVERVIEW = {
  users: { total: 1358, byStatus: { active: 1204, expired: 96, limited: 21, disabled: 37 }, onlineNow: 1, onlineToday: 2 },
  traffic: { todayBytes: 0, yesterdayBytes: 0, last7dBytes: 0, prev7dBytes: 0, last30dBytes: 0, prev30dBytes: 0, calendarMonthBytes: 0, currentYearBytes: 0, last24hHourly: [] },
  system: { onlineNodeCount: 1, totalNodeCount: 1 },
  inventory: { profileCount: 1, squadCount: 1, hostCount: 1 },
  host: null,
  nodes: [],
}

const squad = (id: string, name: string, hostIds: string[], profileIds: string[]) => ({ id, name, description: null, hostIds, profileIds, memberCount: 1, hwidDeviceLimit: null, routingPreset: null, customRoutingPresetId: null })

const server = (over: Record<string, object | ((r: { path: string; body: unknown }) => object)> = {}) =>
  stubServer({
    'GET /api/users': { body: { users: [user()], total: 1 } },
    'GET /api/dashboard/overview': { body: OVERVIEW },
    'GET /api/squads': { body: { squads: [squad(ALL_SQUAD_ID, 'All', [], ['p'])] } },
    'GET /api/nodes': { body: { nodes: [], total: 0 } },
    'GET /api/users/tags': { body: { tags: [] } },
    'GET /api/auth/status': { body: { panel: { publicUrl: 'https://panel.test', subscriptionPathPrefix: '/sub' } } },
    'GET /api/users/u1/endpoints': { body: { endpoints: [] } },
    'GET /api/users/u1/delivery': { body: { routing: { effectivePreset: { id: 'x', name: 'proxy-all', builtIn: true }, userPreset: null, squadPreset: null, squadConflict: false } } },
    'GET /api/users/u1/hwid-devices': { body: { devices: [] } },
    ...over,
  })

const page = () => renderApp(<UsersPage />, { route: '/users' })
const openMenu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Действия с kate_m' }))
}

vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
})
afterEach(() => vi.unstubAllGlobals())

describe('UsersPage', () => {
  it('загрузка: says it is loading', () => {
    server()
    page()
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: a failure is not an empty list, the chips and the button live on', async () => {
    const s = server({ 'GET /api/users': { status: 500, body: {} } })
    page()
    await screen.findByText('Список юзеров не загрузился')
    expect(screen.queryByText('Юзеров пока нет')).toBeNull()
    expect(screen.getByRole('button', { name: 'Создать' })).toBeTruthy()
    const before = s.sent.length
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(s.sent.length).toBeGreaterThan(before)
  })

  it('пусто: no users and nobody found are different words', async () => {
    server({ 'GET /api/users': { body: { users: [], total: 0 } } })
    page()
    await screen.findByText('Юзеров пока нет')
    await userEvent.click(screen.getByRole('button', { name: /Отключены/ }))
    await screen.findByText('Никого не нашли')
  })

  it('не проверено: status counts that did not arrive are not zero', async () => {
    server({ 'GET /api/dashboard/overview': { status: 500, body: {} } })
    page()
    await screen.findByText('kate_m')
    expect(within(screen.getByRole('button', { name: 'Действуют' })).queryByText('0')).toBeNull()
  })

  it('shows the row as the frame does and sends what the server can narrow by', async () => {
    const s = server()
    page()
    await screen.findByText('kate_m')
    expect(screen.getByText('через 6 дн')).toBeTruthy()
    expect(screen.getByText('78%')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Истекли/ }))
    await waitFor(() => expect(s.sent.some((r) => r.path.includes('status=expired'))).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: 'Трафик' }))
    await waitFor(() => expect(s.sent.some((r) => r.path.includes('sort=traffic'))).toBe(true))
  })

  it('disabling asks first, amber, then sends only the status', async () => {
    const s = server({ 'PUT /api/users/u1': { body: user({ status: 'disabled' }) } })
    page()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Отключить' }))
    expect(s.writes()).toEqual([])
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/Включить обратно можно/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отключить' }))
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/users/u1', body: { status: 'disabled' } }]))
  })

  it('every dangerous item asks before it sends', async () => {
    const s = server()
    page()
    for (const [item, title] of [
      ['Сбросить трафик', /Сбросить трафик kate_m/],
      ['Перевыпустить ссылку', /Перевыпустить ссылку kate_m/],
      ['Отозвать ссылку', /Отозвать ссылку kate_m/],
      ['Удалить', /Удалить юзера kate_m/],
    ] as const) {
      await openMenu()
      await userEvent.click(screen.getByRole('menuitem', { name: item }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).toMatch(title)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    }
    expect(s.writes()).toEqual([])
  })

  it('a link reissue does not promise dead configs (F-18)', async () => {
    server()
    page()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Перевыпустить ссылку' }))
    expect((await screen.findByRole('dialog')).textContent).toMatch(/импортированные конфиги продолжат работать/)
  })

  it('a user without a term cannot be extended, and says why', async () => {
    server({ 'GET /api/users': { body: { users: [user({ expireAt: null })], total: 1 } } })
    page()
    await openMenu()
    const item = screen.getByRole('menuitem', { name: /Продлить/ }) as HTMLButtonElement
    expect(item.disabled).toBe(true)
    expect(item.textContent).toMatch(/нет срока/)
  })

  it('a disabled user is switched on without a window', async () => {
    const s = server({ 'GET /api/users': { body: { users: [user({ status: 'disabled' })], total: 1 } }, 'PUT /api/users/u1': { body: user() } })
    page()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Включить' }))
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/users/u1', body: { status: 'active' } }]))
  })

  it('bulk disable reports failures by name and keeps them selected', async () => {
    const s = server({
      'GET /api/users': { body: { users: [user(), user({ id: 'u2', username: 'mira_s' })], total: 2 } },
      'POST /api/users/bulk': { body: { requested: 2, succeeded: 1, ok: ['u1'], failed: [{ userId: 'u2', error: 'gone' }] } },
    })
    page()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать всех на странице' }))
    await userEvent.click(screen.getByRole('button', { name: 'Отключить' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отключить' }))
    await screen.findByText(/Не вышло у 1: mira_s: gone/)
    expect(s.writes()[0]?.body).toEqual({ userIds: ['u1', 'u2'], action: 'disable' })
    expect(screen.getByText('Выбрано: 1')).toBeTruthy()
  })

  it('the user window opens by the row, an untouched save is closed', async () => {
    const s = server()
    page()
    await userEvent.click(await screen.findByText('kate_m'))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true)
    expect(s.writes()).toEqual([])
    await within(dialog).findByText('proxy-all, умолчание панели')
  })

  it('a fraction of a GB is refused at the field, the server takes whole GB only (Bk-119)', async () => {
    server()
    page()
    await userEvent.click(await screen.findByText('kate_m'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Лимит трафика'), { target: { value: '1,5' } })
    await within(dialog).findByText('Введите целое число ГБ больше нуля')
    expect((within(dialog).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a save sends only what changed, a taken field stands at the field', async () => {
    const s = server({ 'PUT /api/users/u1': { body: user() } })
    page()
    await userEvent.click(await screen.findByText('kate_m'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Тег'), { target: { value: 'vip' } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/users/u1', body: { tag: 'vip' } }]))
  })

  it('a user in a narrowed squad and a wide one is told the narrowing does not apply', async () => {
    server({
      'GET /api/users': { body: { users: [user({ groupIds: ['n', ALL_SQUAD_ID] })], total: 1 } },
      'GET /api/squads': { body: { squads: [squad(ALL_SQUAD_ID, 'All', [], ['p']), squad('n', 'premium', ['h'], ['p'])] } },
    })
    page()
    await userEvent.click(await screen.findByText('kate_m'))
    await within(await screen.findByRole('dialog')).findByText(/Сужение на этого юзера не действует.*All/)
  })

  it('an old preset can only be cleared, and clearing sends both nulls', async () => {
    const s = server({
      'GET /api/users': { body: { users: [user({ customRoutingPresetId: 'c' })], total: 1 } },
      'PUT /api/users/u1': { body: user() },
    })
    page()
    await userEvent.click(await screen.findByText('kate_m'))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Снять' }))
    await waitFor(() => expect(s.writes()[0]?.body).toEqual({ routingPreset: null, customRoutingPresetId: null }))
  })

  it('a failed block stays in its place, the rest of the window works', async () => {
    server({ 'GET /api/users/u1/hwid-devices': { status: 500, body: {} } })
    page()
    await userEvent.click(await screen.findByText('kate_m'))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/Список устройств не загрузился/)
    expect(within(dialog).getByText('Подписка')).toBeTruthy()
  })

  it('a new user: bad name closes the button, a taken name stands at the field', async () => {
    const s = server({ 'POST /api/users': { status: 409, body: { error: 'USERNAME_TAKEN', message: 'taken', field: 'username' } } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Создать' }))
    const dialog = await screen.findByRole('dialog')
    const create = within(dialog).getByRole('button', { name: 'Создать' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Имя'), { target: { value: 'new_user' } })
    await waitFor(() => expect(create.disabled).toBe(false))
    await userEvent.click(create)
    await within(dialog).findByText('Такое имя уже есть')
    const sent = s.writes()[0]?.body as { username: string; trafficLimitGb: number; expireAt: string }
    expect(sent.username).toBe('new_user')
    expect(sent.trafficLimitGb).toBe(50)
    expect(Date.parse(sent.expireAt)).toBe(NOW + 30 * 86_400_000)
  })
})
