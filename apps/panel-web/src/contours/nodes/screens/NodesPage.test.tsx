// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NodesPage from '@/contours/nodes/screens/NodesPage'
import { renderApp, stubServer } from '@/test/app'

const node = (over: object = {}) => ({
  id: 'n1',
  name: 'de-01',
  address: '91.1.1.1:1337',
  protocol: 'xray',
  countryCode: 'DE',
  status: 'online',
  lastStatusChange: null,
  lastStatusMessage: null,
  certNotAfter: '2027-01-01T00:00:00Z',
  consumptionMultiplier: 1,
  regionId: null,
  engines: ['xray'],
  ...over,
})

const server = (over: Record<string, object> = {}) =>
  stubServer({
    'GET /api/nodes': { body: { nodes: [node(), node({ id: 'n2', name: 'se-01', status: 'unreachable', lastStatusMessage: 'fetch failed' }), node({ id: 'n3', name: 'kz-01', status: 'unknown', engines: undefined, intendedEngines: ['amneziawg'] })], total: 3 } },
    'GET /api/dashboard/overview': { status: 500, body: {} },
    'GET /api/regions': { body: { regions: [] } },
    'GET /api/cascades': { body: { cascades: [] } },
    ...over,
  })

afterEach(() => vi.unstubAllGlobals())

describe('NodesPage', () => {
  it('загрузка: says it is loading', () => {
    server()
    renderApp(<NodesPage />, { route: '/nodes' })
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: a failed list is a failure with a retry, not "no nodes"', async () => {
    const s = server({ 'GET /api/nodes': { status: 500, body: {} } })
    renderApp(<NodesPage />, { route: '/nodes' })
    await screen.findByText('Список нод не загрузился', {}, { timeout: 5000 })
    expect(screen.queryByText('Нод ещё нет')).toBeNull()
    const before = s.sent.length
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(s.sent.length).toBeGreaterThan(before)
  })

  it('пусто: no nodes offers to add, a filter with nobody says so', async () => {
    server({ 'GET /api/nodes': { body: { nodes: [], total: 0 } } })
    renderApp(<NodesPage />, { route: '/nodes' })
    await screen.findByText('Нод ещё нет')
  })

  it('не проверено: metrics that did not come are unknown, not zero', async () => {
    server()
    renderApp(<NodesPage />, { route: '/nodes' })
    await screen.findByText('de-01')
    expect(screen.getAllByText('неизвестно').length).toBeGreaterThan(0)
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.getByText('Не проверено: агент ещё не отчитался')).toBeTruthy()
  })

  it('counts by health and filters by a chip', async () => {
    server()
    renderApp(<NodesPage />, { route: '/nodes' })
    await screen.findByText('se-01')
    expect(screen.getByText(/Не отвечает: fetch failed/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Проблемы/ }))
    await waitFor(() => expect(screen.queryByText('de-01')).toBeNull())
    expect(screen.getByText('se-01')).toBeTruthy()
  })

  it('the list says the server does not count users per node', async () => {
    server()
    renderApp(<NodesPage />, { route: '/nodes' })
    await screen.findByText('de-01')
    await userEvent.click(screen.getByRole('radio', { name: 'Список' }))
    expect(screen.getByRole('columnheader', { name: 'Юзеры' }).title).toMatch(/не считает/)
  })
})
