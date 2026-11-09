// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Topbar } from '@/app/shell/Topbar'
import { renderApp, stubServer } from '@/test/app'

// Vite defines the build version; the test run has no define, so it gets one here.
Object.assign(globalThis, { __APP_VERSION__: '0.4.0' })
const VERSION = { 'GET /api/system/version': { body: { current: '0.4.0', latest: null, updateAvailable: false, releaseUrl: null, stars: 19 } } }

afterEach(() => vi.unstubAllGlobals())

describe('the top bar, Paper AS2-0', () => {
  it('во время загрузки имя панели пустое, без имени продукта (owner 10.11)', async () => {
    stubServer({ ...VERSION, 'GET /api/settings/public': { hold: true } })
    renderApp(<Topbar title="Юзеры" />)
    await screen.findByText('19')
    expect(screen.getByRole('banner').textContent).not.toContain('Iceslab')
  })

  it('shows the name the server gives', async () => {
    stubServer({ ...VERSION, 'GET /api/settings/public': { body: { brandName: 'Slab' } } })
    renderApp(<Topbar title="Юзеры" />)
    await screen.findByText('Slab')
  })

  it('при сбое или пустом ответе имя продукта', async () => {
    stubServer({ ...VERSION, 'GET /api/settings/public': { status: 500, body: { error: 'INTERNAL' } } })
    renderApp(<Topbar title="Юзеры" />)
    await screen.findByText('Iceslab')
  })

  it('Telegram by default, the channels with no address hidden, no server chip when versions agree', async () => {
    stubServer({ ...VERSION, 'GET /api/settings/public': { body: {} } })
    renderApp(<Topbar title="Юзеры" />)
    await screen.findByText('19')
    expect(screen.getByRole('link', { name: 'Telegram' }).getAttribute('href')).toBe('https://t.me/+XgrJWvUUggxlNGUy')
    expect(screen.getByRole('link', { name: 'GitHub' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Discord' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Документация' })).toBeNull()
    expect(screen.queryByText('Поддержать')).toBeNull()
    expect(screen.queryByText(/^сервер v/)).toBeNull()
  })

  it('names the server version when it differs from the build (F-7)', async () => {
    stubServer({ 'GET /api/system/version': { body: { current: '0.3.1', latest: null, updateAvailable: false, releaseUrl: null, stars: null } }, 'GET /api/settings/public': { body: {} } })
    renderApp(<Topbar title="Юзеры" />)
    await screen.findByText('сервер v0.3.1')
  })
})
