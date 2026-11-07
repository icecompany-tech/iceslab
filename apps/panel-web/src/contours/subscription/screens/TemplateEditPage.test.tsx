// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TemplateEditPage from '@/contours/subscription/screens/TemplateEditPage'
import { renderApp, stubServer } from '@/test/app'

const template = (over: object = {}) => ({ id: 't1', type: 'mihomo', name: 'mine', body: 'a: 1', isDefault: false, updatedAt: '2026-11-01T00:00:00Z', ...over })
const fine = { ok: true, rendered: 'proxies: []', check: { ok: true }, warnings: [] }

const server = (over: Parameters<typeof stubServer>[0] = {}) =>
  stubServer({
    'GET /api/subscription-templates': { body: { templates: [template(), template({ id: 'd', name: 'Default', isDefault: true })] } },
    'GET /api/srr': { body: { rules: [{ id: 'r', name: 'm', uaPattern: 'x', format: 'mihomo', priority: 1, enabled: true, templateName: 'mine' }] } },
    'POST /api/subscription-templates/dry-run': { body: fine },
    'PUT /api/subscription-templates/t1': { body: template({ body: 'a: 2' }) },
    ...over,
  })

const page = (route = '/subscription/templates/t1', state?: unknown) =>
  renderApp(
    <Routes>
      <Route path="/subscription/templates/new" element={<TemplateEditPage />} />
      <Route path="/subscription/templates/:id" element={<TemplateEditPage />} />
      <Route path="/subscription/templates" element={<div>list</div>} />
    </Routes>,
    { route, state },
  )

const button = (name: string) => screen.findByRole('button', { name }) as Promise<HTMLButtonElement>

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 25_000 })

describe('TemplateEditPage', () => {
  it('загрузка', () => {
    server()
    page()
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: a failed list does not open an empty editor', async () => {
    server({ 'GET /api/subscription-templates': { status: 500, body: {} } })
    page()
    await screen.findByText('Шаблоны не загрузились', {}, { timeout: 15_000 })
    expect(screen.queryByLabelText('Тело')).toBeNull()
  })

  it('пусто: a deleted template says so', async () => {
    server()
    page('/subscription/templates/zzz')
    await screen.findByText('Такого шаблона больше нет')
  })

  it('untouched form closes the save, a body edit sends only the body after the run', async () => {
    const s = server()
    page()
    const save = await button('Сохранить')
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Тело'), { target: { value: 'a: 2' } })
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await waitFor(() => expect(s.writes().map((w) => w.path)).toEqual(['/api/subscription-templates/dry-run', '/api/subscription-templates/t1']))
    expect(s.writes()[1]?.body).toEqual({ body: 'a: 2' })
  })

  it('не проверено: a run that did not answer saves and says so, a core that did not run is not green', async () => {
    const s = server({ 'POST /api/subscription-templates/dry-run': { body: { ok: null, rendered: 'x', check: { ok: null }, warnings: [] } } })
    page()
    fireEvent.change(await screen.findByLabelText('Тело'), { target: { value: 'a: 2' } })
    await userEvent.click(await button('Сухой прогон'))
    await screen.findByText('ядро на панели не проверило')
    expect(screen.queryByText('проверено ядром')).toBeNull()
    expect(s.writes()).toHaveLength(1)
  })

  it('a refused run closes the save with its reason, a body edit drops the stale verdict', async () => {
    const s = server({ 'POST /api/subscription-templates/dry-run': { body: { ok: false, rendered: '', check: { ok: false, message: 'bad yaml' }, warnings: [{ code: 'NO_GROUP_HOLDS_NODE', message: 'no group' }] } } })
    page()
    fireEvent.change(await screen.findByLabelText('Тело'), { target: { value: 'a: 2' } })
    await userEvent.click(await button('Сухой прогон'))
    await screen.findByText('не сохранится: прогон отказал')
    expect(screen.getByText('bad yaml')).toBeTruthy()
    expect(screen.getByText('no group')).toBeTruthy()
    expect(screen.getByText(/iceslab-migrate templates/)).toBeTruthy()
    expect((await button('Сохранить')).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Тело'), { target: { value: 'a: 3' } })
    await waitFor(() => expect(screen.queryByText('не сохранится: прогон отказал')).toBeNull())
    expect(s.writes().filter((w) => w.method === 'PUT')).toEqual([])
  })

  it('a server refusal points at the line and keeps the body', async () => {
    server({ 'PUT /api/subscription-templates/t1': { status: 400, body: { error: 'TEMPLATE_INVALID', message: 'unexpected', line: 3, column: 5 } } })
    page()
    fireEvent.change(await screen.findByLabelText('Тело'), { target: { value: 'a: 2' } })
    await userEvent.click(await button('Сохранить'))
    await screen.findByText(/Строка 3, столбец 5: unexpected/)
    expect((screen.getByLabelText('Тело') as HTMLTextAreaElement).value).toBe('a: 2')
  })

  it('a taken name stands at the name', async () => {
    server({ 'PUT /api/subscription-templates/t1': { status: 409, body: { error: 'TEMPLATE_NAME_TAKEN', message: 'taken' } } })
    page()
    fireEvent.change(await screen.findByLabelText(/Имя/), { target: { value: 'other' } })
    await userEvent.click(await button('Сохранить'))
    await screen.findByText('Шаблон с таким именем у этого типа уже есть.')
  })

  it('Default: no delete, a locked name, restore through a window that names the price', async () => {
    const s = server({ 'POST /api/subscription-templates/d/restore-default': { body: template({ id: 'd', name: 'Default', isDefault: true, body: 'fresh: 1' }) } })
    page('/subscription/templates/d')
    await button('Восстановить Default')
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull()
    expect((screen.getByLabelText(/Имя/) as HTMLInputElement).disabled).toBe(true)
    await userEvent.click(await button('Восстановить Default'))
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/правки в нём пропадут/)
    expect(s.writes()).toEqual([])
    await userEvent.click(within(ask).getByRole('button', { name: 'Восстановить Default' }))
    await waitFor(() => expect((screen.getByLabelText('Тело') as HTMLTextAreaElement).value).toBe('fresh: 1'))
  })

  it('F-K6: delete says how many rules fall to the Default', async () => {
    const s = server({ 'DELETE /api/subscription-templates/t1': { status: 204, body: {} } })
    page()
    await screen.findByText(/Сухой прогон/)
    await userEvent.click(await button('Удалить'))
    const ask = await screen.findByRole('dialog')
    await waitFor(() => expect(ask.textContent).toMatch(/называли этот шаблон \(1\)/))
    expect(s.writes()).toEqual([])
    await userEvent.click(within(ask).getByRole('button', { name: 'Удалить' }))
    await screen.findByText('list')
  })

  it('an imported draft needs a dry run before the save opens', async () => {
    const s = server({ 'POST /api/subscription-templates': { body: template({ id: 'new1' }) } })
    page('/subscription/templates/new', { imported: { body: 'x: 1', type: 'mihomo', name: 'file', needsType: false } })
    const save = await button('Сохранить')
    expect(save.disabled).toBe(true)
    expect(screen.getByText(/нужен сухой прогон/)).toBeTruthy()
    await userEvent.click(await button('Сухой прогон'))
    await screen.findByText('проверено ядром')
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await waitFor(() => expect(s.writes().at(-1)).toEqual({ method: 'POST', path: '/api/subscription-templates', body: { type: 'mihomo', name: 'file', body: 'x: 1' } }))
  })
})
