// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NodeEditPage from '@/contours/nodes/screens/NodeEditPage'
import { coreVersionChoices } from '@/lib/old/coreVersions'
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
  agentCanRotate: true,
  consumptionMultiplier: 1,
  regionId: null,
  domain: null,
  maxUsers: null,
  policyId: null,
  warpEnabled: false,
  engines: ['xray'],
  intendedEngines: ['xray'],
  cascadeNeedsEngines: [],
  lastInboundSyncError: null,
  cores: { observedAt: '2026-11-06T00:00:00Z', cores: [{ name: 'xray', engine: 'xray', version: '26.3.27', installed: true, neededBy: 1 }] },
  ...over,
})

const server = (n: object, over: Record<string, object> = {}) =>
  stubServer({
    'GET /api/nodes/n1': { body: n },
    'GET /api/nodes': { body: { nodes: [n], total: 1 } },
    'GET /api/nodes/n1/sync-status': { body: { lastInboundSyncAt: null, configChangedAt: '2026-11-06T00:00:00Z', applied: true, online: true } },
    'GET /api/dashboard/overview': { status: 500, body: {} },
    'GET /api/regions': { body: { regions: [] } },
    'GET /api/cascades': { body: { cascades: [] } },
    'GET /api/hosts': { body: { hosts: [] } },
    'GET /api/node-policies': { body: { policies: [] } },
    'GET /api/squads': { body: { squads: [] } },
    ...over,
  })

