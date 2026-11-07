// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DevicesPage from '@/contours/insights/screens/DevicesPage'
import { renderApp, stubServer } from '@/test/app'

const answer = (over: object = {}) => ({ windowDays: 7, subRequests: { total: 0, uniqueUsers: 0, byClient: [], byHourUtc: [] }, hwid: { totalDevices: 9, usersWithDevices: 3, avgDevicesPerUser: 3, distribution: [{ bucket: '1', users: 1 }, { bucket: '2', users: 1 }, { bucket: '5+', users: 1 }], atOrOverLimit: 1, ...over } })

afterEach(() => vi.unstubAllGlobals())
vi.setConfig({ testTimeout: 20_000 })

describe('DevicesPage', () => {
  it('загрузка', () => {
    stubServer({ 'GET /api/dashboard/insights': { body: answer() } })
    renderApp(<DevicesPage />)
    expect(screen.getByRole('status').textContent).toMatch(/Считаем/)
  })

  it('сбой: says so and retries', async () => {
    stubServer({ 'GET /api/dashboard/insights': { status: 500, body: {} } })
    renderApp(<DevicesPage />)
    await screen.findByText('Данные не загрузились', {}, { timeout: 8000 })
  })

  it('пусто: says who is counted at all', async () => {
    stubServer({ 'GET /api/dashboard/insights': { body: answer({ totalDevices: 0, usersWithDevices: 0, avgDevicesPerUser: 0, distribution: [], atOrOverLimit: 0 }) } })
    renderApp(<DevicesPage />)
    await screen.findByText('Устройства пока не учтены')
  })

  it('не проверено: the at-limit number names what it does not count', async () => {
    stubServer({ 'GET /api/dashboard/insights': { body: answer() } })
    renderApp(<DevicesPage />)
    await screen.findByText(/Лимит сквада сюда не входит/)
    expect(screen.getByText(/1 юзер упёрся/)).toBeTruthy()
    expect(screen.getByText(/Показать поимённо панель не может/)).toBeTruthy()
  })

  it('the buckets read in words', async () => {
    stubServer({ 'GET /api/dashboard/insights': { body: answer() } })
    renderApp(<DevicesPage />)
    await screen.findByText('1 устройство')
    expect(screen.getByText('2 устройства')).toBeTruthy()
    expect(screen.getByText('5+ устройств')).toBeTruthy()
  })
})
