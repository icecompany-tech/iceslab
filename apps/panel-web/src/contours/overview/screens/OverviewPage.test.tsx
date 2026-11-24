// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OverviewPage from '@/contours/overview/screens/OverviewPage'
import { renderApp, stubServer } from '@/test/app'

const GiB = 1024 ** 3

const node = (over: object) => ({
  id: 'n1',
  name: 'de-01',
  address: '91.142.77.10',
  protocol: 'xray',
  status: 'online',
  countryCode: 'DE',
  lastStatusChange: '2026-11-06T11:56:00Z',
  inboundCount: 1,
  todayBytes: 48 * GiB,
  metrics: null,
  ...over,
})

const overview = (over: object = {}) => ({
  users: { total: 1358, byStatus: { active: 1204 }, onlineNow: 318, onlineToday: 402 },
  traffic: {
    todayBytes: 10 * GiB,
    yesterdayBytes: 9 * GiB,
    last7dBytes: 70 * GiB,
    prev7dBytes: 50 * GiB,
    last30dBytes: 3300 * GiB,
    prev30dBytes: 3000 * GiB,
    calendarMonthBytes: 400 * GiB,
    currentYearBytes: 9000 * GiB,
    last24hHourly: [
      { hour: '2026-11-06T10:00:00Z', bytes: GiB },
      { hour: '2026-11-06T11:00:00Z', bytes: 2 * GiB },
    ],
  },
  system: { onlineNodeCount: 1, totalNodeCount: 3 },
  inventory: { profileCount: 1, squadCount: 1, hostCount: 1 },
  host: {
    cpu: { loadPercent: 12, samplePercent: 20, cores: 2, loadavg: [0.24, 0.31, 0.28] },
    memory: { totalBytes: 4 * GiB, usedBytes: GiB, usedPercent: 25 },
    disk: { totalBytes: 40 * GiB, usedBytes: 20 * GiB, usedPercent: 50 },
    process: { rssBytes: GiB / 4, heapUsedBytes: GiB / 8, heapLimitBytes: 2 * GiB, uptimeSeconds: 3600 },
  },
  nodes: [node({}), node({ id: 'n2', name: 'de-02', status: 'unreachable', todayBytes: GiB }), node({ id: 'n3', name: 'kz-01', status: 'unknown', countryCode: 'KZ', todayBytes: 0 })],
  ...over,
})

const details = {
  nodes: [
    { id: 'n1', name: 'de-01', address: 'x', status: 'online', countryCode: 'DE', lastStatusChange: null, lastStatusMessage: null, certNotAfter: '2026-11-12T12:00:00Z', engines: ['singbox', 'xray', 'naive', 'hysteria'] },
    { id: 'n2', name: 'de-02', address: 'x', status: 'unreachable', countryCode: 'DE', lastStatusChange: null, lastStatusMessage: 'fetch failed', certNotAfter: null },
    { id: 'n3', name: 'kz-01', address: 'x', status: 'unknown', countryCode: 'KZ', lastStatusChange: null, lastStatusMessage: null },
  ],
  total: 3,
}

const server = (over: Record<string, object> = {}) =>
  stubServer({
    'GET /api/dashboard/overview': { body: overview() },
    'GET /api/users': { body: { total: 37 } },
    'GET /api/nodes': { body: details },
    'GET /health': { body: { status: 'ok', db: 'ok', redis: 'ok' } },
    ...over,
  })

afterEach(() => vi.unstubAllGlobals())

