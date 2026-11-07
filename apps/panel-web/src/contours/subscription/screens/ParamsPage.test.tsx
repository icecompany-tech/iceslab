// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ParamsPage from '@/contours/subscription/screens/ParamsPage'
import { renderApp, stubServer } from '@/test/app'

const settings = (over: object = {}) => ({ brandName: 'Iceslab', subscriptionProfileTitle: null, subscriptionUpdateIntervalHours: 24, subscriptionSupportUrl: null, subscriptionAnnounceTemplate: null, subscriptionRoutingPreset: 'proxy-all', subscriptionTlsFragment: false, subscriptionDefaultFormat: 'plain', subscriptionLinkShape: 'per-exit', subscriptionDeadTexts: null, subscriptionPublicHost: null, subscriptionPathPrefix: '/sub', subscriptionActiveCount: 5944, ...over })

const server = (over: Parameters<typeof stubServer>[0] = {}) =>
  stubServer({
    'GET /api/settings': { body: settings() },
    'GET /api/settings/subscription/preview-url': { body: { url: '/sub/preview-token' } },
    'PUT /api/settings': { body: { ok: true, updated: [] } },
    ...over,
  })

const saveButton = () => screen.findByRole('button', { name: 'Сохранить' }) as Promise<HTMLButtonElement>

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('ParamsPage', () => {
  it('загрузка', () => {
    server()
    renderApp(<ParamsPage />)
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: the settings say so and retry', async () => {
    server({ 'GET /api/settings': { status: 500, body: {} } })
    renderApp(<ParamsPage />)
    await screen.findByText('Настройки не загрузились', {}, { timeout: 8000 })
  })

  it('пусто: empty values read as omitted headers, the brand fills the title', async () => {
    server()
    renderApp(<ParamsPage />)
    await screen.findByText('Что получает клиент')
    expect(screen.getAllByText('заголовок не отдаётся').length).toBe(2)
    expect(screen.getByText(/Iceslab/)).toBeTruthy()
  })

  it('не проверено: the address says it is not checked until asked', async () => {
    server()
    renderApp(<ParamsPage />)
    await screen.findByText('Адрес не проверен.')
  })

  it('untouched form sends nothing, a change sends only itself', async () => {
    const s = server()
    renderApp(<ParamsPage />)
    const save = await saveButton()
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Название профиля/), { target: { value: 'Ice' } })
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/settings', body: { subscriptionProfileTitle: 'Ice' } }]))
    await waitFor(() => expect(save.disabled).toBe(true))
  })

  it('F-11: a javascript link is refused at the field before any request', async () => {
    const s = server()
    renderApp(<ParamsPage />)
    fireEvent.change(await screen.findByLabelText(/Ссылка на поддержку/), { target: { value: 'javascript:alert(1)' } })
    await screen.findByText(/Только https:\/\/, http:\/\/ или tg:\/\//)
    expect((await saveButton()).disabled).toBe(true)
    expect(s.writes()).toEqual([])
    fireEvent.change(screen.getByLabelText(/Ссылка на поддержку/), { target: { value: 'tg://resolve?domain=x' } })
    await waitFor(async () => expect((await saveButton()).disabled).toBe(false))
  })

  it('a domain change warns with the count before the save', async () => {
    server()
    renderApp(<ParamsPage />)
    fireEvent.change(await screen.findByLabelText(/Публичный домен/), { target: { value: 'sub.example.com' } })
    await screen.findByText(/Действующих подписок на этом адресе: 5/)
  })

  it('a count the server did not send reads as unknown, not as nobody', async () => {
    server({ 'GET /api/settings': { body: settings({ subscriptionActiveCount: undefined }) } })
    renderApp(<ParamsPage />)
    fireEvent.change(await screen.findByLabelText(/Публичный домен/), { target: { value: 'sub.example.com' } })
    await screen.findByText(/сервер не сказал/)
  })

  it('the probe tells the route from an html page and from silence', async () => {
    server({ 'POST /api/settings/subscription/probe': { body: { ok: false, status: 200, ms: 40, url: 'https://a/sub/x', tlsExpiresAt: null, checkedAt: '2026-11-06T00:00:00Z', error: 'html' } } })
    renderApp(<ParamsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Проверить адрес' }))
    await screen.findByText(/клиенты получат не конфиги/)
  })

  it('a preview link not issued fails only its column, the form lives', async () => {
    server({ 'GET /api/settings/subscription/preview-url': { status: 500, body: {} } })
    renderApp(<ParamsPage />)
    await screen.findByText(/Ссылка предпросмотра не выдана/, {}, { timeout: 8000 })
    expect(screen.getByLabelText(/Название профиля/)).toBeTruthy()
  })

  it('a refused save stays on screen, the form keeps the edit', async () => {
    server({ 'PUT /api/settings': { status: 400, body: { error: 'INVALID', message: 'bad host' } } })
    renderApp(<ParamsPage />)
    fireEvent.change(await screen.findByLabelText(/Публичный домен/), { target: { value: 'x y' } })
    await userEvent.click(await saveButton())
    await screen.findByText(/bad host/)
    expect((screen.getByLabelText(/Публичный домен/) as HTMLInputElement).value).toBe('x y')
  })

  it('dead texts edit one language and keep the other', async () => {
    const s = server({ 'GET /api/settings': { body: settings({ subscriptionDeadTexts: { expired: { en: 'over' } } }) } })
    renderApp(<ParamsPage />)
    fireEvent.change(await screen.findByLabelText('Срок закончился'), { target: { value: 'всё' } })
    await userEvent.click(await saveButton())
    await waitFor(() => expect(s.writes()[0]?.body).toEqual({ subscriptionDeadTexts: { expired: { ru: 'всё', en: 'over' } } }))
  })
})
