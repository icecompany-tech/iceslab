// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CascadeFormPage from '@/contours/cascades/screens/CascadeFormPage'
import { renderApp, stubServer } from '@/test/app'

const node = (id: string, name: string, over: object = {}) => ({ id, name, address: `${id}:1337`, protocol: 'xray', countryCode: 'DE', status: 'online', lastStatusChange: null, intendedEngines: ['xray'], coreVersion: '26.3.27', ...over })
const cascade = (over: object = {}) => ({
  id: 'c1',
  name: 'a4-test',
  enabled: true,
  mode: 'chain',
  hideHopsFromSub: true,
  autoProfile: false,
  hops: [],
  positions: [{ position: 0, nodeIds: ['n1'], entryProtocol: 'xray', linkProtocol: 'vless', linkParams: null }],
  directions: [{ id: 'd1', tag: 1, countryCode: 'SE', nodeIds: ['n2'], outboundId: null, linkProtocol: null, linkParams: null, linkPort: 24000 }],
  nextDirectionTag: 2,
  entryPolicy: null,
  tunnels: [],
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...over,
})

const server = (over: Parameters<typeof stubServer>[0] = {}) =>
  stubServer({
    'GET /api/cascades': { body: { cascades: [cascade()], fields: ['entryPolicy', 'directions[].linkProtocol', 'directions[].outboundId'] } },
    'GET /api/nodes': { body: { nodes: [node('n1', 'de-01'), node('n2', 'se-01'), node('n3', 'fi-01', { status: 'unknown' })], total: 3 } },
    'GET /api/named-outbounds': { body: { outbounds: [] } },
    'GET /api/route-policies': { body: { policies: [] } },
    'GET /api/profiles': { body: { profiles: [] } },
    'GET /api/bindings': { body: { bindings: [] } },
    'GET /api/squads': { body: { squads: [] } },
    'GET /api/cascades/c1/status': { body: { done: true, broken: null, hops: [{ nodeId: 'n1', name: 'de-01', applied: true, online: true }] } },
    ...over,
  })

const page = (route = '/cascades/c1') =>
  renderApp(
    <Routes>
      <Route path="/cascades/new" element={<CascadeFormPage />} />
      <Route path="/cascades/:id" element={<CascadeFormPage />} />
      <Route path="/cascades" element={<div>list</div>} />
    </Routes>,
    { route },
  )

