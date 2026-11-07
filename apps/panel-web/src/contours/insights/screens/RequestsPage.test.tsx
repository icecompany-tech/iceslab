// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RequestsPage from '@/contours/insights/screens/RequestsPage'
import { renderApp, stubServer } from '@/test/app'

const answer = (over: object = {}) => ({ windowDays: 7, subRequests: { total: 70, uniqueUsers: 2, byClient: [{ client: 'Happ', count: 60 }, { client: 'Other', count: 10 }], byHourUtc: Array.from({ length: 24 }, (_, i) => (i === 3 ? 70 : 0)), ...over }, hwid: { totalDevices: 0, usersWithDevices: 0, avgDevicesPerUser: 0, distribution: [], atOrOverLimit: 0 } })

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('RequestsPage', () => {
  it('загрузка', () => {
    stubServer({ 'GET /api/dashboard/insights': { body: answer() } })
    renderApp(<RequestsPage />)
    expect(screen.getByRole('status').textContent).toMatch(/Считаем/)
  })

  it('сбой: says so and retries', async () => {
    stubServer({ 'GET /api/dashboard/insights': { status: 500, body: {} } })
    renderApp(<RequestsPage />)
    await screen.findByText('Данные не загрузились', {}, { timeout: 8000 })
  })

  it('пусто: nobody fetched, the per-day figure is a dash, not zero', async () => {
    stubServer({ 'GET /api/dashboard/insights': { body: answer({ total: 0, uniqueUsers: 0, byClient: [], byHourUtc: [] }) } })
    renderApp(<RequestsPage />)
    await screen.findByText('За этот период запросов подписки не было')
    expect(screen.getByText('-')).toBeTruthy()
  })

  it('не проверено: clients the panel could not read are counted as unknown, out loud', async () => {
    stubServer({ 'GET /api/dashboard/insights': { body: answer() } })
    renderApp(<RequestsPage />)
    await screen.findByText('Неизвестных клиентов')
    expect(screen.getAllByText('10').length).toBeGreaterThan(0)
    expect(screen.getByText('5.0')).toBeTruthy()
  })

  it('the period asks the server again', async () => {
    const s = stubServer({ 'GET /api/dashboard/insights': { body: answer() } })
    renderApp(<RequestsPage />)
    await screen.findByText('Happ')
    await userEvent.click(screen.getByRole('radio', { name: '30 дн' }))
    await waitFor(() => expect(s.sent.at(-1)?.path).toMatch(/days=30/))
  })

  it('the hours are drawn with their label', async () => {
    stubServer({ 'GET /api/dashboard/insights': { body: answer() } })
    renderApp(<RequestsPage />)
    expect(await screen.findByRole('img', { name: 'По часам, UTC' })).toBeTruthy()
  })
})
