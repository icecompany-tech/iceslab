// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SquadFormPage from '@/contours/squads/screens/SquadFormPage'
import { ALL_SQUAD_ID } from '@/lib/domain/squads'
import { renderApp, stubServer } from '@/test/app'

const squad = (over: object = {}) => ({ id: 's1', name: 'premium', description: null, profileIds: ['p1', 'p2'], hostIds: ['h1', 'h3'], exitAcl: [], policyIds: [], memberCount: 2, hwidDeviceLimit: null, routingPreset: null, customRoutingPresetId: null, ...over })
const host = (id: string, bindingId: string, over: object = {}) => ({ id, bindingId, enabled: true, remark: id, hiddenByCascade: null, portOverride: null, ...over })

const narrow = squad({ id: 'n', name: 'other-narrow', hostIds: ['h2'], profileIds: ['p1'] })
const hollow = squad({ id: 'e', name: 'hollow', hostIds: [], profileIds: [], memberCount: 0 })

const server = (over: Record<string, object> = {}) =>
  stubServer({
    'GET /api/squads': { body: { squads: [squad(), narrow, hollow, squad({ id: 'w', name: 'wide', hostIds: [], profileIds: ['p1'] }), squad({ id: ALL_SQUAD_ID, name: 'All', hostIds: [], profileIds: ['p1'] })] } },
    'GET /api/hosts': { body: { hosts: [host('h1', 'b1'), host('h2', 'b1'), host('h3', 'b2', { enabled: false })] } },
    'GET /api/bindings': { body: { bindings: [{ id: 'b1', profileId: 'p1', nodeId: 'n1', port: 443 }, { id: 'b2', profileId: 'p2', nodeId: 'n1', port: 8443 }] } },
    'GET /api/nodes': { body: { nodes: [{ id: 'n1', name: 'de-01', countryCode: 'DE' }], total: 1 } },
    'GET /api/profiles': { body: { profiles: [{ id: 'p1', name: 'vless-1', protocol: 'xray' }, { id: 'p2', name: 'hy-1', protocol: 'hysteria' }] } },
    'GET /api/cascades': { body: { cascades: [] } },
    'GET /api/route-policies': { body: { policies: [] } },
    'GET /api/node-policies': { body: { policies: [] } },
    'GET /api/routing-presets': { body: { presets: [] } },
    'GET /api/users': { body: { users: [{ username: 'kate', groupIds: ['s1'] }], total: 1 } },
    'PUT /api/squads/s1': { body: squad() },
    'PUT /api/squads/w': { body: squad() },
    ...over,
  })

const page = (route = '/squads/s1') =>
  renderApp(
    <Routes>
      <Route path="/squads/new" element={<SquadFormPage />} />
      <Route path="/squads/:id" element={<SquadFormPage />} />
      <Route path="/squads" element={<div>list</div>} />
    </Routes>,
    { route },
  )

