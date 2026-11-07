// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CascadesPage from '@/contours/cascades/screens/CascadesPage'
import { renderApp, stubServer } from '@/test/app'

const node = (id: string, name: string, over: object = {}) => ({ id, name, address: `${id}:1337`, protocol: 'xray', countryCode: 'DE', status: 'online', lastStatusChange: null, ...over })
const cascade = (over: object = {}) => ({
  id: 'c1',
  name: 'a4-test',
  enabled: true,
  mode: 'chain',
  hideHopsFromSub: true,
  autoProfile: true,
  hops: [],
  positions: [
    { position: 0, nodeIds: ['n1'], entryProtocol: 'xray', linkProtocol: 'vless', linkParams: null },
    { position: 1, nodeIds: ['n2', 'n3'], entryProtocol: null, linkProtocol: 'hy2', linkParams: { underlay: 'awg' } },
  ],
  directions: [
    { id: 'd1', tag: 1, countryCode: 'SE', nodeIds: ['n4', 'n5'], outboundId: null, linkProtocol: null, linkParams: null, linkPort: 24001 },
    { id: 'd2', tag: 2, countryCode: 'FI', nodeIds: [], outboundId: 'o1', linkProtocol: null, linkParams: null, linkPort: null },
  ],
  nextDirectionTag: 3,
  entryPolicy: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...over,
})

const server = (over: Record<string, object> = {}) =>
  stubServer({
    'GET /api/cascades': { body: { cascades: [cascade()], fields: ['entryPolicy'] } },
    'GET /api/nodes': { body: { nodes: [node('n1', 'de-01'), node('n2', 'tr-01'), node('n3', 'tr-02', { status: 'unknown' }), node('n4', 'se-01'), node('n5', 'se-02', { status: 'unreachable' })], total: 5 } },
    'GET /api/dashboard/overview': { status: 500, body: {} },
    'GET /api/bindings': { body: { bindings: [{ id: 'b', profileId: 'p1', nodeId: 'n1' }] } },
    'GET /api/squads': { body: { squads: [{ id: 's', name: 'premium', profileIds: ['p1'], hostIds: [], exitAcl: [], policyIds: [], memberCount: 5, hwidDeviceLimit: null }] } },
    'GET /api/route-policies': { body: { policies: [] } },
    'GET /api/named-outbounds': { body: { outbounds: [{ id: 'o1', name: 'fi-socks', type: 'socks', config: { server: '1.1.1.1', port: 1080 }, countryCode: 'FI' }] } },
    'GET /api/cascades/c1/status': { body: { done: true, broken: null, hops: [] } },
    ...over,
  })

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('CascadesPage', () => {
  it('загрузка', () => {
    server()
    renderApp(<CascadesPage />, { route: '/cascades' })
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем каскады/)
  })

  it('сбой: says the list did not load, and retries', async () => {
    server({ 'GET /api/cascades': { status: 500, body: {} } })
    renderApp(<CascadesPage />, { route: '/cascades' })
    await screen.findByText('Список каскадов не загрузился', {}, { timeout: 8000 })
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy()
  })

  it('пусто: offers a new cascade', async () => {
    server({ 'GET /api/cascades': { body: { cascades: [], fields: [] } } })
    renderApp(<CascadesPage />, { route: '/cascades' })
    await screen.findByText('Каскадов пока нет')
  })

  it('reads the scheme: entry, balancer, a dead node skipped, an outbound ring, hops counted', async () => {
    server()
    renderApp(<CascadesPage />, { route: '/cascades' })
    await screen.findByText('tr-01')
    expect(screen.getByText('3 из 5 хопов')).toBeTruthy()
    expect(screen.getAllByText('балансер').length).toBe(2)
    expect(screen.getByText('не отвечает: балансер её пропускает')).toBeTruthy()
    expect(screen.getByText('выбирает клиент или балансер Auto')).toBeTruthy()
    expect(screen.getByText('hy2 в AWG')).toBeTruthy()
    await screen.findByText('fi-socks')
    await screen.findByText(/premium, до 5 юзеров/)
  })

  it('не проверено: a node nobody heard from is not called alive or dead', async () => {
    server()
    renderApp(<CascadesPage />, { route: '/cascades' })
    await screen.findByText('tr-02')
    expect(screen.getByText('не проверена')).toBeTruthy()
  })

  it('side lists not arriving read as unknown, never as nobody', async () => {
    server({ 'GET /api/squads': { status: 500, body: {} } })
    renderApp(<CascadesPage />, { route: '/cascades' })
    await screen.findByText(/кому доступен каскад, неизвестно/, {}, { timeout: 8000 })
    expect(screen.queryByText(/никому/)).toBeNull()
  })

  it('F-V6: a broken hop is the core refusal, not a lost node', async () => {
    server({ 'GET /api/cascades/c1/status': { body: { done: false, broken: 'tr-01: chain refused', hops: [{ nodeId: 'n2', name: 'tr-01', applied: false, online: true, broken: 'chain refused' }] } } })
    renderApp(<CascadesPage />, { route: '/cascades' })
    await screen.findByText('ядро отказало: chain refused')
    expect(screen.getByText(/Каскад сломан: tr-01: chain refused/)).toBeTruthy()
  })

  it('enabling sends one key, a refusal stays under the card with the way to the node', async () => {
    const s = server({
      'GET /api/cascades': { body: { cascades: [cascade({ enabled: false })], fields: [] } },
      'PUT /api/cascades/c1': { status: 409, body: { error: 'ENTRY_CANNOT_CHAIN', message: 'на de-01 нет sing-box' } },
    })
    renderApp(<CascadesPage />, { route: '/cascades' })
    await userEvent.click(await screen.findByRole('switch', { name: 'Выключен' }))
    await screen.findByText(/Сервер не включил каскад/)
    expect(screen.getByRole('link', { name: 'Открыть ноду' }).getAttribute('href')).toBe('/nodes/n1')
    expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/cascades/c1', body: { enabled: true } }])
    expect((screen.getByRole('switch', { name: 'Выключен' }) as HTMLInputElement).checked).toBe(false)
  })

  it('switching off asks first', async () => {
    const s = server({ 'PUT /api/cascades/c1': { body: cascade({ enabled: false }) } })
    renderApp(<CascadesPage />, { route: '/cascades' })
    await userEvent.click(await screen.findByRole('switch', { name: 'Включён' }))
    const ask = await screen.findByRole('dialog')
    expect(s.writes()).toEqual([])
    await userEvent.click(within(ask).getByRole('button', { name: 'Выключить' }))
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/cascades/c1', body: { enabled: false } }]))
  })

  it('F-K6: delete names squads, users and burning tags before it sends', async () => {
    const s = server({ 'DELETE /api/cascades/c1': { status: 204, body: {} } })
    renderApp(<CascadesPage />, { route: '/cascades' })
    await screen.findByText(/premium, до 5 юзеров/)
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/premium \(5\)/)
    expect(ask.textContent).toMatch(/Теги 1, 2 сгорят/)
    expect(s.writes()).toEqual([])
    await userEvent.click(within(ask).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'DELETE', path: '/api/cascades/c1', body: undefined }]))
  })

  it('a chip and a list view read the same rows', async () => {
    server()
    renderApp(<CascadesPage />, { route: '/cascades' })
    await screen.findByText('tr-01')
    await userEvent.click(screen.getByRole('radio', { name: 'Список' }))
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'a4-test' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Выключены/ }))
    await screen.findByText('Под эти условия каскадов нет.')
  })
})
