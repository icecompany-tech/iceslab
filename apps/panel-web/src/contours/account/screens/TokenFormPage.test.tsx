// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TokenFormPage from '@/contours/account/screens/TokenFormPage'
import { renderApp, stubServer } from '@/test/app'

const issued = { id: 't', name: 'bot', scopes: ['users:read'], lastUsedAt: null, createdAt: '2026-11-06T00:00:00Z', token: 'icp_secret' }
const page = () =>
  renderApp(
    <Routes>
      <Route path="/account/tokens/new" element={<TokenFormPage />} />
      <Route path="/account" element={<div>account</div>} />
    </Routes>,
    { route: '/account/tokens/new' },
  )
const issue = () => screen.getByRole('button', { name: 'Выпустить' }) as HTMLButtonElement

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('TokenFormPage', () => {
  it('загрузка: nothing to wait for, the form opens closed until it has a name', () => {
    stubServer({})
    page()
    expect(issue().disabled).toBe(true)
    expect(screen.getByText('Дайте токену имя.')).toBeTruthy()
  })

  it('сбой: a refused issue stays on screen, the form keeps its values', async () => {
    stubServer({ 'POST /api/api-tokens': { status: 400, body: { error: 'VALIDATION_ERROR', message: 'bad name' } } })
    page()
    fireEvent.change(screen.getByLabelText(/Имя/), { target: { value: 'bot' } })
    await userEvent.click(issue())
    await screen.findByText(/bad name/)
    expect((screen.getByLabelText(/Имя/) as HTMLInputElement).value).toBe('bot')
  })

  it('пусто: B3: a manual pick with nothing closes the button and sends nothing', async () => {
    const s = stubServer({})
    page()
    fireEvent.change(screen.getByLabelText(/Имя/), { target: { value: 'bot' } })
    await userEvent.click(screen.getByRole('radio', { name: /Вручную/ }))
    for (const scope of ['Юзеры: Чтение', 'Юзеры: Запись', 'Ссылки подписки юзера: Чтение', 'Сквады: Чтение']) await userEvent.click(screen.getByRole('checkbox', { name: scope }))
    await screen.findByText(/токен без прав не выпускается/)
    expect(issue().disabled).toBe(true)
    expect(s.writes()).toEqual([])
  })

  it('не проверено: per-request switches and the Monitoring set are not offered, the server cannot do them', () => {
    stubServer({})
    page()
    expect(screen.queryByText(/Мониторинг/)).toBeNull()
    expect(screen.queryByText(/GET \/api/)).toBeNull()
  })

  it('B3: full access goes as an explicit star', async () => {
    const s = stubServer({ 'POST /api/api-tokens': { body: issued } })
    page()
    fireEvent.change(screen.getByLabelText(/Имя/), { target: { value: 'root' } })
    await userEvent.click(screen.getByRole('radio', { name: /Полный админ/ }))
    await screen.findByText(/серверные ключи, в том числе будущие/ , { selector: 'p' })
    await userEvent.click(issue())
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'POST', path: '/api/api-tokens', body: { name: 'root', scopes: ['*'] } }]))
  })

  it('the default set goes as named scopes, the token shows once in a window', async () => {
    const s = stubServer({ 'POST /api/api-tokens': { body: issued } })
    page()
    fireEvent.change(screen.getByLabelText(/Имя/), { target: { value: 'bot' } })
    await userEvent.click(issue())
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/icp_secret/)
    expect(dialog.textContent).toMatch(/показать его снова не сможет/)
    expect(s.writes()[0]?.body).toEqual({ name: 'bot', scopes: ['users:read', 'users:write', 'sub:read', 'squads:read'] })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Готово, скопировал' }))
    await screen.findByText('account')
  })

  it('a manual pick sends only what is ticked', async () => {
    const s = stubServer({ 'POST /api/api-tokens': { body: issued } })
    page()
    fireEvent.change(screen.getByLabelText(/Имя/), { target: { value: 'ci' } })
    await userEvent.click(screen.getByRole('radio', { name: /Вручную/ }))
    for (const scope of ['Юзеры: Запись', 'Ссылки подписки юзера: Чтение', 'Сквады: Чтение']) await userEvent.click(screen.getByRole('checkbox', { name: scope }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ноды: Запись' }))
    await userEvent.click(issue())
    await waitFor(() => expect(s.writes()[0]?.body).toEqual({ name: 'ci', scopes: ['users:read', 'nodes:write'] }))
  })
})