const save = async () => userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }))
const putBody = (s: ReturnType<typeof server>) => s.writes().find((w) => w.method === 'PUT')?.body

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('SquadFormPage, gates B2', () => {
  it('загрузка', () => {
    server()
    page()
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: without the host list the form is not open, a save could not be built', async () => {
    server({ 'GET /api/hosts': { status: 500, body: {} } })
    page()
    await screen.findByText('Хосты не загрузились: менять выбор нельзя.', {}, { timeout: 8000 })
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
  })

  it('пусто: a deleted squad says so', async () => {
    server({ 'GET /api/squads': { body: { squads: [] } } })
    page()
    await screen.findByText('Уже удалён')
  })

  it('не проверено: members that could not be read stop the emptying', async () => {
    server({ 'GET /api/users': { status: 500, body: {} } })
    page()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'h1' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'h3' }))
    await save()
    await screen.findByText(/Не удалось прочитать участников/, {}, { timeout: 8000 })
  })

  it('All is read only: no save, no delete, no live checks', async () => {
    server()
    page(`/squads/${ALL_SQUAD_ID}`)
    await screen.findByText('Сквад All')
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Удалить сквад' })).toBeNull()
    expect((screen.getByRole('checkbox', { name: 'h1' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('an untouched squad sends nothing; a name goes alone, without the lists', async () => {
    const s = server()
    page()
    const button = (await screen.findByRole('button', { name: 'Сохранить' })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'gold' } })
    await save()
    await waitFor(() => expect(putBody(s)).toEqual({ name: 'gold' }))
  })

  it('a squad without narrowing is shown as it is and its checks are shut until "by hand"', async () => {
    const s = server()
    page('/squads/w')
    await screen.findByText(/выдаёт все хосты своих профилей \(сейчас 2\)/)
    const box = screen.getByRole('checkbox', { name: 'h1' }) as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'wider' } })
    await save()
    await waitFor(() => expect(putBody(s)).toEqual({ name: 'wider' }))
  })

  it('unticking on an unnarrowed squad sends all the remaining hosts of all its profiles', async () => {
    const s = server()
    page('/squads/w')
    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать вручную' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'h1' }))
    await save()
    await waitFor(() => expect(putBody(s)).toEqual({ hostIds: ['h2'], profileIds: ['p1'] }))
  })

  it('profiles come from the whole choice: a turned off host keeps its profile', async () => {
    const s = server()
    page()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'h2' }))
    await save()
    await waitFor(() => expect(putBody(s)).toEqual({ hostIds: ['h1', 'h3', 'h2'], profileIds: ['p1', 'p2'] }))
  })

  it('a profile the choice leaves is named before the save', async () => {
    const s = server()
    page()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'h3' }))
    await save()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/hy-1/)
    expect(s.writes()).toEqual([])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(putBody(s)).toEqual({ hostIds: ['h1'], profileIds: ['p1'] }))
  })

  it('an empty choice asks a second time and sends both empty', async () => {
    const s = server()
    page()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'h1' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'h3' }))
    await save()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/не выдаст ни одного хоста/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(putBody(s)).toEqual({ hostIds: [], profileIds: [] }))
  })

  it('emptying is refused by name while members stand in a narrowed squad', async () => {
    const s = server({ 'GET /api/users': { body: { users: [{ username: 'kate', groupIds: ['s1', 'n'] }], total: 1 } } })
    page()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'h1' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'h3' }))
    await save()
    await screen.findByText(/Нельзя опустошить: участники \(kate\).*\(other-narrow\)/)
    expect(s.writes()).toEqual([])
  })

  it('narrowing a squad whose members stand in an empty one asks with the cost', async () => {
    const s = server({ 'GET /api/users': { body: { users: [{ username: 'lena', groupIds: ['w', 'e'] }], total: 1 } } })
    page('/squads/w')
    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать вручную' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'h1' }))
    await save()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/lena.*hollow/)
    expect(s.writes()).toEqual([])
  })

  it('creating an empty squad asks with the cost', async () => {
    const s = server({ 'POST /api/squads': { status: 201, body: squad({ id: 'x', name: 'new' }) } })
    page('/squads/new')
    fireEvent.change(await screen.findByLabelText('Имя'), { target: { value: 'new' } })
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect((await screen.findByRole('dialog')).textContent).toMatch(/снимет сужение/)
    expect(s.writes()).toEqual([])
  })

  it('the name follows the server rule at the field', async () => {
    server()
    page()
    fireEvent.change(await screen.findByLabelText('Имя'), { target: { value: 'премиум' } })
    await screen.findByText(/латиница, цифры/)
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('F-19: the window says who moves to All, before any request', async () => {
    const s = server()
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить сквад' }))
    expect((await screen.findByRole('dialog')).textContent).toMatch(/перейдут в All и получат все хосты/)
    expect(s.writes()).toEqual([])
  })

  it('the right block is "Selected", there is no "What users get"', async () => {
    server()
    page()
    await screen.findByText('Выбрано')
    expect(screen.queryByText(/Что получат юзеры/)).toBeNull()
  })
})
