// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HostsPage from '@/contours/hosts/screens/HostsPage'
import { renderApp, stubServer } from '@/test/app'

const host = (over: object = {}) => ({ id: 'h1', bindingId: 'b1', remark: 'Direct', enabled: true, addressOverride: null, isHidden: false, hiddenByCascade: null, reach: { squads: 2, users: 1000 }, disableForFormats: [], alpn: [], securityLayer: 'default', allowInsecure: false, ...over })

const server = (over: Record<string, object> = {}) =>
  stubServer({
    'GET /api/hosts': { body: { hosts: [host(), host({ id: 'h2', remark: 'Second', bindingId: 'b2' }), host({ id: 'h3', remark: 'Off', enabled: false })] } },
    'GET /api/bindings': { body: { bindings: [{ id: 'b1', profileId: 'p1', nodeId: 'n1', port: 443 }, { id: 'b2', profileId: 'p1', nodeId: 'n2', port: 443 }] } },
    'GET /api/nodes': { body: { nodes: [{ id: 'n1', name: 'de-01', address: '91.1.1.1:1337', status: 'online', countryCode: 'DE' }, { id: 'n2', name: 'se-01', address: '92.1.1.1:1337', status: 'unreachable', countryCode: 'SE' }], total: 2 } },
    'GET /api/profiles': { body: { profiles: [{ id: 'p1', name: 'vless-1', protocol: 'xray' }] } },
    'GET /api/squads': { body: { squads: [] } },
    ...over,
  })

afterEach(() => vi.unstubAllGlobals())

describe('HostsPage', () => {
  it('загрузка', () => {
    server()
    renderApp(<HostsPage />, { route: '/hosts' })
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: not "no hosts"', async () => {
    server({ 'GET /api/hosts': { status: 500, body: {} } })
    renderApp(<HostsPage />, { route: '/hosts' })
    await screen.findByText('Хосты не загрузились', {}, { timeout: 8000 })
    expect(screen.queryByText('Хостов пока нет')).toBeNull()
  })

  it('пусто: one empty, with the button', async () => {
    server({ 'GET /api/hosts': { body: { hosts: [] } } })
    renderApp(<HostsPage />, { route: '/hosts' })
    await screen.findByText('Хостов пока нет')
    expect(screen.getByRole('button', { name: 'Создать хост' })).toBeTruthy()
  })

  it('не проверено: a freshness that did not come is unknown, not a dash', async () => {
    server({ 'GET /api/hosts/h1/freshness': { status: 500, body: {} }, 'GET /api/hosts/h2/freshness': { body: { configChangedAt: '2026-11-01T00:00:00Z', current: 1, stale: 37, total: 38, neverFetched: 2, retentionDays: 30 } }, 'GET /api/hosts/h3/freshness': { body: { configChangedAt: '2026-11-01T00:00:00Z', current: 1, stale: 0, total: 1, neverFetched: 0, retentionDays: 30 } } })
    renderApp(<HostsPage />, { route: '/hosts' })
    await screen.findByText('Direct')
    await userEvent.click(screen.getByRole('switch', { name: /На старой ссылке/ }))
    await screen.findByText('неизвестно')
    await userEvent.click(await screen.findByRole('button', { name: '37 из 38' }))
    expect((await screen.findByRole('dialog')).textContent).toMatch(/Считаем людей/)
  })

  it('asks freshness only while the column is on', async () => {
    const s = server()
    renderApp(<HostsPage />, { route: '/hosts' })
    await screen.findByText('Direct')
    expect(s.sent.some((r) => r.path.includes('freshness'))).toBe(false)
  })

  it('reads the state, the word is "не отвечает"', async () => {
    server()
    renderApp(<HostsPage />, { route: '/hosts' })
    await screen.findByText('Second')
    expect(screen.getByRole('button', { name: /Не отвечает/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Выключены/ }))
    await waitFor(() => expect(screen.queryByText('Direct')).toBeNull())
    expect(screen.getByText('Off')).toBeTruthy()
  })

  it('moving to the first place sends the whole order', async () => {
    const s = server({ 'PUT /api/hosts/reorder': { body: { hosts: [] } } })
    renderApp(<HostsPage />, { route: '/hosts' })
    await screen.findByText('Second')
    await userEvent.click(screen.getAllByRole('button', { name: 'На первое место' })[1] as HTMLElement)
    await waitFor(() => expect(s.writes()[0]?.body).toEqual({ hostIds: ['h2', 'h1', 'h3'] }))
  })
})
