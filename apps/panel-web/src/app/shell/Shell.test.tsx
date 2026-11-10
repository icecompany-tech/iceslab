// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Shell } from '@/app/shell/Shell'
import { renderApp, stubServer } from '@/test/app'

Object.assign(globalThis, { __APP_VERSION__: '0.4.0' })

function shell() {
  stubServer({
    'GET /api/system/version': { body: { current: '0.4.0', latest: null, updateAvailable: false, releaseUrl: null, stars: null } },
    'GET /api/settings/public': { body: {} },
    'GET /api/auth/me': { body: { id: '1', username: 'admin', role: 'admin' } },
    'GET /api/dashboard/overview': { hold: true },
  })
  return renderApp(
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<button type="button">in the center</button>} />
      </Route>
    </Routes>,
  )
}

const open = () => userEvent.click(screen.getByRole('button', { name: 'Открыть правую панель' }))
const panel = () => screen.queryByRole('complementary', { name: 'Правая панель' })

afterEach(() => vi.unstubAllGlobals())

describe('the right panel, Paper ZGN-0 shell/Rail/open', () => {
  it('Esc closes it', async () => {
    shell()
    await open()
    expect(panel()).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(panel()).toBeNull()
  })

  it('a press outside closes it, a press inside does not', async () => {
    shell()
    await open()
    await userEvent.click(panel() as HTMLElement)
    expect(panel()).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'in the center' }))
    expect(panel()).toBeNull()
  })

  it('its own button closes it', async () => {
    shell()
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть правую панель' }))
    expect(panel()).toBeNull()
  })

  it('lies over the center and does not narrow it: the center stays the same element, the panel outside it', async () => {
    shell()
    const main = screen.getByRole('main')
    await open()
    expect(screen.getByRole('main')).toBe(main)
    expect(main.contains(panel())).toBe(false)
    expect(screen.getByRole('button', { name: 'in the center' })).toBeTruthy()
    // The widths themselves are measured live (Playwright, 1920x945 and 1440x900): jsdom has no layout.
  })
})
