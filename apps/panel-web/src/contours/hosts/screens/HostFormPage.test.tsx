// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HostFormPage from '@/contours/hosts/screens/HostFormPage'
import { ALL_SQUAD_ID } from '@/lib/domain/squads'
import { renderApp, stubServer } from '@/test/app'

const host = { id: 'h1', bindingId: 'b1', remark: 'Direct', enabled: true, addressOverride: null, portOverride: null, sniOverride: null, hostHeaderOverride: null, pathOverride: null, fingerprintOverride: null, alpn: [], allowInsecure: false, securityLayer: 'default', disableForFormats: [], serverDescription: null, isHidden: false, hiddenByCascade: null, reach: { squads: 1, users: 10 } }
const squad = (id: string, name: string, hostIds: string[], profileIds: string[]) => ({ id, name, description: null, hostIds, profileIds, exitAcl: [], policyIds: [], memberCount: 3, hwidDeviceLimit: null })

const server = (over: Record<string, object> = {}) =>
  stubServer({
    'GET /api/hosts': { body: { hosts: [host] } },
    'GET /api/bindings': { body: { bindings: [{ id: 'b1', profileId: 'p1', nodeId: 'n1', port: 443 }] } },
    'GET /api/nodes': { body: { nodes: [{ id: 'n1', name: 'de-01', address: '91.1.1.1:1337', status: 'online', countryCode: 'DE', engines: ['xray'] }], total: 1 } },
    'GET /api/profiles': { body: { profiles: [{ id: 'p1', name: 'vless-1', protocol: 'xray', effectiveEngine: 'xray', config: { network: 'raw' } }] } },
    'GET /api/squads': { body: { squads: [squad(ALL_SQUAD_ID, 'All', [], ['p1']), squad('s1', 'premium', ['other'], ['p9'])] } },
    'GET /api/profiles/p1/host-fields': { body: { fields: { sniOverride: { supported: true } } } },
    'GET /api/profiles/p1/formats': { body: { door: 'x', formats: [{ format: 'xray', carried: true, why: 'carried' }] } },
    'POST /api/nodes/n1/port-check': { body: { ok: true, certainty: 'known', conflicts: [] } },
    ...over,
  })

const page = (route = '/hosts/h1') =>
  renderApp(
    <Routes>
      <Route path="/hosts/new" element={<HostFormPage />} />
      <Route path="/hosts/:id" element={<HostFormPage />} />
      <Route path="/hosts" element={<div>list</div>} />
    </Routes>,
    { route },
  )

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('HostFormPage', () => {
  it('загрузка', () => {
    server()
    page()
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой', async () => {
    server({ 'GET /api/hosts': { status: 500, body: {} } })
    page()
    await screen.findByText('Хосты не загрузились', {}, { timeout: 8000 })
  })

  it('пусто: a deleted host says so', async () => {
    server({ 'GET /api/hosts': { body: { hosts: [] } } })
    page()
    await screen.findByText('Уже удалён')
  })

  it('не проверено: fields that did not come say so', async () => {
    server({ 'GET /api/profiles/p1/host-fields': { status: 500, body: {} } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Как видит клиент/ }))
    await screen.findByText('Поля профиля не загрузились', {}, { timeout: 8000 })
  })

  it('an untouched form sends nothing, a change only itself', async () => {
    const s = server({ 'PUT /api/hosts/h1': { body: host } })
    page()
    const save = (await screen.findByRole('button', { name: 'Сохранить' })) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'New' } })
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/hosts/h1', body: { remark: 'New' } }]))
  })

  it('F-15: the own address refuses at the field and closes the save', async () => {
    server()
    page()
    await userEvent.click(await screen.findByRole('button', { name: /^Адрес/ }))
    fireEvent.change(screen.getByLabelText('Своё имя или адрес'), { target: { value: 'a.example:443' } })
    await screen.findByText('Без порта: порт задаётся отдельно')
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a wrong SNI stands at the field with the names the node serves', async () => {
    server({ 'PUT /api/hosts/h1': { status: 400, body: { error: 'SNI_MISMATCH', expected: ['a.example'] } } })
    page()
    fireEvent.change(await screen.findByLabelText('Имя'), { target: { value: 'New' } })
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByText(/Нода обслуживает только: a\.example/)
  })

  it('the last host of a squad cannot be deleted, the window names it', async () => {
    const s = server({ 'GET /api/squads': { body: { squads: [squad('s1', 'premium', ['h1'], ['p1'])] } } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить хост' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/последний хост сквада \(premium\)/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить хост' }))
    expect(s.writes()).toEqual([])
  })

  it('a new host goes in a second request to the squads, read fresh; All is closed', async () => {
    const s = server({ 'POST /api/hosts': { status: 201, body: { ...host, id: 'h9' } }, 'PUT /api/squads/s1': { body: {} }, 'GET /api/hosts/h9': { body: { ...host, id: 'h9' } } })
    page('/hosts/new?profileId=p1&nodeId=n1')
    fireEvent.change(await screen.findByLabelText('Имя'), { target: { value: 'New' } })
    await userEvent.click(screen.getByRole('button', { name: /Нода и порт/ }))
    fireEvent.change(screen.getByLabelText('Порт на ноде'), { target: { value: '8443' } })
    await userEvent.click(screen.getByRole('button', { name: /Выдать в сквады/ }))
    expect((screen.getByRole('checkbox', { name: 'All' }) as HTMLInputElement).disabled).toBe(true)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'premium' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Создать' }) as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    await waitFor(() => expect(s.writes().find((w) => w.path === '/api/squads/s1')?.body).toEqual({ hostIds: ['other', 'h9'], profileIds: ['p9', 'p1'] }))
  })

  it('a refused hand-over names the squad and stays on the host', async () => {
    server({ 'PUT /api/squads/s1': { status: 400, body: { error: 'X', message: 'squad says no' } }, 'PUT /api/hosts/h1': { body: host } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Выдать в сквады/ }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'premium' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByText(/не выдан в сквады: premium: squad says no/)
  })
})
