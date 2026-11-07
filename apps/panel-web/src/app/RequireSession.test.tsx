// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequireSession } from '@/app/RequireSession'
import { readLoginNotice, safeReturnPath } from '@/lib/auth/session'
import { renderApp, stubServer } from '@/test/app'

function Seen() {
  const state: unknown = useLocation().state
  return <div>{`${safeReturnPath(state)} ${readLoginNotice(state)}`}</div>
}

function guarded() {
  return renderApp(
    <Routes>
      <Route element={<RequireSession />}>
        <Route path="/" element={<div>inside</div>} />
      </Route>
      <Route path="/login" element={<div>sign-in</div>} />
    </Routes>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('the route guard, F-14', () => {
  it('lets in whom the server names', async () => {
    stubServer({ 'GET /api/auth/me': { body: { id: '1', username: 'admin', role: 'admin' } } })
    guarded()
    await screen.findByText('inside')
  })

  it('a 401 goes to the sign-in', async () => {
    stubServer({ 'GET /api/auth/me': { status: 401, body: { error: 'UNAUTHORIZED' } } })
    guarded()
    await screen.findByText('sign-in')
  })

  it('a session lost on the way says so and remembers the screen', async () => {
    let calls = 0
    stubServer({ 'GET /api/auth/me': () => (++calls === 1 ? { body: { id: '1', username: 'admin', role: 'admin' } } : { status: 401, body: { error: 'UNAUTHORIZED' } }) })
    const { client } = renderApp(
      <Routes>
        <Route element={<RequireSession />}>
          <Route path="/users" element={<div>inside</div>} />
        </Route>
        <Route path="/login" element={<Seen />} />
      </Routes>,
      { route: '/users' },
    )
    await screen.findByText('inside')
    await client.refetchQueries()
    await screen.findByText('/users sessionExpired')
  })

  it('a failed check does not sign anyone out: it says so and offers a retry', async () => {
    stubServer({ 'GET /api/auth/me': { status: 503 } })
    guarded()
    await screen.findByRole('button', { name: 'Повторить' }, { timeout: 5000 })
    expect(screen.queryByText('sign-in')).toBeNull()
  })

  it('does not read a token from the browser', async () => {
    localStorage.setItem('iceslab-auth', JSON.stringify({ state: { token: 'old' } }))
    stubServer({ 'GET /api/auth/me': { status: 401 } })
    guarded()
    await screen.findByText('sign-in')
    localStorage.removeItem('iceslab-auth')
  })
})
