// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '@/contours/settings/screens/SettingsPage'
import { renderApp, stubServer } from '@/test/app'

const server = (over: Parameters<typeof stubServer>[0] = {}) =>
  stubServer({
    'GET /api/settings': { body: { brandName: 'Ice' } },
    'GET /api/regions': { body: { regions: [{ id: 'r1', name: 'Europe', code: 'EU', nodeCount: 2 }, { id: 'r2', name: 'Asia', code: 'AS' }] } },
    'GET /api/recipes/sources': { body: { sources: [{ id: 's1', name: 'Official', url: 'https://x/index.json', enabled: true, trusted: true }] } },
    'GET /api/system/version': { body: { current: '9.9.9', latest: null, updateAvailable: false, releaseUrl: null, stars: null, checkedAt: null } },
    'PUT /api/settings': { body: { ok: true, updated: [] } },
    ...over,
  })

beforeEach(() => vi.stubGlobal('__APP_VERSION__', '9.9.9'))
afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('SettingsPage', () => {
  it('загрузка', () => {
    server()
    renderApp(<SettingsPage />)
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })

  it('сбой: a failed list stays that, and no empty name field to save over the real one', async () => {
    server({ 'GET /api/settings': { status: 500, body: {} }, 'GET /api/regions': { status: 500, body: {} } })
    renderApp(<SettingsPage />)
    await screen.findByText(/Настройки не загрузились/, {}, { timeout: 8000 })
    await screen.findByText(/Регионы не загрузились/, {}, { timeout: 8000 })
    expect(screen.queryByLabelText(/^Название панели/)).toBeNull()
    expect(screen.queryByText(/Регионов нет/)).toBeNull()
  })

  it('пусто: no regions and no sources say so', async () => {
    server({ 'GET /api/regions': { body: { regions: [] } }, 'GET /api/recipes/sources': { body: { sources: [] } } })
    renderApp(<SettingsPage />)
    await screen.findByText(/Регионов нет/)
    await screen.findByText('Источников пока нет.')
  })

  it('не проверено: an unknown latest and an unknown node count are said, not zero', async () => {
    server()
    renderApp(<SettingsPage />)
    await screen.findByText('неизвестно: проверка не прошла')
    await screen.findByText('Asia')
    await userEvent.click(screen.getAllByRole('button', { name: 'Удалить' })[1] as HTMLElement)
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/сервер не сказал/)
  })

  it('F-7: different versions are said in words', async () => {
    server({ 'GET /api/system/version': { body: { current: '0.3.1', latest: '0.3.2', updateAvailable: true, releaseUrl: 'https://r', stars: null, checkedAt: null } } })
    renderApp(<SettingsPage />)
    await screen.findByText(/разных версий/)
    expect(screen.getByText(/Доступен выпуск 0\.3\.2/)).toBeTruthy()
  })

  it('the name: untouched sends nothing, emptied is refused, a change sends only itself', async () => {
    const s = server()
    renderApp(<SettingsPage />)
    const field = await screen.findByLabelText(/^Название панели/)
    const save = screen.getAllByRole('button', { name: 'Сохранить' })[0] as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(field, { target: { value: ' ' } })
    await screen.findByText('Название не может быть пустым.')
    expect(save.disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'Slab' } })
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/settings', body: { brandName: 'Slab' } }]))
  })

  it('the language stores defaultLocale and a failed store is said', async () => {
    const setLocale = vi.fn()
    const { LocaleProvider } = await import('@/lib/i18n')
    const s = server({ 'PUT /api/settings': { status: 500, body: {} } })
    renderApp(
      <LocaleProvider locale="ru" setLocale={setLocale}>
        <SettingsPage />
      </LocaleProvider>,
    )
    await userEvent.click(await screen.findByRole('radio', { name: 'English' }))
    expect(setLocale).toHaveBeenCalledWith('en')
    await waitFor(() => expect(s.writes()[0]?.body).toEqual({ defaultLocale: 'en' }))
    await screen.findByText(/сервер не сохранил язык/)
  })

  it('regions: create, a taken code at its field, rename sends only the name', async () => {
    const s = server({ 'POST /api/regions': { status: 409, body: { error: 'CONFLICT', field: 'code', message: 'Код занят' } }, 'PUT /api/regions/r1': { body: { id: 'r1', name: 'EU2', code: 'EU' } } })
    renderApp(<SettingsPage />)
    await screen.findByText('Europe')
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'New' } })
    fireEvent.change(screen.getByLabelText('Код'), { target: { value: 'eu' } })
    await userEvent.click(screen.getAllByRole('button', { name: 'Добавить' })[0] as HTMLElement)
    await screen.findByText('Код занят')
    expect(s.writes()[0]?.body).toEqual({ name: 'New', code: 'EU' })
    await userEvent.click(screen.getAllByRole('button', { name: 'Править' })[0] as HTMLElement)
    const nameFields = screen.getAllByLabelText('Имя')
    fireEvent.change(nameFields[0] as HTMLElement, { target: { value: 'EU2' } })
    await userEvent.click(screen.getAllByRole('button', { name: 'Сохранить' })[1] as HTMLElement)
    await waitFor(() => expect(s.writes()[1]).toEqual({ method: 'PUT', path: '/api/regions/r1', body: { name: 'EU2' } }))
  })

  it('F-K6: deleting a region says how many nodes lose it', async () => {
    const s = server({ 'DELETE /api/regions/r1': { status: 204, body: {} } })
    renderApp(<SettingsPage />)
    await screen.findByText('Europe')
    await userEvent.click(screen.getAllByRole('button', { name: 'Удалить' })[0] as HTMLElement)
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/Ноды \(2\) останутся/)
    expect(s.writes()).toEqual([])
    await userEvent.click(within(ask).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'DELETE', path: '/api/regions/r1', body: undefined }]))
  })

  it('F-K6: deleting a source says profiles stay, the switch sends one key', async () => {
    const s = server({ 'PATCH /api/recipes/sources/s1': { body: {} } })
    renderApp(<SettingsPage />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Источник Official включён' }))
    await waitFor(() => expect(s.writes()[0]?.body).toEqual({ enabled: false }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Удалить' }).at(-1) as HTMLElement)
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/Профили, созданные по ним, останутся/)
  })
})
