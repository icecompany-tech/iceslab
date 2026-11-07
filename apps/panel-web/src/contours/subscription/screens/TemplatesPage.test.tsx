// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TemplatesPage from '@/contours/subscription/screens/TemplatesPage'
import { renderApp, stubServer } from '@/test/app'

const template = (over: object = {}) => ({ id: 't1', type: 'mihomo', name: 'Default', body: 'a: 1', isDefault: true, updatedAt: '2026-11-01T00:00:00Z', ...over })

const server = (over: Parameters<typeof stubServer>[0] = {}) =>
  stubServer({
    'GET /api/subscription-templates': { body: { templates: [template({ id: 't2', name: 'mine', isDefault: false }), template()] } },
    'GET /api/srr': { body: { rules: [{ id: 'r', name: 'm', uaPattern: 'x', format: 'mihomo', priority: 1, enabled: true, templateName: 'mine' }, { id: 'r2', name: 'n', uaPattern: 'y', format: 'mihomo', priority: 2, enabled: true, templateName: null }, { id: 'r3', name: 'p', uaPattern: 'z', format: 'plain', priority: 3, enabled: true, templateName: null }] } },
    ...over,
  })

function Draft() {
  const location = useLocation()
  return <div>draft {JSON.stringify(location.state)}</div>
}

const page = () =>
  renderApp(
    <Routes>
      <Route path="/subscription/templates" element={<TemplatesPage />} />
      <Route path="/subscription/templates/new" element={<Draft />} />
    </Routes>,
    { route: '/subscription/templates' },
  )

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('TemplatesPage', () => {
  it('загрузка', () => {
    server()
    page()
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: a failed list is not "no such section"', async () => {
    server({ 'GET /api/subscription-templates': { status: 500, body: {} } })
    page()
    await screen.findByText('Шаблоны не загрузились', {}, { timeout: 15_000 })
    expect(screen.queryByText('На этом сервере шаблонов нет')).toBeNull()
  })

  it('пусто: an invitation, not a loss', async () => {
    server({ 'GET /api/subscription-templates': { body: { templates: [] } } })
    page()
    await screen.findByText('Шаблонов пока нет')
  })

  it('не проверено: rules that did not load read as unknown, never as zero', async () => {
    server({ 'GET /api/srr': { status: 500, body: {} } })
    page()
    await screen.findAllByText('правил: неизвестно', {}, { timeout: 8000 })
    expect(screen.queryByText('правил: 0')).toBeNull()
  })

  it('a 404 says the server has no such section, the buttons close', async () => {
    server({ 'GET /api/subscription-templates': { status: 404, body: {} } })
    page()
    await screen.findByText('На этом сервере шаблонов нет')
    expect((screen.getByRole('button', { name: 'Импорт файла' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('groups by type, Default first, counts the rules each one serves', async () => {
    server()
    page()
    const rows = await screen.findAllByRole('link', { name: /правил:/ })
    expect(rows[0]?.textContent).toMatch(/Default/)
    expect(rows[0]?.textContent).toMatch(/правил: 1/)
    expect(rows[1]?.textContent).toMatch(/mine/)
    expect(rows[1]?.textContent).toMatch(/правил: 1/)
  })

  it('import goes through a window to a draft and saves nothing', async () => {
    const s = server({ 'POST /api/subscription-templates/import': { body: { template: { type: 'mihomo', name: '', body: 'x: 1' } } } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Импорт файла' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/iceslab-migrate templates/)
    const file = new File(['x: 1'], 'my.yaml', { type: 'text/yaml' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('x: 1') })
    fireEvent.change(within(dialog).getByLabelText('Файл шаблона'), { target: { files: [file] } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Разобрать' }))
    await waitFor(() => expect(screen.getByText(/draft/).textContent).toMatch(/"name":"my"/))
    expect(s.writes()).toEqual([{ method: 'POST', path: '/api/subscription-templates/import', body: { body: 'x: 1' } }])
  })

  it('an import answer without a template is said', async () => {
    server({ 'POST /api/subscription-templates/import': { body: {} } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Импорт файла' }))
    const dialog = await screen.findByRole('dialog')
    const file = new File(['x'], 'a.yaml')
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('x') })
    fireEvent.change(within(dialog).getByLabelText('Файл шаблона'), { target: { files: [file] } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Разобрать' }))
    await within(dialog).findByText(/Сервер не вернул шаблон/)
  })
})
