// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import OutboundsPage from '@/contours/traffic/screens/OutboundsPage'
import { renderApp, stubServer } from '@/test/app'

const UUID = '0f0c5a7e-2a31-4e6b-9f0a-3c1d2e4f5a6b'
const base = { countryCode: null, usedBy: [], createdAt: '', updatedAt: '' }
const vless = { ...base, id: 'v', name: 'de-exit', type: 'vless', countryCode: 'DE', config: { server: 'de.example.com', port: 443, uuid: UUID, flow: 'xtls-rprx-vision', security: 'tls', sni: 'de.example.com' } }
const socks = { ...base, id: 's', name: 'proxy', type: 'socks', config: { server: '1.2.3.4', port: 1080, username: 'u', password: 'p' }, usedBy: [{ cascadeId: 'c1', cascadeName: 'a4', directionTag: 2 }] }
const free = { ...base, id: 'f', name: 'free', type: 'freedom', config: {} }

const server = (over: Parameters<typeof stubServer>[0] = {}) => stubServer({ 'GET /api/named-outbounds': { body: { outbounds: [vless, socks, free] } }, ...over })

vi.setConfig({ testTimeout: 20_000 })

describe('OutboundsPage', () => {
  it('загрузка', () => {
    server()
    renderApp(<OutboundsPage />)
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: a list that did not arrive is said', async () => {
    server({ 'GET /api/named-outbounds': { status: 500, body: {} } })
    renderApp(<OutboundsPage />)
    await screen.findByText('Список выходов не загрузился', {}, { timeout: 8000 })
    expect(screen.queryByText('Выходов пока нет')).toBeNull()
  })

  it('пусто: says when one is needed', async () => {
    server({ 'GET /api/named-outbounds': { body: { outbounds: [] } } })
    renderApp(<OutboundsPage />)
    await screen.findByText('Выходов пока нет')
  })

  it('не проверено: nothing is said about a server the panel does not reach, the row shows only what is stored', async () => {
    server()
    renderApp(<OutboundsPage />)
    await screen.findByText('de.example.com:443 · tls · vision')
    expect(screen.getByText('1.2.3.4:1080 · с логином')).toBeTruthy()
    expect(screen.queryByText(/онлайн|работает/)).toBeNull()
  })

  it('freedom is import only, its window keeps the type', async () => {
    server()
    renderApp(<OutboundsPage />)
    await screen.findByText('только импортом')
    await userEvent.click(screen.getByRole('button', { name: 'Открыть выход free' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('radio', { name: 'vless' })).toBeNull()
    expect(within(dialog).getByText(/правятся только имя и страна/)).toBeTruthy()
  })

  it('create: refusals at the field before any request, then the body by type', async () => {
    const s = server({ 'POST /api/named-outbounds': { status: 201, body: vless } })
    renderApp(<OutboundsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Новый выход' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }))
    await within(dialog).findByText(/Имя: строчные латинские/)
    expect(s.writes()).toEqual([])
    fireEvent.change(within(dialog).getByLabelText(/^Имя/), { target: { value: 'de-2' } })
    fireEvent.change(within(dialog).getByLabelText('Сервер'), { target: { value: 'de.example.com' } })
    fireEvent.change(within(dialog).getByLabelText('Порт'), { target: { value: '443' } })
    fireEvent.change(within(dialog).getByLabelText('UUID'), { target: { value: UUID } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }))
    await waitFor(() => expect(s.writes()).toHaveLength(1))
    expect(s.writes()[0]?.body).toEqual({ name: 'de-2', type: 'vless', config: { server: 'de.example.com', port: 443, uuid: UUID, flow: null, security: 'none' } })
  })

  it('REALITY: a bad key refuses at its field', async () => {
    const s = server()
    renderApp(<OutboundsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Новый выход' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'reality' }))
    fireEvent.change(within(dialog).getByLabelText('Публичный ключ REALITY'), { target: { value: 'short' } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }))
    await within(dialog).findByText(/Ключ REALITY: 43 знака/)
    await within(dialog).findByText(/REALITY нужен SNI/)
    expect(s.writes()).toEqual([])
  })

  it('SOCKS: the password is behind the eye, a login with no password refuses, the honest note is there', async () => {
    const s = server()
    renderApp(<OutboundsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Новый выход' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'socks' }))
    await within(dialog).findByText(/SOCKS сам ничего не шифрует/)
    expect(within(dialog).getByLabelText('Пароль').getAttribute('type')).toBe('password')
    fireEvent.change(within(dialog).getByLabelText(/^Имя/), { target: { value: 'pr' } })
    fireEvent.change(within(dialog).getByLabelText('Сервер'), { target: { value: '1.2.3.4' } })
    fireEvent.change(within(dialog).getByLabelText('Порт'), { target: { value: '1080' } })
    fireEvent.change(within(dialog).getByLabelText('Логин'), { target: { value: 'u' } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }))
    await within(dialog).findByText('Логин и пароль вместе или никак.')
    expect(s.writes()).toEqual([])
  })

  it('edit is a click on the row; untouched sends nothing and closes', async () => {
    const s = server()
    renderApp(<OutboundsPage />)
    await userEvent.click(await screen.findByText('de.example.com:443 · tls · vision'))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(s.writes()).toEqual([])
  })

  it('edit sends only what changed; a taken name stays at the field', async () => {
    const s = server({ 'PUT /api/named-outbounds/v': { status: 409, body: { error: 'NAMED_OUTBOUND_NAME_TAKEN', name: 'proxy' } } })
    renderApp(<OutboundsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Открыть выход de-exit' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Имя/), { target: { value: 'proxy' } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
    await within(dialog).findByText('Имя «proxy» уже занято другим выходом.')
    expect(s.writes()[0]?.body).toEqual({ name: 'proxy' })
  })

  it('a server refusal by field lands under that field', async () => {
    server({ 'PUT /api/named-outbounds/v': { status: 400, body: { error: 'VALIDATION', issues: [{ path: ['config', 'sni'], message: 'bad sni' }] } } })
    renderApp(<OutboundsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Открыть выход de-exit' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('SNI'), { target: { value: 'x.ru' } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
    await within(dialog).findByText('bad sni')
  })

  it('in a cascade: delete opens "not yet" with the direction and the way there, nothing sent', async () => {
    const s = server()
    renderApp(<OutboundsPage />)
    await screen.findByRole('button', { name: 'Открыть выход proxy' })
    await userEvent.click(screen.getAllByRole('button', { name: 'Удалить' })[1] as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/Пока не удалить/)
    expect(dialog.textContent).toMatch(/a4, направление 2/)
    expect(within(dialog).getByRole('link', { name: 'Открыть каскад' }).getAttribute('href')).toBe('/cascades/c1')
    expect(s.writes()).toEqual([])
  })

  it('free: delete asks, the server still may say it is in use', async () => {
    const s = server({ 'DELETE /api/named-outbounds/v': { status: 409, body: { error: 'NAMED_OUTBOUND_IN_USE', usedBy: [{ cascadeId: 'c9', cascadeName: 'late', directionTag: 1 }] } } })
    renderApp(<OutboundsPage />)
    await screen.findByRole('button', { name: 'Открыть выход de-exit' })
    await userEvent.click(screen.getAllByRole('button', { name: 'Удалить' })[0] as HTMLElement)
    const ask = await screen.findByRole('dialog')
    await userEvent.click(within(ask).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(s.writes()).toHaveLength(1))
    const blocked = await screen.findByText(/late, направление 1/)
    expect(blocked).toBeTruthy()
  })
})
