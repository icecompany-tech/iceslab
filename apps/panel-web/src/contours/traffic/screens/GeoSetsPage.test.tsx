// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import GeoSetsPage from '@/contours/traffic/screens/GeoSetsPage'
import { renderApp, stubServer } from '@/test/app'

const current = { version: 'v2', sha256: 'a', sourceSha256: 'a', sizeBytes: 10, fetchedAt: '2026-11-06T10:00:00Z', tagCount: 253 }
const base = { format: 'dat', status: 'verified', checkedAt: '', error: null, current, usedByRules: 0, nodes: { total: 0, behind: 0 }, createdAt: '', updatedAt: '' }
const builtin = { ...base, id: 'b', name: 'geoip', kind: 'geoip', source: { type: 'builtin', tag: '2026' } }
const byUrl = { ...base, id: 'u', name: 'own', kind: 'geosite', source: { type: 'url', url: 'https://x/g.dat', sha256Source: 'sidecar', refreshHours: 24 }, nodes: { total: 3, behind: 1 } }
const held = { ...base, id: 'h', name: 'held', kind: 'geosite', source: { type: 'url', url: 'https://x/h.dat', sha256Source: 'manual', refreshHours: 6 }, usedByRules: 2 }
const uploaded = { ...base, id: 'f', name: 'filed', kind: 'geoip', source: { type: 'upload', filename: 'f.dat' } }
const brokenEmpty = { ...base, id: 'e', name: 'dead', kind: 'geoip', status: 'broken', error: 'bad magic', current: null, source: { type: 'upload', filename: 'd.dat' } }
const brokenUpdate = { ...byUrl, id: 'y', name: 'stale', status: 'broken', error: 'no sum' }
const checking = { ...byUrl, id: 'c', name: 'busy', status: 'checking', current: null }

const server = (over: Parameters<typeof stubServer>[0] = {}) =>
  stubServer({
    'GET /api/geo-sets': { body: { geoSets: [builtin, byUrl, held, uploaded] } },
    'GET /api/nodes': { body: { nodes: [], fields: ['geo'], total: 0 } },
    ...over,
  })

const openMenu = async (name: string) => userEvent.click(await screen.findByRole('button', { name: `Действия с набором ${name}` }))
const menuItem = (name: RegExp) => screen.findByRole('menuitem', { name })

vi.setConfig({ testTimeout: 20_000 })