const saveLive = () => screen.findByRole('button', { name: 'Сохранить и разослать' }) as Promise<HTMLButtonElement>

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('CascadeFormPage', () => {
  it('загрузка', () => {
    server()
    page()
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем каскады/)
  })

  it('сбой: the cascade list and the node list each say so', async () => {
    server({ 'GET /api/nodes': { status: 500, body: {} } })
    page()
    await screen.findByText('Список нод не загрузился', {}, { timeout: 8000 })
  })

  it('пусто: a cascade gone from the list says so, not an empty form', async () => {
    server({ 'GET /api/cascades': { body: { cascades: [], fields: [] } } })
    page()
    await screen.findByText('Такого каскада больше нет')
  })

  it('не проверено: a node with no report stays unverified on the scheme', async () => {
    server({ 'GET /api/nodes': { body: { nodes: [node('n1', 'de-01', { status: 'unknown' }), node('n2', 'se-01')], total: 2 } } })
    page()
    await screen.findByText('не проверена')
  })

  it('untouched form sends nothing, a rename sends only the name', async () => {
    const s = server({ 'PUT /api/cascades/c1': { body: cascade({ name: 'a5' }) } })
    page()
    const save = await saveLive()
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'a5' } })
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/cascades/c1', body: { name: 'a5' } }]))
    await waitFor(() => expect(save.disabled).toBe(true))
  })

  it('a disabled cascade says plain save, nothing to push', async () => {
    server({ 'GET /api/cascades': { body: { cascades: [cascade({ enabled: false })], fields: ['entryPolicy'] } } })
    page()
    await screen.findByRole('button', { name: 'Сохранить' })
    expect(screen.getByText('Выключен: рассылать нечего.')).toBeTruthy()
    expect(screen.getByText('Ничего. Выключенный каскад никому не отдаётся.')).toBeTruthy()
  })

  it('a new direction goes back with the old ones by id, no tag or port', async () => {
    const s = server({ 'PUT /api/cascades/c1': { body: cascade() } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Выход/ }))
    await userEvent.click(screen.getByRole('button', { name: '+ Направление' }))
    const country = screen.getAllByLabelText(/Страна/)[1] as HTMLSelectElement
    fireEvent.change(country, { target: { value: 'FI' } })
    await userEvent.click(await saveLive())
    await waitFor(() => expect(s.writes()).toHaveLength(1))
    const body = s.writes()[0]?.body as { directions: unknown[]; positions: unknown[] }
    expect(body.positions).toEqual([{ nodeIds: ['n1'], position: 0, entryProtocol: 'xray', linkProtocol: 'vless' }])
    expect(body.directions).toEqual([{ id: 'd1', countryCode: 'SE', nodeIds: ['n2'] }, { countryCode: 'FI', nodeIds: [] }])
  })

  it('the hop button closes at five with words', async () => {
    server({ 'GET /api/cascades': { body: { cascades: [cascade({ positions: [0, 1, 2, 3].map((position) => ({ position, nodeIds: [`x${position}`], entryProtocol: position === 0 ? 'xray' : null, linkProtocol: 'vless', linkParams: null })) })], fields: [] } } })
    page()
    expect(await screen.findByText('5 из 5 хопов, больше нельзя')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Транзит/ }))
    expect((screen.getByRole('button', { name: '+ Хоп' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Больше нельзя/)).toBeTruthy()
  })

  it('F-K6: an entry change asks with the profiles, the consent lives on one request', async () => {
    const answers = [
      { status: 409, body: { error: 'ENTRY_CHANGE_DROPS_USERS', from: 'xray', to: 'hysteria', conflicts: [{ nodeName: 'de-01', profileName: 'vless-1' }] } },
      { body: cascade() },
    ]
    const s = server({ 'PUT /api/cascades/c1': () => answers.shift() ?? { body: cascade() } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Вход/ }))
    fireEvent.change(screen.getByLabelText('Протокол входа'), { target: { value: 'hysteria' } })
    await userEvent.click(await saveLive())
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/Сменить вход каскада с xray на hysteria/)
    expect(ask.textContent).toMatch(/vless-1 на de-01/)
    expect((s.writes()[0]?.body as object)).not.toHaveProperty('confirmEntryChange')
    await userEvent.click(within(ask).getByRole('button', { name: 'Всё равно сменить' }))
    await waitFor(() => expect(s.writes()).toHaveLength(2))
    expect(s.writes()[1]?.body).toHaveProperty('confirmEntryChange', true)
  })

  it('F-6: tags exhausted says the numbers and closes the button, the form stays', async () => {
    server({ 'PUT /api/cascades/c1': { status: 409, body: { error: 'DIRECTION_TAGS_EXHAUSTED', needed: 2, available: 1 } } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Выход/ }))
    await userEvent.click(screen.getByRole('button', { name: '+ Направление' }))
    fireEvent.change(screen.getAllByLabelText(/Страна/)[1] as HTMLSelectElement, { target: { value: 'FI' } })
    await userEvent.click(await saveLive())
    await screen.findByText(/Сохранению нужно тегов: 2, осталось: 1/)
    expect((screen.getByRole('button', { name: '+ Направление' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: 'Новый каскад' }).getAttribute('href')).toBe('/cascades/new')
    expect((screen.getAllByLabelText(/Страна/)[1] as HTMLSelectElement).value).toBe('FI')
  })

  it('a node in another enabled cascade names it with the way there', async () => {
    server({ 'PUT /api/cascades/c1': { status: 409, body: { error: 'NODE_IN_OTHER_CASCADE', nodeName: 'de-01', cascadeId: 'c2', cascadeName: 'other' } } })
    page()
    fireEvent.change(await screen.findByLabelText(/Название/), { target: { value: 'a5' } })
    await userEvent.click(await saveLive())
    await screen.findByText(/Нода de-01 уже во включённом каскаде «other»/)
    expect(screen.getByRole('link', { name: 'Открыть тот каскад' }).getAttribute('href')).toBe('/cascades/c2')
  })

  it('a create sends the whole shape and goes to the new cascade', async () => {
    const s = server({ 'POST /api/cascades': { body: cascade({ id: 'c1' }) } })
    page('/cascades/new')
    const save = (await screen.findByRole('button', { name: 'Создать каскад' })) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await screen.findByText('Дайте каскаду название.')
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'eu-mix' } })
    fireEvent.change(screen.getByLabelText('Нода'), { target: { value: 'n1' } })
    await userEvent.click(screen.getByRole('button', { name: /Выход/ }))
    fireEvent.change(screen.getByLabelText(/Страна/), { target: { value: 'SE' } })
    fireEvent.change(screen.getByLabelText('Нода'), { target: { value: 'n2' } })
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await waitFor(() => expect(s.writes()).toHaveLength(1))
    expect(s.writes()[0]?.body).toEqual({ name: 'eu-mix', enabled: true, hideHopsFromSub: true, positions: [{ nodeIds: ['n1'], position: 0, entryProtocol: 'xray', linkProtocol: 'xray' }], directions: [{ countryCode: 'SE', nodeIds: ['n2'] }] })
  })

  it('tunnels rotate only through a warning window, F-18: nothing promised about imported configs', async () => {
    const s = server({
      'GET /api/cascades': { body: { cascades: [cascade({ tunnels: [{ fromNodeId: 'n1', toNodeId: 'n2', iface: 'awg-l0', network: '10.67.0.0/30', fromAddress: '10.67.0.1', toAddress: '10.67.0.2', port: 27000, publicLinkPortOpen: false }] })], fields: [] } },
      'POST /api/cascades/c1/tunnels/rotate': { body: cascade() },
    })
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Новые ключи' }))
    const ask = await screen.findByRole('dialog')
    expect(s.writes()).toEqual([])
    await userEvent.click(within(ask).getByRole('button', { name: 'Новые ключи' }))
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'POST', path: '/api/cascades/c1/tunnels/rotate', body: { fromNodeId: 'n1', toNodeId: 'n2' } }]))
  })

  it('F-V6: the push panel keeps a core refusal and a silent node apart', async () => {
    server({
      'GET /api/cascades/c1/status': {
        body: { done: false, broken: 'se-01: bad config', hops: [{ nodeId: 'n1', name: 'de-01', applied: false, online: false }, { nodeId: 'n2', name: 'se-01', applied: false, online: true, broken: 'bad config' }] },
      },
    })
    page()
    await screen.findByText('Ядро отказало: bad config')
    expect(screen.getByText('нода не ответила')).toBeTruthy()
    expect(screen.getByText('se-01: bad config')).toBeTruthy()
  })

  it('F-V6: "fetch failed" on a silent node is a lost link, never called the core', async () => {
    server({
      'GET /api/nodes': { body: { nodes: [node('n1', 'de-01', { status: 'unreachable' }), node('n2', 'se-01')], total: 2 } },
      'GET /api/cascades/c1/status': { body: { done: false, broken: 'de-01: fetch failed', hops: [{ nodeId: 'n1', name: 'de-01', applied: false, online: false, broken: 'fetch failed' }] } },
    })
    page()
    await screen.findByText(/Это обрыв связи, а не отказ ядра/)
    expect(screen.queryByText(/дро отказало/)).toBeNull()
    expect(screen.getByText('не отвечает')).toBeTruthy()
  })
})