const page = () =>
  renderApp(
    <Routes>
      <Route path="/nodes/:id" element={<NodeEditPage />} />
      <Route path="/nodes" element={<div>list</div>} />
    </Routes>,
    { route: '/nodes/n1' },
  )

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('NodeEditPage', () => {
  it('загрузка', () => {
    server(node())
    page()
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: says it did not load', async () => {
    server(node(), { 'GET /api/nodes/n1': { status: 500, body: {} }, 'GET /api/nodes': { status: 500, body: {} } })
    page()
    await screen.findByText('Список нод не загрузился', {}, { timeout: 8000 })
  })

  it('пусто: a deleted node says so and goes to the list', async () => {
    server(node(), { 'GET /api/nodes/n1': { status: 404, body: {} }, 'GET /api/nodes': { body: { nodes: [], total: 0 } } })
    page()
    await screen.findByText('Уже удалена')
  })

  it('не проверено: an unreported node shows intent, not fact', async () => {
    server(node({ status: 'unknown', cores: null, engines: undefined }))
    page()
    await screen.findByText('Не проверено')
    await userEvent.click(screen.getByRole('button', { name: /Ядра/ }))
    expect(screen.getByText(/xray, не подтверждено/)).toBeTruthy()
  })

  it('an untouched form sends nothing, a change sends only itself', async () => {
    const s = server(node(), { 'PUT /api/nodes/n1': { body: node({ name: 'de-02' }) } })
    page()
    const save = (await screen.findByRole('button', { name: 'Сохранить' })) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'de-02' } })
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/nodes/n1', body: { name: 'de-02' } }]))
  })

  it('core versions: a pin sends only that component, a refusal stands in the cores step in the server words', async () => {
    const pin = coreVersionChoices('xray').find((c) => c.kind === 'pin' && c.blocked === null) ?? coreVersionChoices('xray').find((c) => c.kind === 'pinCurrent')
    const s = server(node({ coreVersions: {} }), { 'PUT /api/nodes/n1': { status: 400, body: { error: 'CORE_VERSION_NOT_LISTED', problems: ['xray 0.0.1 is not in the manifest'] } } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Ядра/ }))
    const picker = await screen.findByRole('combobox', { name: 'xray' })
    fireEvent.change(picker, { target: { value: pin?.value } })
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(s.writes()[0]?.body).toEqual({ coreVersions: { xray: pin?.value } }))
    await screen.findByText('xray 0.0.1 is not in the manifest')
    expect(screen.getByText(/Сервер не принял версии ядер/)).toBeTruthy()
  })

  it('core versions: a server without the field shows no picker', async () => {
    server(node())
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Ядра/ }))
    await screen.findByText(/ядра ставятся и снимаются командами/)
    expect(screen.queryByText('Версии ядер')).toBeNull()
  })

  it('F-20: a change of host warns before the save and promises no reissue of the node certificate', async () => {
    server(node())
    page()
    fireEvent.change(await screen.findByLabelText('Адрес сервера'), { target: { value: '92.2.2.2' } })
    await screen.findByText('Смена адреса')
    expect(screen.getByText(/сервер его сам не перевыпускает/)).toBeTruthy()
  })

  it('F-V6: a lost link is not called a core refusal, a real refusal shows the core words', async () => {
    server(node({ status: 'unreachable', lastStatusMessage: 'fetch failed', lastInboundSyncError: { at: '2026-11-06T00:00:00Z', message: 'fetch failed' } }))
    const first = page()
    await screen.findByText(/это обрыв связи, а не отказ ядра/)
    expect(screen.queryByText('Отказ ядра')).toBeNull()
    first.unmount()
    server(node({ lastInboundSyncError: { at: '2026-11-06T00:00:00Z', message: 'core said no' } }))
    page()
    await screen.findByText('Отказ ядра')
    expect(screen.getByText('core said no')).toBeTruthy()
  })

  it('F-K6: deleting asks with the clean-up command before it sends', async () => {
    const s = server(node())
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить ноду' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/--uninstall/)
    expect(s.writes()).toEqual([])
  })

  it('a node in a cascade cannot be deleted and names it', async () => {
    server(node({ cascadeNeedsEngines: [{ engine: 'xray', cascades: [{ id: 'c', name: 'a4-test', enabled: true }] }] }))
    page()
    await screen.findByText(/стоит в каскаде \(a4-test\)/)
    expect(screen.queryByRole('button', { name: 'Удалить ноду' })).toBeNull()
  })

  it('a node holding the last host of a squad cannot be deleted and names the squad', async () => {
    server(node(), {
      'GET /api/hosts': { body: { hosts: [{ id: 'h1', bindingId: 'b', remark: 'Direct', hiddenByCascade: null }] } },
      'GET /api/squads': { body: { squads: [{ id: 's', name: 'premium', description: null, hostIds: ['h1'], profileIds: ['p'], memberCount: 1, hwidDeviceLimit: null }] } },
    })
    page()
    await screen.findByText(/последние хосты сквада \(premium\)/)
    expect(screen.queryByRole('button', { name: 'Удалить ноду' })).toBeNull()
  })

  it('F-32: squads still loading close the delete with the reason', async () => {
    server(node(), { 'GET /api/squads': { hold: true } })
    page()
    await screen.findByText(/Не могу проверить сквады/)
    expect(screen.queryByRole('button', { name: 'Удалить ноду' })).toBeNull()
  })

  it('F-32: hosts or squads that failed close the delete, not "nobody loses"', async () => {
    const s = server(node(), { 'GET /api/hosts': { status: 500, body: {} } })
    page()
    await screen.findByText(/Не могу проверить сквады/, {}, { timeout: 8000 })
    expect(screen.queryByRole('button', { name: 'Удалить ноду' })).toBeNull()
    expect(s.writes()).toEqual([])
  })

  it('F-16, Bk-159: a reissue promises no revoked token and offers no new payload', async () => {
    const s = server(node(), { 'POST /api/nodes/n1/bootstrap': { body: { token: 't', expiresAt: '2026-11-06T13:00:00Z', command: 'bash install --payload-file x', payloadOnly: true } } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Обслуживание' }))
    await userEvent.click(screen.getByRole('button', { name: 'Новая команда' }))
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/не подтверждает, что прежние токены отозваны/)
    await userEvent.click(within(ask).getByRole('button', { name: 'Новая команда' }))
    await screen.findByText(/Новый файл со страницы ноды в этой версии получить нельзя/)
    expect(screen.queryByRole('button', { name: /Скачать/ })).toBeNull()
    expect(s.writes()).toHaveLength(1)
  })
})
