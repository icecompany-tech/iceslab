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

  it.each([false, true])('uses server UTC slots and compares totals only with full coverage (%s)', async (partial) => {
    const base = overview()
    const recordedUtc24h = Array.from({ length: 24 }, (_, i) => ({
      hour: new Date(Date.UTC(2026, 10, 1, i)).toISOString(),
      bytes: partial && i === 2 ? null : GiB,
      previousBytes: partial && i === 4 ? null : GiB / 2,
    }))
    server({ 'GET /api/dashboard/overview': { body: { ...base, traffic: { ...base.traffic, recordedUtc24h } } } })
    renderApp(<OverviewPage />)
    const title = await screen.findByRole('heading', { name: 'Трафик за 24 часа' })
    const block = within(title.closest('section')!)
    expect(within(title.parentElement!).getByText(partial ? '23,0 ГБ' : '24,0 ГБ')).toBeTruthy()
    expect(block.getByText('Эти 24 часа')).toBeTruthy()
    expect(block.getByText('Вчера')).toBeTruthy()
    if (partial) {
      expect(block.getByText(/Сумма записанных данных/)).toBeTruthy()
      expect(block.queryByText('+100%')).toBeNull()
    } else {
      expect(block.getByText('+100%')).toBeTruthy()
    }
  })

  it('keeps hourly and monthly totals usable on a server without traffic-series', async () => {
    const base = overview()
    server({ 'GET /api/dashboard/overview': { body: { ...base, traffic: { ...base.traffic, last24hHourly: [{ hour: new Date().toISOString(), bytes: GiB }] } } },
      'GET /api/dashboard/traffic-series?period=7d': { status: 404 },
    })
    renderApp(<OverviewPage />)
    await screen.findByText(/Трафик за 24 часа/)
    expect(screen.getByText(/Нет почасовых данных за вчера/)).toBeTruthy()
    expect(screen.getByText('Эти 24 часа')).toBeTruthy()
    expect(screen.queryByText('Вчера')).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: '7 д' }))
    await screen.findByText('Эта версия сервера ещё не отдаёт ряд за выбранный период.')
    expect(screen.queryByText('50,0 ГБ')).toBeNull()
    expect((screen.getByRole('radio', { name: '90 д' }) as HTMLButtonElement).disabled).toBe(false)
    await userEvent.click(screen.getByRole('radio', { name: '30 д' }))
    expect(screen.getByText('3,22 ТБ')).toBeTruthy()
    expect(screen.getByText('2,93 ТБ')).toBeTruthy()
    expect(screen.queryByText('было 100 ГБ')).toBeNull()
  })

  it.each([
    { label: 'partial', values: [0, 300, null, null, null, null, null], prior: 50, comparable: false, total: '300 Б', mean: '150 Б', percent: false },
    { label: 'comparable', values: Array<number>(7).fill(100), prior: 50, comparable: true, total: '700 Б', mean: '100 Б', percent: true },
    { label: 'zero baseline', values: Array<number>(7).fill(100), prior: 0, comparable: true, total: '700 Б', mean: '100 Б', percent: false },
  ])('uses the selected week for the hero and measured average ($label)', async ({ values, prior, comparable, total, mean, percent }) => {
    const points = values.map((bytes, i) => ({ at: new Date(Date.UTC(2026, 10, i + 1)).toISOString(), bytes, previousBytes: prior }))
    const requests = server({ 'GET /api/dashboard/traffic-series?period=7d': { body: { period: '7d', points, canCompareTotals: comparable } } })
    renderApp(<OverviewPage />, { route: '/?period=7d' })
    const plot = await screen.findByRole('group', { name: 'Трафик за 7 дней' })
    const block = within(plot.closest('section')!)
    const heading = block.getByRole('heading')
    expect(within(heading.parentElement!).getByText(total)).toBeTruthy()
    expect(within(block.getByText('В среднем за день').parentElement!).getByText(mean)).toBeTruthy()
    expect(heading.parentElement!.textContent?.includes('+100%')).toBe(percent)
    expect(requests.sent.filter(r => r.path.includes('/traffic-series')).map(r => r.path)).toEqual(['/api/dashboard/traffic-series?period=7d'])
  })

  it('sums a sparse recorded month separately from confirmed client directions', async () => {
    const base = overview()
    const points = Array.from({ length: 30 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 9, i + 1)).toISOString(), bytes: i === 0 ? 11 : i === 29 ? 23 : null,
      previousBytes: i === 0 ? 0 : null,
    }))
    server({ 'GET /api/dashboard/overview': { body: { ...base, traffic: { ...base.traffic, completedUtc30d: { monthlyDirections: { toUsers: 3 * GiB, fromUsers: GiB } } } } },
      'GET /api/dashboard/traffic-series?period=30d': { body: { period: '30d', points, canCompareTotals: false } } })
    renderApp(<OverviewPage />, { route: '/?period=30d' })
    const g = await screen.findByRole('group', { name: 'Трафик за 30 дней' })
    const block = within(g.closest('section')!)
    expect(within(block.getByRole('heading').parentElement!).getByText('34 Б')).toBeTruthy()
    expect(block.getByText('17 Б')).toBeTruthy()
    expect(block.getByText('75%')).toBeTruthy()
    expect(block.getByText('25%')).toBeTruthy()
    expect(block.getByText(/Записанный трафик нод/)).toBeTruthy()
  })

  it('пусто: no traffic in a day and no nodes are said in words', async () => {
    const empty = overview({ nodes: [], system: { onlineNodeCount: 0, totalNodeCount: 0 } })
    server({ 'GET /api/dashboard/overview': { body: { ...empty, traffic: { ...empty.traffic, last24hHourly: [] } } }, 'GET /api/nodes': { body: { nodes: [], total: 0 } } })
    renderApp(<OverviewPage />)
    await screen.findByText(/Нет почасовых записей за эти сутки/)
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
