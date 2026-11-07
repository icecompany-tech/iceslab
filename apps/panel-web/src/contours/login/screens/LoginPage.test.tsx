// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LoginPage from '@/contours/login/screens/LoginPage'
import { renderApp, stubServer } from '@/test/app'

const STATUS = { 'GET /api/auth/status': { body: { registration: { enabled: false } } }, 'GET /api/settings/public': { body: { brandName: 'Iceslab' } } }
const ADMIN = { id: '1', username: 'admin', role: 'admin' }

function page(state?: unknown) {
  return renderApp(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<div>home</div>} />
    </Routes>,
    { route: '/login', state },
  )
}

const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText('Имя'), 'admin')
  await user.type(screen.getByLabelText('Пароль'), 'secret-pass')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('sign-in', () => {
  it('загрузка: while the status is out there is no form', async () => {
    stubServer(STATUS)
    page()
    expect(screen.getByRole('status').textContent).toMatch(/Спрашиваем/)
    expect(await screen.findByRole('heading', { name: 'Вход в Iceslab' })).toBeTruthy()
  })

  it('сбой: a failed status is not "registration closed", it says so and retries', async () => {
    const server = stubServer({ 'GET /api/auth/status': { status: 500 }, 'GET /api/settings/public': { body: {} } })
    page()
    await screen.findByRole('heading', { name: 'Сервер панели не ответил' })
    expect(screen.queryByLabelText('Пароль')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(server.sent.filter((r) => r.path === '/api/auth/status').length).toBeGreaterThan(1))
  })

  it('пусто: there is no admin, the screen names the command and shows no form', async () => {
    stubServer({ ...STATUS, 'GET /api/auth/status': { body: { registration: { enabled: true } } } })
    page()
    await screen.findByRole('heading', { name: 'Админа ещё нет' })
    expect(screen.getByText('bash /opt/iceslab/scripts/iceslab.sh first-admin')).toBeTruthy()
    expect(screen.queryByLabelText('Пароль')).toBeNull()
    expect(screen.queryByRole('button', { name: /Создать/ })).toBeNull()
  })

  it('не проверено: the form is closed until there is something to send', async () => {
    stubServer(STATUS)
    page()
    expect((await screen.findByRole('button', { name: 'Войти' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('signs in and goes home, and stores no token anywhere', async () => {
    const server = stubServer({ ...STATUS, 'POST /api/auth/login': { body: { admin: ADMIN, token: 'jwt-value' } } })
    const user = userEvent.setup()
    page()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    await screen.findByText('home')
    expect(server.writes()[0]?.body).toEqual({ username: 'admin', password: 'secret-pass' })
    expect(JSON.stringify({ ...localStorage })).not.toContain('jwt-value')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('jwt-value')
  })

  it('a wrong password is said at the field, not in a toast', async () => {
    stubServer({ ...STATUS, 'POST /api/auth/login': { status: 401, body: { error: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } } })
    const user = userEvent.setup()
    page()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    await screen.findByText('Неверное имя или пароль')
    expect(screen.getByLabelText('Пароль').getAttribute('aria-invalid')).toBe('true')
  })

  it('a lockout counts down on the button and opens by itself', async () => {
    stubServer({ ...STATUS, 'POST /api/auth/login': { status: 429, body: { error: 'ACCOUNT_LOCKED', retryAfterSeconds: 2 } } })
    const user = userEvent.setup()
    page()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    const closed = await screen.findByRole('button', { name: /Вход закрыт, ещё 2 с/ })
    expect((closed as HTMLButtonElement).disabled).toBe(true)
    await screen.findByText('Слишком много попыток. Форма откроется сама.')
    await screen.findByRole('button', { name: 'Войти' }, { timeout: 3000 })
    expect(screen.queryByText('Слишком много попыток. Форма откроется сама.')).toBeNull()
  })

  it('two-factor is a step of its own, and a wrong code is said at the code', async () => {
    let attempt = 0
    const server = stubServer({
      ...STATUS,
      'POST /api/auth/login': () => {
        attempt += 1
        if (attempt === 1) return { status: 401, body: { error: 'TOTP_REQUIRED', requires2fa: true } }
        if (attempt === 2) return { status: 401, body: { error: 'INVALID_TOTP', requires2fa: true } }
        return { body: { admin: ADMIN } }
      },
    })
    const user = userEvent.setup()
    page()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    await screen.findByRole('heading', { name: 'Код подтверждения' })
    const confirm = screen.getByRole('button', { name: 'Подтвердить' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await user.type(screen.getByLabelText('Код из приложения'), '41x8205')
    expect(confirm.disabled).toBe(false)
    await user.click(confirm)
    await screen.findByText('Неверный код, попробуйте ещё раз')
    await user.click(confirm)
    await screen.findByText('home')
    expect(server.writes().at(-1)?.body).toEqual({ username: 'admin', password: 'secret-pass', totpCode: '418205' })
  })

  it('goes back from the code to the password', async () => {
    stubServer({ ...STATUS, 'POST /api/auth/login': { status: 401, body: { error: 'TOTP_REQUIRED' } } })
    const user = userEvent.setup()
    page()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    await user.click(await screen.findByRole('button', { name: 'Назад ко входу' }))
    expect(screen.getByLabelText('Пароль')).toBeTruthy()
  })

  it('a server error shows the words of the server, not a status line', async () => {
    stubServer({ ...STATUS, 'POST /api/auth/login': { status: 500, body: { message: 'Database is down' } } })
    const user = userEvent.setup()
    page()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    await screen.findByText('Database is down')
  })

  it('F-2: says the server did not confirm the sign-out', async () => {
    stubServer(STATUS)
    page({ notice: 'logoutUnconfirmed' })
    expect((await screen.findByRole('alert')).textContent).toMatch(/не подтвердил выход/)
  })

  it('says the password was changed', async () => {
    stubServer(STATUS)
    page({ notice: 'passwordChanged' })
    await screen.findByText('Пароль изменён, войдите заново.')
  })
})
