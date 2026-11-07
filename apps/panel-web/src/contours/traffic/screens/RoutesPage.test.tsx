// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoutesPage from '@/contours/traffic/screens/RoutesPage'
import { renderApp, stubServer } from '@/test/app'

const rule = (id: string, domain: string[], over: object = {}) => ({ id, position: 0, enabled: true, match: { domain, ip: [], port: null, protocol: [], network: null }, action: { kind: 'block', directionId: null }, shadowedBy: null, ...over })
const nodePolicy = (over: object = {}) => ({ id: 'np1', name: 'main', description: null, rules: [rule('r1', ['geosite:ads']), rule('r2', ['ads.com'], { shadowedBy: { id: 'r1', position: 0 } })], nodeCount: 2, createdAt: '', updatedAt: 'u1', ...over })
const routePolicy = (over: object = {}) => ({ id: 'rp1', name: 'noads', ordinal: 1, directDomains: ['vk.com'], blockDomains: ['ads.com'], ...over })
const builtIn = (id: string) => ({ id, name: id, builtIn: true, rules: [{ id: '', match: ['geoip:ru'], action: 'direct', note: '' }] })

const server = (over: Parameters<typeof stubServer>[0] = {}) =>
  stubServer({
    'GET /api/node-policies': { body: { policies: [nodePolicy()] } },
    'GET /api/route-policies': { body: { policies: [routePolicy()] } },
    'GET /api/routing-presets': { body: { presets: [builtIn('proxy-all'), builtIn('ru-split'), { id: 'own', name: 'mine', builtIn: false, rules: [{ id: 'a', match: ['x.ru'], action: 'direct', note: '' }] }] } },
    'GET /api/settings': { body: { subscriptionRoutingPreset: 'proxy-all', subscriptionCustomDomainLists: null, subscriptionCustomRoutingRules: null } },
    'GET /api/squads': { body: { squads: [{ id: 's', name: 'premium', policyIds: ['rp1'], profileIds: [], hostIds: [], memberCount: 1, exitAcl: [] }] } },
    'GET /api/cascades': { body: { cascades: [{ id: 'c1', name: 'a4', entryPolicy: null, directions: [{ id: 'd1', tag: 1, countryCode: 'de', nodeIds: [] }], positions: [], hops: [] }], fields: ['entryPolicy'] } },
    'GET /api/geo-sets': { body: { geoSets: [] } },
    ...over,
  })

