// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProfilesPage from '@/contours/profiles/screens/ProfilesPage'
import { renderApp, stubServer } from '@/test/app'

const profile = (over: object = {}) => ({ id: 'p1', name: 'vless-1', protocol: 'xray', engine: null, effectiveEngine: 'xray', description: null, config: {}, enabled: true, awgProtocol: null, bindingCount: 1, userCount: 12, ...over })

const server = (over: Record<string, object> = {}) =>
  stubServer({
    'GET /api/profiles': { body: { profiles: [profile(), profile({ id: 'p2', name: 'hy-1', protocol: 'hysteria', effectiveEngine: 'hysteria', bindingCount: 0, userCount: 0 })] } },
    'GET /api/profile-node-bindings': { body: { bindings: [{ id: 'b1', profileId: 'p1', nodeId: 'n1', port: 443 }] } },
    'GET /api/bindings': { body: { bindings: [{ id: 'b1', profileId: 'p1', nodeId: 'n1', port: 443 }] } },
    'GET /api/hosts': { body: { hosts: [{ id: 'h1', bindingId: 'b1', remark: 'Direct' }] } },
    ...over,
  })

afterEach(() => vi.unstubAllGlobals())

describe('ProfilesPage', () => {
  it('загрузка', () => {
    server()
    renderApp(<ProfilesPage />, { route: '/profiles' })
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: a failed list is a failure, not "no profiles"', async () => {
    server({ 'GET /api/profiles': { status: 500, body: {} } })
    renderApp(<ProfilesPage />, { route: '/profiles' })
    await screen.findByText('Профили не загрузились', {}, { timeout: 8000 })
    expect(screen.queryByText('Профилей пока нет')).toBeNull()
  })

  it('пусто: says what a profile is and offers to create', async () => {
    server({ 'GET /api/profiles': { body: { profiles: [] } } })
    renderApp(<ProfilesPage />, { route: '/profiles' })
    await screen.findByText('Профилей пока нет')
  })

  it('не проверено: hosts that did not come are unknown, and the chip counts nobody', async () => {
    server({ 'GET /api/hosts': { status: 500, body: {} } })
    renderApp(<ProfilesPage />, { route: '/profiles' })
    await screen.findByText('vless-1')
    expect(screen.getAllByText(/хостов: неизвестно/).length).toBeGreaterThan(0)
  })

  it('offers the frame columns and filters those without hosts', async () => {
    server()
    renderApp(<ProfilesPage />, { route: '/profiles' })
    await screen.findByText('vless-1')
    await screen.findByText(/хостов: 1/)
    await userEvent.click(screen.getByRole('button', { name: /Без хостов/ }))
    expect(screen.queryByText('vless-1')).toBeNull()
    expect(screen.getByText('hy-1')).toBeTruthy()
  })
})
