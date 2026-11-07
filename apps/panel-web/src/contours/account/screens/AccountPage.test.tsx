// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OFFER_KEY } from '@/contours/account/lib/revokeOffer'
import AccountPage from '@/contours/account/screens/AccountPage'
import { renderApp, stubServer } from '@/test/app'

const token = (over: object = {}) => ({ id: 't1', name: 'bot', scopes: ['users:read'], lastUsedAt: '2026-11-05T10:00:00Z', createdAt: '2026-11-01T00:00:00Z', ...over })

const server = (over: Parameters<typeof stubServer>[0] = {}) =>
  stubServer({
    'GET /api/api-tokens': { body: { tokens: [token(), token({ id: 't2', name: 'root', scopes: [], lastUsedAt: null })] } },
    'GET /api/auth/2fa/status': { body: { enabled: false } },
    ...over,
  })

function Login() {
  const location = useLocation()
  return <div>login {JSON.stringify(location.state)}</div>
}

const page = () =>
  renderApp(
    <Routes>
      <Route path="/account" element={<AccountPage />} />
      <Route path="/login" element={<Login />} />
    </Routes>,
    { route: '/account' },
  )

const memory = new Map<string, string>()

beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) })
})
afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('AccountPage', () => {
  it('загрузка', () => {
    server()
    page()
    expect(screen.getAllByRole('status')[0]?.textContent).toMatch(/Загружаем/)
  })

  it('сбой: tokens that did not arrive are not "no tokens"; a failed 2FA status never says off', async () => {
    server({ 'GET /api/api-tokens': { status: 500, body: {} }, 'GET /api/auth/2fa/status': { status: 500, body: {} } })
    page()
    await screen.findByText('Токены не загрузились', {}, { timeout: 8000 })
    await screen.findByText(/Состояние 2FA не загрузилось/, {}, { timeout: 8000 })
    expect(screen.queryByText('Токенов пока нет')).toBeNull()
    expect(screen.queryByText('Выключена')).toBeNull()
  })

  it('пусто: no tokens invites one', async () => {
    server({ 'GET /api/api-tokens': { body: { tokens: [] } } })
    page()
    await screen.findByText('Токенов пока нет')
  })

  it('не проверено: the password button waits for the 2FA status, it decides whether a code is asked', async () => {
    server({ 'GET /api/auth/2fa/status': { status: 500, body: {} } })
    page()
    expect((await screen.findByRole('button', { name: 'Сменить пароль' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('tokens: a legacy empty list reads as full access, a named one by count', async () => {
    server()
    page()
    await screen.findByText('root')
    expect(screen.getByText('полный доступ')).toBeTruthy()
    expect(screen.getByText('прав: 1')).toBeTruthy()
    expect(screen.getByText('ни разу')).toBeTruthy()
  })

  it('F-K6: revoke says the last use and that it does not come back', async () => {
    const s = server({ 'DELETE /api/api-tokens/t1': { status: 204, body: {} } })
    page()
    await screen.findByText('root')
    await userEvent.click(screen.getAllByRole('button', { name: 'Отозвать' })[0] as HTMLElement)
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/Последний запрос: 05\.11\.2026/)
    expect(ask.textContent).toMatch(/Вернуть его нельзя/)
    expect(s.writes()).toEqual([])
    await userEvent.click(within(ask).getByRole('button', { name: 'Отозвать' }))
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'DELETE', path: '/api/api-tokens/t1', body: undefined }]))
  })

  it('password: the form refuses first, the server refusal lands on its field and does not sign out', async () => {
    const s = server({ 'PUT /api/auth/password': { status: 403, body: { error: 'INVALID_CURRENT_PASSWORD' } } })
    page()
    const save = (await screen.findByRole('button', { name: 'Сменить пароль' })) as HTMLButtonElement
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await screen.findByText('Нужен текущий пароль')
    expect(s.writes()).toEqual([])
    fireEvent.change(screen.getByLabelText('Текущий пароль'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText(/^Новый пароль$/), { target: { value: 'new-password' } })
    fireEvent.change(screen.getByLabelText('Новый пароль ещё раз'), { target: { value: 'new-password' } })
    await userEvent.click(save)
    await screen.findByText('Текущий пароль неверный')
    expect(screen.queryByText(/^login/)).toBeNull()
  })

  it('F-3: a change goes to the sign-in, and the account then offers to revoke with the names', async () => {
    const s = server({ 'PUT /api/auth/password': { status: 204, body: {} } })
    const first = page()
    const save = (await screen.findByRole('button', { name: 'Сменить пароль' })) as HTMLButtonElement
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('Текущий пароль'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText(/^Новый пароль$/), { target: { value: 'new-password' } })
    fireEvent.change(screen.getByLabelText('Новый пароль ещё раз'), { target: { value: 'new-password' } })
    await userEvent.click(save)
    await screen.findByText(/passwordChanged/)
    expect(screen.getByText(/"from":"\/account"/)).toBeTruthy()
    expect(s.writes()[0]?.body).toEqual({ currentPassword: 'old-password', newPassword: 'new-password' })
    first.unmount()
    page()
    await screen.findByText('Пароль сменён. Отозвать API-токены?')
    expect(screen.getByText(/Смена пароля токены не трогает/)).toBeTruthy()
  })

  it('F-3: revoke all names them and clears the offer, keep clears it too', async () => {
    memory.set(OFFER_KEY, 'true')
    const s = server({ 'DELETE /api/api-tokens/t1': { status: 204, body: {} }, 'DELETE /api/api-tokens/t2': { status: 204, body: {} } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Отозвать все' }))
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/bot \(05\.11\.2026/)
    expect(ask.textContent).toMatch(/root \(ни разу\)/)
    await userEvent.click(within(ask).getByRole('button', { name: 'Отозвать все' }))
    await waitFor(() => expect(s.writes()).toHaveLength(2))
    await waitFor(() => expect(memory.get(OFFER_KEY)).toBe('false'))
  })

  it('F-3: a partial revoke is said and the offer stays', async () => {
    memory.set(OFFER_KEY, 'true')
    server({ 'DELETE /api/api-tokens/t1': { status: 204, body: {} }, 'DELETE /api/api-tokens/t2': { status: 500, body: {} } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Отозвать все' }))
    const ask = await screen.findByRole('dialog')
    await userEvent.click(within(ask).getByRole('button', { name: 'Отозвать все' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(memory.get(OFFER_KEY)).toBe('true')
  })

  it('2FA: a wrong code at the field keeps it off and the secret on screen', async () => {
    server({ 'POST /api/auth/2fa/setup': { body: { secret: 'ABC', uri: 'otpauth://x' } }, 'POST /api/auth/2fa/enable': { status: 400, body: { error: 'INVALID_TOTP' } } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Включить 2FA' }))
    await screen.findByText('ABC')
    fireEvent.change(screen.getByLabelText('6-значный код'), { target: { value: '123456' } })
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    await screen.findByText(/Код не подошёл, 2FA осталась как была/)
    expect(screen.getByText('ABC')).toBeTruthy()
  })

  it('2FA: disabling needs a code and a window that names the price', async () => {
    const s = server({ 'GET /api/auth/2fa/status': { body: { enabled: true } }, 'POST /api/auth/2fa/disable': { status: 204, body: {} } })
    page()
    const off = (await screen.findByRole('button', { name: 'Выключить 2FA' })) as HTMLButtonElement
    expect(off.disabled).toBe(true)
    fireEvent.change(screen.getAllByLabelText('6-значный код').at(-1) as HTMLElement, { target: { value: '123456' } })
    await waitFor(() => expect(off.disabled).toBe(false))
    await userEvent.click(off)
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/Секрет сотрётся/)
    await userEvent.click(within(ask).getByRole('button', { name: 'Выключить 2FA' }))
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'POST', path: '/api/auth/2fa/disable', body: { code: '123456' } }]))
  })

  it('with 2FA on the password asks for its code', async () => {
    server({ 'GET /api/auth/2fa/status': { body: { enabled: true } } })
    page()
    await waitFor(() => expect(screen.getAllByLabelText('6-значный код')).toHaveLength(2))
  })
})