describe('OverviewPage', () => {
  it('загрузка: says it is loading and draws no zero', () => {
    server()
    renderApp(<OverviewPage />)
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
    expect(screen.queryByText('0')).toBeNull()
  })

  it('сбой: a 500 is a failure with a retry, not an empty panel', async () => {
    const s = server({ 'GET /api/dashboard/overview': { status: 500, body: { error: 'INTERNAL' } } })
    renderApp(<OverviewPage />)
    await screen.findByText('Сводка не загрузилась')
    const before = s.sent.length
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(s.sent.length).toBeGreaterThan(before)
  })

  it('keeps the server and nodes when only traffic fails, then retries', async () => {
    server({ 'GET /api/dashboard/overview': { body: overview({ traffic: null }) } })
    renderApp(<OverviewPage />)
    await screen.findByText('Не удалось загрузить трафик')
    expect(screen.getByRole('table', { name: 'Ноды' })).toBeTruthy()
    expect(screen.getByText('Сервер панели')).toBeTruthy()
    server()
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByRole('heading', { name: 'Трафик за 24 часа' })
  })

  it('counts from the server: online, active, expiring, nodes', async () => {
    const s = server()
    renderApp(<OverviewPage />)
    await screen.findByText('318')
    expect(screen.getByText(/^1\s204$/)).toBeTruthy()
    await screen.findAllByText('37')
    const asked = s.sent.find((r) => r.path.includes('expiresBefore='))?.path ?? ''
    expect(asked).toMatch(/status=active/)
    expect(asked).toMatch(/expiresBefore=2026-11-13T12/)
    expect(screen.getByText(/1 с проблемами/)).toBeTruthy()
    expect(screen.getByText(/1 не проверено/)).toBeTruthy()
  })

  it('не проверено: a count that did not arrive is unknown, not zero', async () => {
    server({ 'GET /api/users': { status: 500, body: {} } })
    renderApp(<OverviewPage />)
    await screen.findByText('не получили число')
    expect(screen.getAllByText('неизвестно').length).toBeGreaterThan(0)
  })

  it('не проверено: no peak, no split and no weekends, the server has none', async () => {
    server()
    renderApp(<OverviewPage />)
    await screen.findByText('318')
    for (const word of [/пик за сутки/, /Выходные к будням/, /К юзерам/, /От юзеров/]) expect(screen.queryByText(word)).toBeNull()
  })

  it('uses completed UTC rows for the monthly total, previous total and average independently of directions', async () => {
    const base = overview()
    const dailyComparison = Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, i + 1)).toISOString().slice(0, 10), bytes: 3 * GiB, previousBytes: 2 * GiB,
    }))
    server({ 'GET /api/dashboard/overview': { body: { ...base, traffic: { ...base.traffic, completedUtc30d: { dailyComparison } } } } })
    renderApp(<OverviewPage />)
    await screen.findByRole('group', { name: 'Трафик за 30 дней' })
    expect(screen.getByText('90,0 ГБ')).toBeTruthy()
    expect(screen.getByText(/к прошлым 30 дням \(60,0 ГБ\)/)).toBeTruthy()
    expect(screen.getByText('было 2 ГБ')).toBeTruthy()
    expect(screen.queryByText('К юзерам')).toBeNull()
  })

  it.each([
    { toUsers: 3 * GiB, fromUsers: GiB, total: '4,00 ГБ', mean: '137 МБ', shares: ['75%', '25%'] },
    { toUsers: 0, fromUsers: 0, total: '0 Б', mean: '0 Б', shares: [] },
  ])('shows confirmed directions alone when the operator selects the month ($total)', async ({ toUsers, fromUsers, total, mean, shares }) => {
    const base = overview()
    server({ 'GET /api/dashboard/overview': { body: { ...base, traffic: {
      ...base.traffic, completedUtc30d: { monthlyDirections: { toUsers, fromUsers } },
    } } } })
    renderApp(<OverviewPage />)
    await screen.findByRole('heading', { name: 'Трафик за 24 часа' })
    await userEvent.click(screen.getByRole('radio', { name: '30 д' }))
    const title = screen.getByRole('heading', { name: 'Трафик за 30 дней' })
    const block = within(title.closest('section')!)
    expect(within(title.parentElement!).getByText(total)).toBeTruthy()
    expect(within(block.getByText('В среднем за день').parentElement!).getByText(mean)).toBeTruthy()
    expect(block.getByText('Нет данных за предыдущие 30 суток')).toBeTruthy()
    expect(block.queryByText(/было |к прошлым 30 дням/)).toBeNull()
    expect(block.queryByText('Прошлые 30')).toBeNull()
    expect(block.queryByRole('group', { name: 'Трафик за 30 дней' })).toBeNull()
    expect(block.queryAllByText(/%$/).map(el => el.textContent)).toEqual(shares)
    for (const label of ['К юзерам', 'От юзеров']) expect(block.getByText(label)).toBeTruthy()
  })

  it('compares a week with a week, and a day with nothing', async () => {
    server()
    renderApp(<OverviewPage />)
    await screen.findByText(/Трафик за 24 часа/)
    expect(screen.getByText(/Нет почасовых данных за вчера/)).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: '7 д' }))
    expect(screen.getByText(/\+40%/)).toBeTruthy()
    expect(screen.getByText(/Для графика нужны суточные значения/)).toBeTruthy()
    expect((screen.getByRole('radio', { name: '90 д' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('radio', { name: '30 д' }))
    expect(screen.getByText('3,22 ТБ')).toBeTruthy()
    expect(screen.getByText(/к прошлым 30 дням \(2,93 ТБ\)/)).toBeTruthy()
    expect(screen.getByText('было 100 ГБ')).toBeTruthy()
  })

  it('пусто: no traffic in a day and no nodes are said in words', async () => {
    const empty = overview({ nodes: [], system: { onlineNodeCount: 0, totalNodeCount: 0 } })
    server({ 'GET /api/dashboard/overview': { body: { ...empty, traffic: { ...empty.traffic, last24hHourly: [] } } }, 'GET /api/nodes': { body: { nodes: [], total: 0 } } })
    renderApp(<OverviewPage />)
    await screen.findByText(/трафика нет: пусто/)
    expect(screen.getByRole('link', { name: 'Добавить ноду' }).getAttribute('href')).toBe('/nodes/new')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('a missing disk or host is unknown, not zero', async () => {
    const base = overview()
    server({ 'GET /api/dashboard/overview': { body: { ...base, host: { ...base.host, disk: null } } } })
    const { unmount } = renderApp(<OverviewPage />)
    await screen.findByText(/Диск не проверен/)
    unmount()
    server({ 'GET /api/dashboard/overview': { body: { ...base, host: undefined } } })
    renderApp(<OverviewPage />)
    await screen.findByText(/неизвестно, а не ноль/)
  })

  it('lists problems first, with the engines, the term and an honest users column', async () => {
    server({ 'GET /api/users?nodeId=n1&limit=1': { body: { total: 0 } }, 'GET /api/users?nodeId=n3&limit=1': { status: 503 } })
    renderApp(<OverviewPage />)
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]?.textContent).toMatch(/de-02.*Не отвечает, 4 мин/)
    expect(rows[1]?.textContent).toMatch(/kz-01.*Не проверено.*нет данных/)
    await within(table).findByText('xray')
    expect(within(rows[2]!).getByRole('cell', { name: '0' })).toBeTruthy()
    expect(rows[1]?.children[3]?.textContent).toBe('нет данных')
    expect(rows[2]?.textContent).toMatch(/de-01.*xray.*sing-box.*\+2.*6 дн/)
  })

  it('a failed node list says so and keeps the table', async () => {
    server({ 'GET /api/nodes': { status: 500, body: {} } })
    renderApp(<OverviewPage />)
    await screen.findByText(/Не получили ядра и сертификаты/)
    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('filters by a chip and opens the rest', async () => {
    const many = Array.from({ length: 7 }, (_, i) => node({ id: `m${i}`, name: `m-${i}` }))
    server({ 'GET /api/dashboard/overview': { body: overview({ nodes: many }) } })
    renderApp(<OverviewPage />)
    await screen.findByText('Показаны 5 из 7, проблемные сверху')
    await userEvent.click(screen.getByRole('button', { name: /Ещё 2/ }))
    expect(screen.getByText('Показаны все 7, проблемные сверху')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Проблемы/ }))
    expect(screen.getByText('В этом фильтре нод нет.')).toBeTruthy()
  })
})
