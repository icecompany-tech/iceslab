// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuditPage from '@/contours/audit/screens/AuditPage'
import { renderApp, stubServer } from '@/test/app'

const event = (id: string, over: object = {}) => ({ id, at: '2026-11-06T10:00:00Z', actor: { kind: 'admin', id: 'a', label: 'root' }, action: 'cascade.update', target: { kind: 'cascade', id: 'c', label: 'a4-test' }, outcome: 'ok', refusal: null, detail: { directions: 2, nodes: 3 }, sourceNetwork: '10.0.0.0/24', ...over })

const server = (over: Parameters<typeof stubServer>[0] = {}) =>
  stubServer({
    'GET /api/audit': { body: { events: [event('1'), event('2', { action: 'auth.login', actor: { kind: 'anonymous', id: null, label: null }, target: { kind: 'admin', id: null, label: '203.0.113.0/24' }, outcome: 'refused', refusal: 'BAD_PASSWORD', detail: { suppressed: 5, windowStart: '2026-11-06T09:00:00Z' } })], nextCursor: null } },
    ...over,
  })

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('AuditPage', () => {
  it('загрузка', () => {
    server()
    renderApp(<AuditPage />)
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем журнал/)
  })

  it('сбой: says so with a retry', async () => {
    server({ 'GET /api/audit': { status: 500, body: {} } })
    renderApp(<AuditPage />)
    await screen.findByText('Журнал не загрузился', {}, { timeout: 8000 })
  })

  it('пусто: under a filter says the filter, with none says the log is empty', async () => {
    server({ 'GET /api/audit': { body: { events: [], nextCursor: null } } })
    renderApp(<AuditPage />)
    await screen.findByText('По этим условиям записей нет')
    await userEvent.click(screen.getByRole('radio', { name: 'всё' }))
    await screen.findByText('Записей нет')
  })

  it('не проверено: a row by an unknown action shows its raw name, not a guess', async () => {
    server({ 'GET /api/audit': { body: { events: [event('1', { action: 'future.thing', detail: null, sourceNetwork: null })], nextCursor: null } } })
    renderApp(<AuditPage />)
    await screen.findByText('future.thing')
    await userEvent.click(screen.getAllByRole('button', { name: /2026/ })[0] as HTMLElement)
    await screen.findByText('подробностей нет')
  })

  it('an api token reading it is told so, not "failed"', async () => {
    server({ 'GET /api/audit': { status: 403, body: { error: 'AUDIT_ADMIN_ONLY' } } })
    renderApp(<AuditPage />)
    await screen.findByText(/открыт только админу/)
    expect(screen.queryByText('Журнал не загрузился')).toBeNull()
  })

  it('F-1: rows in panel words, the summary says why it is one row', async () => {
    server()
    renderApp(<AuditPage />)
    await screen.findByText('каскад a4-test')
    expect(screen.getByText('сеть 203.0.113.0/24')).toBeTruthy()
    expect(screen.getByText('отказ: BAD_PASSWORD')).toBeTruthy()
    expect(screen.getByText('аноним')).toBeTruthy()
    const rows = screen.getAllByRole('button', { name: /2026/ })
    await userEvent.click(rows[1] as HTMLElement)
    await screen.findByText(/Отказы входа за час сверх предела/)
    expect(screen.getByText(/не записано 5 отказов/)).toBeTruthy()
  })

  it('a row opens to its detail and two stay open', async () => {
    server()
    renderApp(<AuditPage />)
    await screen.findByText('каскад a4-test')
    const rows = screen.getAllByRole('button', { name: /2026/ })
    await userEvent.click(rows[0] as HTMLElement)
    await screen.findByText('направлений 2, нод 3')
    await userEvent.click(rows[1] as HTMLElement)
    expect(screen.getByText('направлений 2, нод 3')).toBeTruthy()
  })

  it('the filters go to the server, targetKind and a group prefix included', async () => {
    const s = server()
    renderApp(<AuditPage />)
    await screen.findByText('каскад a4-test')
    await userEvent.click(screen.getByRole('button', { name: 'Фильтры' }))
    fireEvent.change(screen.getByLabelText('Над чем'), { target: { value: 'cascade' } })
    fireEvent.change(screen.getByLabelText('Действие'), { target: { value: 'group:cascade' } })
    await waitFor(() => {
      const last = s.sent.at(-1)?.path ?? ''
      expect(last).toMatch(/targetKind=cascade/)
      expect(last).toMatch(/action=cascade\./)
    })
    expect(s.sent.at(-1)?.path).toMatch(/from=2026-10-30/)
  })

  it('search and result filters are not offered until the server can do them', async () => {
    server()
    renderApp(<AuditPage />)
    await screen.findByText('каскад a4-test')
    expect(screen.queryByLabelText(/Поиск/)).toBeNull()
    expect(screen.queryByLabelText(/итог/i)).toBeNull()
  })

  it('more pages: by the server cursor, a failed page keeps the list', async () => {
    let second = false
    server({
      'GET /api/audit': (request) => {
        if (request.path.includes('cursor=')) {
          second = true
          return { status: 400, body: { error: 'BAD_CURSOR' } }
        }
        return { body: { events: [event('1')], nextCursor: 'c2' } }
      },
    })
    renderApp(<AuditPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }))
    await screen.findByText(/не узнал страницу журнала/)
    expect(second).toBe(true)
    expect(screen.getByText('каскад a4-test')).toBeTruthy()
  })

  it('the end of the list says it', async () => {
    server()
    renderApp(<AuditPage />)
    await screen.findByText('Дальше записей нет')
  })
})