describe('GeoSetsPage', () => {
  it('загрузка', () => {
    server()
    renderApp(<GeoSetsPage />)
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: a list that did not arrive is not "no sets"', async () => {
    server({ 'GET /api/geo-sets': { status: 500, body: {} } })
    renderApp(<GeoSetsPage />)
    await screen.findByText('Список гео-наборов не загрузился', {}, { timeout: 8000 })
    expect(screen.queryByText('Наборов пока нет')).toBeNull()
  })

  it('пусто, and a server with no such route is a third thing', async () => {
    server({ 'GET /api/geo-sets': { body: { geoSets: [] } } })
    const first = renderApp(<GeoSetsPage />)
    await screen.findByText('Наборов пока нет')
    first.unmount()
    server({ 'GET /api/geo-sets': { status: 404, body: {} } })
    renderApp(<GeoSetsPage />)
    await screen.findByText('Этот сервер гео-наборов не знает')
    expect((screen.getByRole('button', { name: 'По ссылке' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('не проверено: broken has two texts, checking sends nothing to nodes', async () => {
    server({ 'GET /api/geo-sets': { body: { geoSets: [brokenEmpty, brokenUpdate, checking] } } })
    renderApp(<GeoSetsPage />)
    await screen.findByText(/Файл не прошёл проверку: bad magic\. Проверенной версии нет/)
    expect(screen.getByText(/Новая версия не прошла проверку: no sum\. На нодах по-прежнему v2/)).toBeTruthy()
    expect(screen.getByText(/На ноды ничего не уходит/)).toBeTruthy()
    expect(screen.getByText('Битые наборы: dead, stale.')).toBeTruthy()
  })

  it('a node list that did not arrive is said, not counted as none behind', async () => {
    server({ 'GET /api/nodes': { status: 500, body: {} } })
    renderApp(<GeoSetsPage />)
    await screen.findByText(/Не загрузился список нод/, {}, { timeout: 8000 })
  })

  it('the row: source, version, tags, and what depends on it', async () => {
    server()
    renderApp(<GeoSetsPage />)
    await screen.findByText(/по ссылке https:\/\/x\/g\.dat, sha256 из соседнего файла, раз в 24 ч/)
    expect(screen.getByText('отстают 1 из 3')).toBeTruthy()
    expect(screen.getByText('в 2 правилах')).toBeTruthy()
    // The age is a real number off the clock: `forgot to read the clock` printed NaN on a live frame.
    expect(screen.getAllByText('забран 2 ч назад · 253 тега').length).toBeGreaterThan(0)
  })

  it('delete is locked with the reason in the menu: built-in', async () => {
    const s = server()
    renderApp(<GeoSetsPage />)
    await openMenu('geoip')
    const item = (await menuItem(/Удалить/)) as HTMLButtonElement
    expect(item.disabled).toBe(true)
    expect(item.textContent).toMatch(/Встроенный набор не удаляется/)
    expect(s.writes()).toEqual([])
  })

  it('delete is locked with the reason in the menu: used by rules', async () => {
    server()
    renderApp(<GeoSetsPage />)
    await openMenu('held')
    const item = (await menuItem(/Удалить/)) as HTMLButtonElement
    expect(item.disabled).toBe(true)
    expect(item.textContent).toMatch(/Набор в 2 правилах, сначала отцепить его там/)
  })

  it('no verified version: rollout is locked, upload has no refresh', async () => {
    server({ 'GET /api/geo-sets': { body: { geoSets: [brokenEmpty] } } })
    renderApp(<GeoSetsPage />)
    await openMenu('dead')
    expect(((await menuItem(/Разослать на ноды/)) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('menuitem', { name: /Обновить сейчас/ })).toBeNull()
    expect(screen.getByRole('menuitem', { name: /Заменить файл/ })).toBeTruthy()
  })

  it('a refusal the list did not foresee: the window names who holds it and leads there', async () => {
    const s = server({ 'DELETE /api/geo-sets/u': { status: 409, body: { error: 'GEO_SET_IN_USE', uses: [{ kind: 'node-policy', id: 'p', name: 'RU' }, { kind: 'node-dns', id: 'n1', name: 'ru-01' }, { kind: 'odd', id: 'x', name: 'new' }] } } })
    renderApp(<GeoSetsPage />)
    await openMenu('own')
    await userEvent.click(await menuItem(/Удалить/))
    const ask = await screen.findByRole('dialog')
    await userEvent.click(within(ask).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(s.writes()).toHaveLength(1))
    await screen.findByText('Пока не удалить')
    expect(screen.getByRole('link', { name: 'политика ноды «RU»' }).getAttribute('href')).toBe('/routes')
    expect(screen.getByRole('link', { name: 'DNS ноды ru-01' }).getAttribute('href')).toBe('/nodes/n1')
    expect(screen.getByText('odd new')).toBeTruthy()
  })

  it('refresh goes to the panel only', async () => {
    const s = server({ 'POST /api/geo-sets/u/refresh': { status: 202, body: { ...byUrl, status: 'checking' } } })
    renderApp(<GeoSetsPage />)
    await openMenu('own')
    await userEvent.click(await menuItem(/Обновить сейчас/))
    await waitFor(() => expect(s.writes().map((w) => w.path)).toEqual(['/api/geo-sets/u/refresh']))
  })

  it('replace file: PUT with the file; over the ceiling never leaves', async () => {
    const s = server({ 'PUT /api/geo-sets/f/file': { body: uploaded } })
    renderApp(<GeoSetsPage />)
    await openMenu('filed')
    await userEvent.click(await menuItem(/Заменить файл/))
    const input = screen.getByLabelText('Новый файл набора filed')
    const big = new File(['x'], 'big.dat')
    Object.defineProperty(big, 'size', { value: 65 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [big] } })
    expect(s.writes()).toEqual([])
    fireEvent.change(input, { target: { files: [new File(['x'], 'ok.dat')] } })
    await waitFor(() => expect(s.writes().map((w) => `${w.method} ${w.path}`)).toEqual(['PUT /api/geo-sets/f/file']))
  })

  it('add by link: name refused at the field, the body by source', async () => {
    const s = server({ 'POST /api/geo-sets': { status: 202, body: { ...byUrl, status: 'checking' } } })
    renderApp(<GeoSetsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'По ссылке' }))
    const dialog = await screen.findByRole('dialog')
    const add = within(dialog).getByRole('button', { name: 'Добавить' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Имя набора'), { target: { value: 'geoip' } })
    await within(dialog).findByText('geosite и geoip заняты встроенными наборами')
    fireEvent.change(within(dialog).getByLabelText('Имя набора'), { target: { value: 'mine' } })
    fireEvent.change(within(dialog).getByLabelText('Ссылка на файл'), { target: { value: 'https://x/m.dat' } })
    await userEvent.click(within(dialog).getByRole('radio', { name: 'руками' }))
    expect(add.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('sha256'), { target: { value: 'A'.repeat(64) } })
    await waitFor(() => expect(add.disabled).toBe(false))
    await userEvent.click(add)
    await waitFor(() => expect(s.writes()).toHaveLength(1))
    expect(s.writes()[0]?.body).toEqual({ name: 'mine', kind: 'geosite', source: { type: 'url', url: 'https://x/m.dat', sha256Source: 'manual', sha256: 'a'.repeat(64), refreshHours: 24 } })
  })

  it('upload: the name is guessed from the file and can be fixed, a too-large file is refused at the field', async () => {
    const s = server()
    renderApp(<GeoSetsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Загрузить файл' }))
    const dialog = await screen.findByRole('dialog')
    const big = new File(['x'], 'My Geo.dat')
    Object.defineProperty(big, 'size', { value: 65 * 1024 * 1024 })
    fireEvent.change(within(dialog).getByLabelText('Файл'), { target: { files: [big] } })
    await within(dialog).findByText(/Файл больше 64 МБ/)
    expect((within(dialog).getByLabelText('Имя набора') as HTMLInputElement).value).toBe('my-geo')
    expect((within(dialog).getByRole('button', { name: 'Загрузить' }) as HTMLButtonElement).disabled).toBe(true)
    expect(s.writes()).toEqual([])
  })

  it('rollout: names restarts before the button, a certain one apart from a maybe', async () => {
    const s = server({
      'GET /api/geo-sets/u/rollout-plan': { body: { version: 'v2', nodes: [{ id: 'n1', name: 'de-01', from: 'v1', filesToSend: ['a.dat'], restartsXray: true }, { id: 'n2', name: 'kz-01', from: null, filesToSend: ['a.dat', 'b.dat'], restartsXray: true }, { id: 'n3', name: 'nl-01', from: 'v2', filesToSend: [], restartsXray: false }], breaks: [] } },
      'GET /api/nodes': { body: { nodes: [{ id: 'n1', cores: [] }, { id: 'n2' }, { id: 'n3', cores: [] }], fields: ['geo'], total: 3 } },
      'POST /api/geo-sets/u/rollout': { body: { nodes: 2 } },
    })
    renderApp(<GeoSetsPage />)
    await openMenu('own')
    await userEvent.click(await menuItem(/Разослать на ноды/))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/Замена \.dat перезапустит xray на 1 ноде: de-01/)
    await within(dialog).findByText(/Возможно перезапустит xray на 1 ноде: kz-01/)
    expect(within(dialog).getByText('v1 → v2')).toBeTruthy()
    expect(within(dialog).getByText('без пина → v2')).toBeTruthy()
    expect(within(dialog).getByText(/Пин ещё 1 ноды уже на этой версии/)).toBeTruthy()
    expect(s.writes()).toEqual([])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Разослать' }))
    await waitFor(() => expect(s.writes()[0]?.body).toEqual({ version: 'v2' }))
  })

  it('rollout: rules on missing tags close the button and are named', async () => {
    const s = server({ 'GET /api/geo-sets/u/rollout-plan': { body: { version: 'v2', nodes: [{ id: 'n1', name: 'de-01', from: 'v1', filesToSend: ['a.dat'], restartsXray: false }], breaks: [{ entry: 'ext:own:gone', uses: [{ kind: 'node-policy', id: 'p', name: 'RU' }] }] } } })
    renderApp(<GeoSetsPage />)
    await openMenu('own')
    await userEvent.click(await menuItem(/Разослать на ноды/))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('ext:own:gone')
    expect(within(dialog).getByText(/политика ноды «RU»/)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Разослать' }) as HTMLButtonElement).disabled).toBe(true)
    expect(s.writes()).toEqual([])
  })

  it('rollout: nowhere to send has two different answers', async () => {
    server({ 'GET /api/geo-sets/u/rollout-plan': { body: { version: 'v2', nodes: [], breaks: [] } } })
    renderApp(<GeoSetsPage />)
    await openMenu('own')
    await userEvent.click(await menuItem(/Разослать на ноды/))
    await screen.findByText(/правила ни одной ноды этот набор не используют/)
  })

  it('rollout: a stale plan is reread and said', async () => {
    let plans = 0
    server({
      'GET /api/geo-sets/u/rollout-plan': () => {
        plans += 1
        return { body: { version: plans === 1 ? 'v2' : 'v3', nodes: [{ id: 'n1', name: 'de-01', from: 'v1', filesToSend: ['a.dat'], restartsXray: false }], breaks: [] } }
      },
      'POST /api/geo-sets/u/rollout': { status: 409, body: { error: 'GEO_ROLLOUT_STALE', current: 'v3' } },
    })
    renderApp(<GeoSetsPage />)
    await openMenu('own')
    await userEvent.click(await menuItem(/Разослать на ноды/))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('v1 → v2')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Разослать' }))
    await within(dialog).findByText(/версия набора сменилась/)
    await within(dialog).findByText('v1 → v3')
  })
})
