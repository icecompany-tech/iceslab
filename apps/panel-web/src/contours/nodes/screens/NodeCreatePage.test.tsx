// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NodeCreatePage from '@/contours/nodes/screens/NodeCreatePage'
import { renderApp, stubServer } from '@/test/app'

const created = (bootstrap: object) => ({ id: 'n9', name: 'de-09', address: '9.9.9.9:1337', status: 'unknown', cores: null, payload: 'SECRET', bootstrap })

const server = (over: Record<string, object> = {}) =>
  stubServer({
    'GET /api/nodes': { body: { nodes: [{ id: 'n1', name: 'de-01', address: '91.1.1.1:1337', status: 'online' }], total: 1 } },
    'GET /api/regions': { body: { regions: [] } },
    'GET /api/nodes/n9': { body: { id: 'n9', name: 'de-09', address: '9.9.9.9:1337', status: 'unknown', cores: null } },
    ...over,
  })

const fill = (name: string, host: string) => {
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Адрес сервера'), { target: { value: host } })
}

afterEach(() => vi.unstubAllGlobals())

describe('NodeCreatePage', () => {
  it('names who holds the name and the address before asking the server', async () => {
    const s = server()
    renderApp(<NodeCreatePage />, { route: '/nodes/new' })
    await waitFor(() => expect(s.sent.length).toBeGreaterThan(0))
    fill('de-01', '91.1.1.1')
    await screen.findByText('Такое имя уже есть')
    await screen.findByText('Адрес уже занят нодой de-01')
    expect((screen.getByRole('button', { name: 'Создать' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('загрузка: the form is open while the list of nodes is on its way', () => {
    server()
    renderApp(<NodeCreatePage />, { route: '/nodes/new' })
    expect(screen.getByLabelText('Имя')).toBeTruthy()
    expect(screen.queryByText('Такое имя уже есть')).toBeNull()
  })

  it('не проверено: a list that did not come claims nothing taken, the server decides', async () => {
    const s = server({ 'GET /api/nodes': { status: 500, body: {} }, 'POST /api/nodes': { status: 409, body: { error: 'NODE_EXISTS', message: 'Node with this name exists' } } })
    renderApp(<NodeCreatePage />, { route: '/nodes/new' })
    fill('de-01', '91.1.1.1')
    expect(screen.queryByText('Такое имя уже есть')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    await screen.findByText('Такое имя уже есть')
    expect(s.writes()).toHaveLength(1)
  })

  it('сбой: a refused create stays on the form in the server words', async () => {
    server({ 'POST /api/nodes': { status: 400, body: { error: 'INVALID_ENGINES', message: 'bad engines' } } })
    renderApp(<NodeCreatePage />, { route: '/nodes/new' })
    fill('de-09', '9.9.9.9')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    await screen.findByText(/bad engines/)
    expect(screen.getByLabelText('Имя')).toBeTruthy()
  })

  it('пусто: no cores are a choice, the closed step says only the agent', () => {
    server()
    renderApp(<NodeCreatePage />, { route: '/nodes/new' })
    fireEvent.click(screen.getByRole('button', { name: /Ядра/ }))
    expect(screen.getByRole('button', { name: /только агент/ })).toBeTruthy()
  })

  it('creates with no cores ticked: only the agent, and shows the command once', async () => {
    const s = server({ 'POST /api/nodes': { status: 201, body: created({ token: 't', expiresAt: '2026-11-06T12:15:00Z', command: 'bash install --bootstrap t' }) } })
    renderApp(<NodeCreatePage />, { route: '/nodes/new' })
    fill('de-09', '9.9.9.9')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    await screen.findByText('bash install --bootstrap t')
    const body = s.writes()[0]?.body as { intendedEngines: string[]; address: string }
    expect(body.intendedEngines).toEqual([])
    expect(body.address).toBe('9.9.9.9:1337')
  })

  it('F-29: without https the order is download, scp, run, and closing without the file asks', async () => {
    server({ 'POST /api/nodes': { status: 201, body: created({ token: 't', expiresAt: '2026-11-06T12:15:00Z', command: 'bash install --payload-file /root/node.payload', payloadOnly: true }) } })
    renderApp(<NodeCreatePage />, { route: '/nodes/new' })
    fill('de-09', '9.9.9.9')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    await screen.findByText('Панель без https: установка файлом')
    const steps = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(steps[0]?.textContent).toMatch(/Скачайте/)
    expect(steps[1]?.textContent).toMatch(/scp/)
    expect(steps[2]?.textContent).toMatch(/--payload-file/)
    await userEvent.click(screen.getByRole('button', { name: 'Открыть ноду' }))
    expect((await screen.findByRole('dialog')).textContent).toMatch(/показан один раз/)
  })
})
