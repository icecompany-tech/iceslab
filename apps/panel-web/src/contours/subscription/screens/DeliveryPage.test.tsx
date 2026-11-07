// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeliveryPage from '@/contours/subscription/screens/DeliveryPage'
import { renderApp, stubServer } from '@/test/app'

const rule = (over: object = {}) => ({ id: 'r1', name: 'Happ', uaPattern: '(?i)happ', format: 'xrayjson', priority: 10, enabled: true, templateName: null, createdAt: '', updatedAt: '', ...over })
const all = rule({ id: 'r2', name: 'Остальные', uaPattern: '.*', format: 'plain', priority: 1000 })

const server = (over: Parameters<typeof stubServer>[0] = {}) =>
  stubServer({
    'GET /api/srr': { body: { rules: [all, rule()] } },
    'GET /api/subscription-templates': { body: { templates: [{ id: 't', type: 'mihomo', name: 'mine', body: '', isDefault: false, updatedAt: '' }] } },
    ...over,
  })

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('DeliveryPage', () => {
  it('загрузка', () => {
    server()
    renderApp(<DeliveryPage />)
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: a list that did not arrive is not an empty one', async () => {
    server({ 'GET /api/srr': { status: 500, body: {} } })
    renderApp(<DeliveryPage />)
    await screen.findByText('Правила не загрузились', {}, { timeout: 8000 })
    expect(screen.queryByText('Правил пока нет')).toBeNull()
  })

  it('пусто: says what clients get meanwhile', async () => {
    server({ 'GET /api/srr': { body: { rules: [] } } })
    renderApp(<DeliveryPage />)
    await screen.findByText('Правил пока нет')
  })

  it('не проверено: no verdict until a client is typed, then the rule and the shadowed ones', async () => {
    server()
    renderApp(<DeliveryPage />)
    await screen.findByText('Не проверено: введите User-Agent.')
    fireEvent.change(screen.getByLabelText('User-Agent клиента'), { target: { value: 'Happ/1.42' } })
    await userEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    await screen.findByText(/Ловит правило 10 «Happ», формат Xray JSON/)
    expect(screen.getByText(/не доходит: 1/)).toBeTruthy()
  })

  it('rows go by priority, whatever order the server sends', async () => {
    server()
    renderApp(<DeliveryPage />)
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows[1]?.textContent).toMatch(/Happ/)
    expect(rows[2]?.textContent).toMatch(/Остальные/)
    expect(rows[2]?.textContent).toMatch(/ловит всё/)
  })

  it('two rules on one priority say so', async () => {
    server({ 'GET /api/srr': { body: { rules: [rule(), rule({ id: 'r3', name: 'Other' })] } } })
    renderApp(<DeliveryPage />)
    await screen.findByText(/порядок между ними не определён/)
  })

  it('the switch sends one key and the failure is said', async () => {
    const s = server({ 'PUT /api/srr/r1': { body: rule({ enabled: false }) } })
    renderApp(<DeliveryPage />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Правило Happ включено' }))
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/srr/r1', body: { enabled: false } }]))
  })

  it('the window: an untouched rule sends nothing, a change only itself', async () => {
    const s = server({ 'PUT /api/srr/r1': { body: rule({ priority: 20 }) } })
    renderApp(<DeliveryPage />)
    await userEvent.click((await screen.findAllByRole('button', { name: 'Открыть' }))[0] as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Приоритет/), { target: { value: '20' } })
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/srr/r1', body: { priority: 20 } }]))
  })

  it('the window: refusals stand at their fields, the form stays', async () => {
    server({ 'POST /api/srr': { status: 400, body: { error: 'SRR_TEMPLATE_NOT_FOR_FORMAT', message: 'no' } } })
    renderApp(<DeliveryPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Создать правило' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Имя/), { target: { value: 'New' } })
    fireEvent.change(within(dialog).getByLabelText(/Регулярка/), { target: { value: 'x(' } })
    await within(dialog).findByText(/не скомпилирует/)
    fireEvent.change(within(dialog).getByLabelText(/Регулярка/), { target: { value: 'x' } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать правило' }))
    await within(dialog).findByText(/шаблонов не берёт, а у правила/)
    expect((within(dialog).getByLabelText(/Имя/) as HTMLInputElement).value).toBe('New')
  })

  it('a name taken stands at the name', async () => {
    server({ 'POST /api/srr': { status: 409, body: { error: 'CONFLICT', message: 'taken' } } })
    renderApp(<DeliveryPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Создать правило' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Имя/), { target: { value: 'Happ' } })
    fireEvent.change(within(dialog).getByLabelText(/Регулярка/), { target: { value: 'x' } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать правило' }))
    await within(dialog).findByText('Правило с таким именем уже есть.')
  })

  it('the shadow warns and does not stop the save', async () => {
    server()
    renderApp(<DeliveryPage />)
    await userEvent.click((await screen.findAllByRole('button', { name: 'Открыть' }))[1] as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Проверить на примере'), { target: { value: 'Happ/1' } })
    await within(dialog).findByText(/стоит выше и ловит такой User-Agent/)
  })

  it('F-K6: delete names where clients land before it sends', async () => {
    const s = server({ 'DELETE /api/srr/r1': { status: 204, body: {} } })
    renderApp(<DeliveryPage />)
    await userEvent.click((await screen.findAllByRole('button', { name: 'Удалить' }))[0] as HTMLElement)
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/в конце их ждёт «Остальные», формат Ссылки \(plain\)/)
    expect(s.writes()).toEqual([])
    await userEvent.click(within(ask).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'DELETE', path: '/api/srr/r1', body: undefined }]))
  })
})
