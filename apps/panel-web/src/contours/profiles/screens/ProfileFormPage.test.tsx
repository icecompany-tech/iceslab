// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProfileFormPage from '@/contours/profiles/screens/ProfileFormPage'
import { renderApp, stubServer } from '@/test/app'

const xray = { id: 'p1', name: 'vless-1', protocol: 'xray', engine: null, effectiveEngine: 'xray', description: null, enabled: true, awgProtocol: null, bindingCount: 2, userCount: 12, config: { realityDest: 'www.cloudflare.com:443', realityServerNames: ['www.cloudflare.com'], realityShortIds: ['ab'], realityPrivateKey: 'priv', realityPublicKey: 'pub', network: 'raw', security: 'reality', subprotocol: 'vless', flow: 'xtls-rprx-vision', fingerprint: 'firefox', realityMode: 'steal-others' } }

const awg = { ...xray, id: 'p2', name: 'awg-1', protocol: 'amneziawg', effectiveEngine: 'amneziawg', config: { subnet: '10.66.66.0/24', serverPrivateKey: 'p', serverPublicKey: 'q', obfuscation: { jc: 4, jmin: 40, jmax: 70, s1: 0, s2: 0, s3: 0, s4: 0, h1: 11, h2: 22, h3: 33, h4: 44 } } }

const server = (over: Record<string, object> = {}) =>
  stubServer({
    'GET /api/profiles': { body: { profiles: [xray, awg] } },
    'GET /api/bindings': { body: { bindings: [] } },
    'GET /api/hosts': { body: { hosts: [] } },
    'GET /api/nodes': { body: { nodes: [], total: 0 } },
    'GET /api/profiles/p1/formats': { body: { formats: [] } },
    'GET /api/profiles/p2/formats': { body: { formats: [] } },
    'GET /api/profiles/p1/key-impact': { body: { hosts: 2, nodes: 1, bindings: 2, configs: 21 } },
    'GET /api/profiles/p2/key-impact': { body: { hosts: 0, nodes: 0, bindings: 0, configs: 0 } },
    'POST /api/profiles/generate-keypair': { body: { privateKey: 'new-priv', publicKey: 'new-pub' } },
    ...over,
  })