const openTab = async (name: RegExp) => userEvent.click(await screen.findByRole('button', { name }))

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('RoutesPage', () => {
  it('загрузка', () => {
    server()
    renderApp(<RoutesPage />)
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой: a list that did not arrive is said, not "no policies"', async () => {
    server({ 'GET /api/node-policies': { status: 500, body: {} } })
    renderApp(<RoutesPage />)
    await screen.findByText('Список не загрузился', {}, { timeout: 8000 })
    expect(screen.queryByText(/Ни одной политики/)).toBeNull()
  })

  it('пусто: no node policies invite the first', async () => {
    server({ 'GET /api/node-policies': { body: { policies: [] } } })
    renderApp(<RoutesPage />)
    await screen.findByText(/Ни одной политики/)
  })

  it('не проверено: a count the server did not send is unknown, not "on no node"', async () => {
    server({ 'GET /api/node-policies': { body: { policies: [nodePolicy({ nodeCount: undefined })] } } })
    renderApp(<RoutesPage />)
    await screen.findAllByText(/на скольких нодах, неизвестно/)
    expect(screen.queryByText(/ни на одной ноде/)).toBeNull()
  })

  it('node policy: untouched sends nothing, a rename only the name, a move the whole list', async () => {
    const s = server({ 'PUT /api/node-policies/np1': { body: nodePolicy() } })
    renderApp(<RoutesPage />)
    const save = (await screen.findByRole('button', { name: 'Сохранить' })) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Название политики'), { target: { value: 'x' } })
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await waitFor(() => expect(s.writes()[0]).toEqual({ method: 'PUT', path: '/api/node-policies/np1', body: { name: 'x' } }))
  })

  it('node policy: moving a rule sends the list in the new order, ids kept', async () => {
    const s = server({ 'PUT /api/node-policies/np1': { body: nodePolicy() } })
    renderApp(<RoutesPage />)
    await userEvent.click((await screen.findAllByRole('button', { name: 'Ниже' }))[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(s.writes()).toHaveLength(1))
    const body = s.writes()[0]?.body as { rules: { id: string }[]; name?: string }
    expect(body.rules.map((r) => r.id)).toEqual(['r2', 'r1'])
    expect(body.name).toBeUndefined()
  })

  it('node policy: a dead rule names who eats it, the word direct never shows', async () => {
    server()
    renderApp(<RoutesPage />)
    await screen.findByText(/никогда не сработает: выше стоит geosite:ads/)
    expect(screen.queryByText(/^direct$/)).toBeNull()
    expect(screen.getAllByRole('option', { name: 'С нашего IP' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('option', { name: /Выходом каскада: a4, DE/ }).length).toBeGreaterThan(0)
  })

  it('node policy: typing a separator does not vanish under the caret', async () => {
    server()
    renderApp(<RoutesPage />)
    const field = (await screen.findAllByLabelText('Если это'))[0] as HTMLInputElement
    await userEvent.click(field)
    await userEvent.clear(field)
    await userEvent.type(field, 'a.com, b.com')
    expect(field.value).toBe('a.com, b.com')
  })

  it('node policy: the server refusal stays word for word', async () => {
    server({ 'PUT /api/node-policies/np1': { status: 409, body: { error: 'POLICY_DOES_NOT_FIT_NODE', message: 'de-01 has no warp' } } })
    renderApp(<RoutesPage />)
    fireEvent.change(await screen.findByLabelText('Название политики'), { target: { value: 'x' } })
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByText('de-01 has no warp')
  })

  it('F-K6: deleting a node policy says how many nodes rewrite', async () => {
    const s = server({ 'DELETE /api/node-policies/np1': { status: 204, body: {} } })
    renderApp(<RoutesPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    const ask = await screen.findByRole('dialog')
    expect(ask.textContent).toMatch(/Её носят 2 ноды/)
    expect(s.writes()).toEqual([])
    await userEvent.click(within(ask).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(s.writes()).toHaveLength(1))
  })

  it('F-10: a new squad policy with nothing is closed, the reason in the table', async () => {
    const s = server()
    renderApp(<RoutesPage />)
    await openTab(/Правила сквадов/)
    await userEvent.click(screen.getByRole('button', { name: 'Новая политика' }))
    const save = (await screen.findByRole('button', { name: 'Сохранить' })) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText('Название политики'), { target: { value: 'x' } })
    await screen.findByText(/Пустую политику сохранить нельзя/)
    expect(save.disabled).toBe(true)
    expect(s.writes()).toEqual([])
  })

  it('squad policy: untouched closed, a list change sends that list, unknown entries at their row', async () => {
    const s = server({ 'PUT /api/route-policies/rp1': { status: 400, body: { error: 'ROUTE_POLICY_ENTRY_UNKNOWN', entries: ['ads.org'] } } })
    renderApp(<RoutesPage />)
    await openTab(/Правила сквадов/)
    await userEvent.click(await screen.findByRole('button', { name: /noads/ }))
    const save = (await screen.findByRole('button', { name: 'Сохранить' })) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getAllByLabelText('Если это')[0] as HTMLElement, { target: { value: 'ads.org' } })
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await screen.findByText('Не имя и не адрес: ads.org.')
    expect(s.writes()[0]?.body).toEqual({ blockDomains: ['ads.org'] })
  })

  it('squad policy: the plain profile has no delete and says so', async () => {
    server()
    renderApp(<RoutesPage />)
    await openTab(/Правила сквадов/)
    await screen.findByText(/Своих правил у него нет/)
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull()
  })

  it('squad policy in a cascade entry: delete opens "not yet" with the way there', async () => {
    const s = server({ 'GET /api/cascades': { body: { cascades: [{ id: 'c1', name: 'a4', entryPolicy: { id: 'rp1', name: 'noads', ordinal: 1 }, directions: [], positions: [], hops: [] }], fields: ['entryPolicy'] } } })
    renderApp(<RoutesPage />)
    await openTab(/Правила сквадов/)
    await userEvent.click(await screen.findByRole('button', { name: /noads/ }))
    const del = await screen.findByRole('button', { name: 'Удалить' })
    await waitFor(() => expect(s.sent.some((r) => r.path === '/api/cascades')).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    await userEvent.click(del)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/Пока не удалить/)
    expect(within(dialog).getByRole('link', { name: 'a4' }).getAttribute('href')).toBe('/cascades/c1')
    expect(s.writes()).toEqual([])
  })

  it('device: a built-in is read only with no delete, names translated', async () => {
    server()
    renderApp(<RoutesPage />)
    await openTab(/Пресеты устройств/)
    await screen.findByRole('heading', { name: 'Всё через туннель' })
    expect(screen.getByText('встроенный, удалить нельзя')).toBeTruthy()
    expect(screen.getByText(/Доедет не до всех/)).toBeTruthy()
    expect(screen.getByText('Локалка и российские адреса идут напрямую.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull()
  })

  it('device: an assigned preset names who holds it in the delete window', async () => {
    server({ 'DELETE /api/routing-presets/own': { status: 409, body: { error: 'ROUTING_PRESET_IN_USE', users: [{ username: 'kate' }], userCount: 1, squads: [], squadCount: 0 } } })
    renderApp(<RoutesPage />)
    await openTab(/Пресеты устройств/)
    await userEvent.click(await screen.findByRole('button', { name: /mine/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    const ask = await screen.findByRole('dialog')
    await userEvent.click(within(ask).getByRole('button', { name: 'Удалить' }))
    await within(ask).findByText(/Пресет назначен: 1 юзеру \(«kate»\)/)
  })

  it('device, F-26: an own list refuses a bad line at the field, only the changed side goes out', async () => {
    const s = server({ 'PUT /api/settings': { body: { ok: true, updated: [] } } })
    renderApp(<RoutesPage />)
    await openTab(/Пресеты устройств/)
    await openTab(/Свои правила/)
    const field = await screen.findByLabelText('Напрямую, мимо туннеля')
    const saves = () => screen.getAllByRole('button', { name: 'Сохранить' })
    fireEvent.change(field, { target: { value: 'a.com, b.com' } })
    await screen.findByText(/без запятых и пробелов/)
    expect((saves().at(-1) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'vk.com' } })
    await waitFor(() => expect((saves().at(-1) as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(saves().at(-1) as HTMLElement)
    await waitFor(() => expect(s.writes()).toEqual([{ method: 'PUT', path: '/api/settings', body: { subscriptionCustomDomainLists: { direct: ['vk.com'], proxy: [], block: [] } } }]))
  })

  it('device: raw rules that are not an array stay at the field', async () => {
    server()
    renderApp(<RoutesPage />)
    await openTab(/Пресеты устройств/)
    await openTab(/Свои правила/)
    fireEvent.change(await screen.findByLabelText(/Сырые правила Xray/), { target: { value: '{"a":1}' } })
    await screen.findByText('это не массив правил')
  })

  it('a dead prefix is refused at its row, the save closed, nothing sent', async () => {
    const s = server()
    renderApp(<RoutesPage />)
    await openTab(/Правила сквадов/)
    await userEvent.click(await screen.findByRole('button', { name: /noads/ }))
    fireEvent.change((await screen.findAllByLabelText('Если это'))[0] as HTMLElement, { target: { value: 'ip:1.1.1.1' } })
    await screen.findByText(/ip:1\.1\.1\.1: адрес или CIDR пишется без префикса/)
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true)
    expect(s.writes()).toEqual([])
  })

  it('import opens a draft and saves nothing', async () => {
    const s = server()
    renderApp(<RoutesPage />)
    await openTab(/Правила сквадов/)
    const input = screen.getByLabelText('Файл с правилами')
    const good = new File([''], 'a.json')
    Object.defineProperty(good, 'text', { value: () => Promise.resolve(JSON.stringify({ policies: [{ name: 'imp', rules: [{ match: ['a.com'], action: 'block' }, { match: ['b.com'], action: 'warp' }] }] })) })
    fireEvent.change(input, { target: { files: [good] } })
    await screen.findByDisplayValue('imp')
    expect(screen.getByDisplayValue('a.com')).toBeTruthy()
    expect(s.writes()).toEqual([])
  })
})
