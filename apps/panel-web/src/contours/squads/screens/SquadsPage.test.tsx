// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SquadsPage from '@/contours/squads/screens/SquadsPage'
import { ALL_SQUAD_ID } from '@/lib/domain/squads'
import { renderApp, stubServer } from '@/test/app'

const squad = (over: object = {}) => ({ id: 's1', name: 'premium', description: null, profileIds: ['p1'], hostIds: ['h1'], exitAcl: [], policyIds: [], memberCount: 1204, hwidDeviceLimit: null, routingPreset: null, customRoutingPresetId: null, ...over })

const server = (over: Record<string, object> = {}) =>
  stubServer({
    'GET /api/squads': { body: { squads: [squad({ id: ALL_SQUAD_ID, name: 'All', hostIds: [] }), squad(), squad({ id: 's2', name: 'wide', hostIds: [] }), squad({ id: 's3', name: 'hollow', hostIds: [], profileIds: [], memberCount: 0 })] } },
    'GET /api/hosts': { body: { hosts: [{ id: 'h1', bindingId: 'b1', enabled: true, remark: 'A' }, { id: 'h2', bindingId: 'b1', enabled: true, remark: 'B' }] } },
    'GET /api/bindings': { body: { bindings: [{ id: 'b1', profileId: 'p1', nodeId: 'n1', port: 443 }] } },
    'GET /api/nodes': { body: { nodes: [{ id: 'n1', name: 'de-01', countryCode: 'DE' }], total: 1 } },
    'GET /api/profiles': { body: { profiles: [{ id: 'p1', name: 'vless-1' }] } },
    'GET /api/cascades': { body: { cascades: [] } },
    ...over,
  })

afterEach(() => vi.unstubAllGlobals())

describe('SquadsPage', () => {
  it('загрузка', () => {
    server()
    renderApp(<SquadsPage />, { route: '/squads' })
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: not "no squads"', async () => {
    server({ 'GET /api/squads': { status: 500, body: {} } })
    renderApp(<SquadsPage />, { route: '/squads' })
    await screen.findByText('Сквады не загрузились', {}, { timeout: 8000 })
    expect(screen.queryByText('Сквадов пока нет')).toBeNull()
  })

  it('пусто', async () => {
    server({ 'GET /api/squads': { body: { squads: [] } } })
    renderApp(<SquadsPage />, { route: '/squads' })
    await screen.findByText('Сквадов пока нет')
  })

  it('не проверено: hosts that did not come are unknown, not zero', async () => {
    server({ 'GET /api/hosts': { status: 500, body: {} } })
    renderApp(<SquadsPage />, { route: '/squads' })
    await screen.findByText('premium')
    expect(screen.getAllByText(/Хосты: неизвестно/).length).toBeGreaterThan(0)
  })

  it('shows old states in words and marks an old empty squad', async () => {
    server()
    renderApp(<SquadsPage />, { route: '/squads' })
    await screen.findByText('premium')
    await screen.findByText(/Хосты: 1 из 2/)
    expect(screen.getAllByText(/Хосты: все 2/).length).toBeGreaterThan(0)
    expect(screen.getByText('без сужения')).toBeTruthy()
    expect(screen.getByText(/пустой: снимает сужение/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Пустые/ }))
    expect(screen.queryByText('premium')).toBeNull()
    expect(screen.getByText('hollow')).toBeTruthy()
  })
})