const page = (route = '/profiles/p1') =>
  renderApp(
    <Routes>
      <Route path="/profiles/new" element={<ProfileFormPage />} />
      <Route path="/profiles/:id" element={<ProfileFormPage />} />
      <Route path="/profiles" element={<div>list</div>} />
    </Routes>,
    { route },
  )

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('ProfileFormPage', () => {
  it('загрузка', () => {
    server()
    page()
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/)
  })

  it('сбой', async () => {
    server({ 'GET /api/profiles': { status: 500, body: {} } })
    page()
    await screen.findByText('Профили не загрузились', {}, { timeout: 8000 })
  })

  it('пусто: a deleted profile says so', async () => {
    server({ 'GET /api/profiles': { body: { profiles: [] } } })
    page()
    await screen.findByText('Уже удалён')
  })

  it('не проверено: formats that did not come are unknown, not "all clients"', async () => {
    server({ 'GET /api/profiles/p1/formats': { status: 500, body: {} } })
    page()
    await screen.findByText('неизвестно: ответ сервера не пришёл.', {}, { timeout: 8000 })
  })

  it('an untouched form cannot save, a change sends only itself', async () => {
    const s = server({ 'PUT /api/profiles/p1': { body: { ...xray, name: 'vless-2' } }, 'POST /api/profiles/p1/test-connect': { body: { results: [] } } })
    page()
    const save = (await screen.findByRole('button', { name: 'Сохранить' })) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'vless-2' } })
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    await waitFor(() => expect(s.writes()[0]).toEqual({ method: 'PUT', path: '/api/profiles/p1', body: { name: 'vless-2' } }))
  })

  it('a new pair asks with the server numbers read again, in the right case', async () => {
    const s = server()
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Защита/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Новая пара' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/2 хоста на 1 ноде/)
    expect(dialog.textContent).toMatch(/21/)
    expect(s.writes()).toEqual([])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
  })

  it('a count that did not come asks without numbers', async () => {
    server({ 'GET /api/profiles/p1/key-impact': { status: 500, body: {} } })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Защита/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Новая пара' }))
    expect((await screen.findByRole('dialog', {}, { timeout: 8000 })).textContent).toMatch(/Цену узнать не удалось/)
  })

  it('no window when nothing can break: zeros generate at once', async () => {
    const s = server()
    page('/profiles/p2')
    await userEvent.click(await screen.findByRole('button', { name: /Ключи/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Новая пара' }))
    await waitFor(() => expect(s.sent.some((r) => r.method === 'POST' && r.path.startsWith('/api/profiles/generate-keypair'))).toBe(true))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('AWG: says how many users the subnet holds, and does not advise changing it on a live profile', async () => {
    server()
    page('/profiles/p2')
    await userEvent.click(await screen.findByRole('button', { name: /Сеть/ }))
    await screen.findByText(/Хватит на 253 юзеров.*каждый юзер с охватом/)
    expect((screen.getByLabelText(/Подсеть/) as HTMLInputElement).disabled).toBe(true)
  })

  it('a transport REALITY cannot run on keeps the choice and closes the save with the reason', async () => {
    server()
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Транспорт/ }))
    await userEvent.click(screen.getByRole('radio', { name: /^ws/ }))
    expect(((await screen.findByRole('button', { name: 'Сохранить' })) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /Защита/ }))
    expect(screen.getByRole('alert').textContent).toMatch(/выбранная защита не работает/)
  })

  it('E23: a refusing target stands at the field after the save, in numbers from the answer', async () => {
    const s = server({
      'PUT /api/profiles/p1': { body: xray },
      'POST /api/profiles/p1/test-connect': { body: { results: [{ bindingId: 'b', hostId: null, hostRemark: 'h', protocol: 'xray', nodeName: 'n', endpoint: 'e', port: 443, probe: 'tls', kind: 'dest', ok: false, handshakeRecordMax: 8273, error: 'too big' }] } },
    })
    page()
    fireEvent.change(await screen.findByLabelText('Имя'), { target: { value: 'x' } })
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByText(/запись сертификата 8273 байт/)
    expect(s.sent.some((r) => r.path === '/api/profiles/p1/test-connect')).toBe(true)
  })

  it('delete asks with the cost', async () => {
    const s = server()
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить профиль' }))
    expect((await screen.findByRole('dialog')).textContent).toMatch(/Профиль стоит на нодах: 2/)
    expect(s.writes()).toEqual([])
  })

  it('a new profile picks a protocol from flat tiles and creates', async () => {
    const s = server({ 'POST /api/profiles': { status: 201, body: { ...awg, id: 'p3', name: 'hy' } } })
    page('/profiles/new')
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'hy' } })
    expect(screen.getByRole('radio', { name: 'VLESS' })).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: 'Hysteria 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    await waitFor(() => expect((s.writes()[0]?.body as { protocol: string }).protocol).toBe('hysteria'))
  })

  const wire = (over: object = {}) => ({ schemaVersion: 2, id: 'xray-reality-xhttp', engine: 'native', protocol: 'xray', subprotocol: 'vless', emoji: 'x', name: 'EN name', description: 'EN desc', details: 'EN details', dpiResistance: 4, speed: 3, apply: { xrayNetwork: 'xhttp', xrayFlow: '' }, region: 'GLOBAL', verified: true, sourceId: 'default', sourceName: 'official', ...over })
  const registry = (recipes: object[], over: object = {}) => ({ 'GET /api/recipes/registry': { body: { fetchedAt: '', source: 'icecompany-tech/iceslab-recipes', recipes, stale: false, sources: [], hidden: [], ...over } } })

  describe('mKCP', () => {
    const kcp = { ...xray, id: 'p3', name: 'kcp-1', config: { ...xray.config, network: 'kcp', security: 'none', flow: '' } }

    it('a new profile is not offered it', async () => {
      server()
      page('/profiles/new')
      await userEvent.click(await screen.findByRole('button', { name: /Транспорт/ }))
      await screen.findByRole('radio', { name: /xhttp/ })
      expect(screen.queryByRole('radio', { name: /mKCP/ })).toBeNull()
      expect(screen.queryByText(/такой конфиг не принимает/)).toBeNull()
    })

    it('a stored profile on another transport is not offered it', async () => {
      server()
      page()
      await userEvent.click(await screen.findByRole('button', { name: /Транспорт/ }))
      await screen.findByRole('radio', { name: /xhttp/ })
      expect(screen.queryByRole('radio', { name: /mKCP/ })).toBeNull()
    })

    it('a stored mKCP profile shows as it is, with the sentence, and can leave it', async () => {
      server({ 'GET /api/profiles': { body: { profiles: [kcp] } }, 'GET /api/profiles/p3/formats': { body: { formats: [] } } })
      page('/profiles/p3')
      await userEvent.click(await screen.findByRole('button', { name: /Транспорт/ }))
      await screen.findByText(/mKCP: ядро xray такой конфиг не принимает/)
      expect((screen.getByRole('radio', { name: /mKCP/ }) as HTMLInputElement).checked).toBe(true)
      await userEvent.click(screen.getByRole('radio', { name: /^ws/ }))
      await waitFor(() => expect(screen.queryByText(/такой конфиг не принимает/)).toBeNull())
      expect(screen.getByRole('radio', { name: /mKCP/ })).toBeTruthy()
    })
  })

  describe('рецепты', () => {
    it('the rail speaks the panel words by id, a click fills the fields, the save carries them', async () => {
      const s = server({ ...registry([wire()]), 'PUT /api/profiles/p1': { body: xray } })
      page()
      await userEvent.click(await screen.findByRole('button', { name: /REALITY \+ xhttp \(HTTP\/2 chunked\)/ }))
      await screen.findByText('Применён: REALITY + xhttp (HTTP/2 chunked)')
      expect(screen.getByText('Path случайный: не показывайте его публично')).toBeTruthy()
      await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
      await waitFor(() => expect(s.writes().some((w) => w.path === '/api/profiles/p1')).toBe(true))
      const put = s.writes().find((w) => w.path === '/api/profiles/p1')?.body as { config: { network: string; realityPrivateKey: string } }
      expect(put.config.network).toBe('xhttp')
      // Present keys stay: a recipe never changes them in passing.
      expect(put.config.realityPrivateKey).toBe('priv')
      expect(s.writes().some((w) => w.path.includes('generate-keypair'))).toBe(false)
    })

    it('a field a recipe may not set is not written', async () => {
      const s = server({ ...registry([wire({ apply: { xrayNetwork: 'xhttp', xrayPrivateKey: 'everyone-knows', name: 'x' } })]), 'PUT /api/profiles/p1': { body: xray } })
      page()
      await userEvent.click(await screen.findByRole('button', { name: /REALITY \+ xhttp/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
      await waitFor(() => expect(s.writes().some((w) => w.path === '/api/profiles/p1')).toBe(true))
      const put = s.writes().find((w) => w.path === '/api/profiles/p1')?.body as { name?: string; config: { realityPrivateKey: string } }
      expect(put.config.realityPrivateKey).toBe('priv')
      expect(put.name).toBeUndefined()
    })

    it('new profile: a recipe generates the missing keys and shortIds', async () => {
      const s = server({ ...registry([wire()]), 'POST /api/profiles': { status: 201, body: { ...xray, id: 'p9', name: 'mine' } }, 'POST /api/profiles/p9/test-connect': { body: { results: [] } }, 'GET /api/profiles/p9/formats': { body: { formats: [] } } })
      page('/profiles/new')
      await userEvent.click(await screen.findByRole('button', { name: /REALITY \+ xhttp/ }))
      await waitFor(() => expect(s.writes().filter((w) => w.path.includes('generate-keypair'))).toHaveLength(1))
      fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'mine' } })
      await userEvent.click(await screen.findByRole('button', { name: 'Создать' }))
      await waitFor(() => expect(s.writes().some((w) => w.path === '/api/profiles')).toBe(true))
      const post = s.writes().find((w) => w.path === '/api/profiles')?.body as { config: { network: string; realityPrivateKey: string; realityShortIds: string[] } }
      expect(post.config.network).toBe('xhttp')
      expect(post.config.realityPrivateKey).toBe('new-priv')
      expect(post.config.realityShortIds.length).toBeGreaterThan(0)
    })

    it('the registry is down and has no snapshot: said apart from "none for this protocol"', async () => {
      server(registry([], { stale: true }))
      page()
      await screen.findByText(/Реестр рецептов недоступен/)
    })

    it('none for the tile: said with the protocol name, import still offered', async () => {
      server(registry([wire({ protocol: 'hysteria', subprotocol: undefined })]))
      page()
      await screen.findByText('В реестре рецептов для VLESS нет. Импортируйте свой или предложите его в реестр.')
      expect(screen.getByRole('button', { name: 'Импорт' })).toBeTruthy()
    })

    it('from the empty list the full list opens at once', async () => {
      server(registry([wire()]))
      page('/profiles/new?from=recipe')
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: 'Все рецепты' })).toBeTruthy()
    })

    it('all recipes: hide sends the whole list, the hidden come back, the failed source has a line', async () => {
      const s = server({ ...registry([wire(), wire({ id: 'other', name: 'Other' })], { hidden: ['other'], sources: [{ id: 'd', name: 'mirror', ok: false, reason: 'not-found' }] }), 'PUT /api/recipes/hidden': { body: { hidden: ['other', 'xray-reality-xhttp'] } } })
      page()
      await userEvent.click(await screen.findByRole('button', { name: 'Все рецепты' }))
      const dialog = await screen.findByRole('dialog')
      within(dialog).getByText('Реестр mirror не найден (404): репозитория нет')
      await userEvent.click(within(dialog).getByRole('button', { name: 'скрыт 1, показать' }))
      within(dialog).getByRole('button', { name: 'Вернуть' })
      await userEvent.click(within(dialog).getByRole('button', { name: 'Скрыть' }))
      await waitFor(() => expect(s.writes()[0]?.body).toEqual({ ids: ['other', 'xray-reality-xhttp'] }))
    })

    it('all recipes: an own one is marked and has a delete window that says profiles stay', async () => {
      const s = server({ ...registry([wire({ id: 'my', name: 'Mine', sourceId: 'mine', verified: false })]), 'DELETE /api/recipes/mine/my': { status: 404, body: { error: 'RECIPE_NOT_FOUND' } } })
      page()
      await userEvent.click(await screen.findByRole('button', { name: 'Все рецепты' }))
      const dialog = await screen.findByRole('dialog')
      within(dialog).getByText('мой')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))
      const ask = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement
      expect(ask.textContent).toMatch(/Профили, к которым он уже применён, останутся/)
      await userEvent.click(within(ask).getByRole('button', { name: 'Удалить' }))
      await waitFor(() => expect(s.writes()).toHaveLength(1))
      await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    })

    it('import: a GitHub page becomes raw in sight, refusals stand at the field', async () => {
      server({ ...registry([wire()]), 'POST /api/recipes/import': { body: { recipes: [] } } })
      page()
      await userEvent.click(await screen.findByRole('button', { name: 'Импорт' }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText(/Адрес рецепта/), { target: { value: 'https://github.com/o/r/blob/main/a.json' } })
      await within(dialog).findByText('Будет загружено: https://raw.githubusercontent.com/o/r/main/a.json')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }))
      await within(dialog).findByText('Валидных рецептов не найдено.')
    })

    it('import: other protocols are counted, the picked one applies and is saved alone', async () => {
      const mine = wire({ id: 'imp', name: 'Imp', sourceId: undefined })
      const s = server({
        ...registry([wire()]),
        'POST /api/recipes/import': (request: { body?: unknown }) => {
          const body = request.body as { save?: boolean }
          return { body: body.save ? { recipes: [mine], saved: { id: 'imp', replaced: false } } : { recipes: [mine, wire({ id: 'hy', protocol: 'hysteria', subprotocol: undefined })] } }
        },
      })
      page()
      await userEvent.click(await screen.findByRole('button', { name: 'Импорт' }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText(/Адрес рецепта/), { target: { value: 'https://x/a.json' } })
      await userEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }))
      await within(dialog).findByText('Скрыто рецептов для других протоколов: 1.')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Применить' }))
      await waitFor(() => expect(s.writes()).toHaveLength(2))
      expect(s.writes()[0]?.body).toEqual({ url: 'https://x/a.json' })
      expect(JSON.parse((s.writes()[1]?.body as { json: string }).json).id).toBe('imp')
      expect((s.writes()[1]?.body as { save: boolean }).save).toBe(true)
      await screen.findByText('Применён: Imp')
    })

    it('export of a saved profile is the server recipe: the fork path, the ratings warning, no write', async () => {
      const s = server({ ...registry([wire()]), 'GET /api/profiles/p1/recipe': { body: wire({ id: 'my-rec', name: 'From server' }) } })
      page()
      await userEvent.click(await screen.findByRole('button', { name: 'Экспорт' }))
      const dialog = await screen.findByRole('dialog')
      await within(dialog).findByText('recipes/native/xray/vless/my-rec.json')
      expect(within(dialog).getByText(/Оценки DPI и скорости выставлены 3 из 5/)).toBeTruthy()
      expect((within(dialog).getByLabelText('Название') as HTMLInputElement).value).toBe('From server')
      // The screen's provenance stamp stays out of a file that goes to the registry.
      expect((within(dialog).getByLabelText('Экспорт в рецепт') as HTMLTextAreaElement).value).not.toMatch(/"source"/)
      expect(s.writes()).toEqual([])
    })

    it('export of an unsaved profile comes from the form and says so, with no secret', async () => {
      server(registry([wire()]))
      page('/profiles/new')
      await userEvent.click(await screen.findByRole('button', { name: 'Экспорт' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/профиль ещё не сохранён/)).toBeTruthy()
      fireEvent.change(within(dialog).getByLabelText('Название'), { target: { value: 'My RU' } })
      const json = await within(dialog).findByLabelText('Экспорт в рецепт') as HTMLTextAreaElement
      expect(json.value).toMatch(/"id": "my-ru"/)
      expect(json.value).not.toMatch(/xrayPrivateKey/)
    })
  })
})
