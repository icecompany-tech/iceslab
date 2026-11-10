import { describe, expect, it } from 'vitest'
import { updateBody } from '@/contours/profiles/lib/profileBody'
import { profileConfigOf } from '@/contours/profiles/lib/profileConfig'
import { defaults } from '@/contours/profiles/lib/profileDefaults'
import { sockoptClears, sockoptConfig, sockoptFromConfig, sockoptProblem, sockoptReach } from '@/contours/profiles/lib/xraySockopt'
import type { Profile } from '@/lib/old/profiles'

const base = defaults(null)
const stored = (config: Record<string, unknown>, engine: string | null = null) => ({ id: 'p1', protocol: 'xray', name: 'p', description: null, enabled: true, engine, config }) as unknown as Profile

describe('Bk-170: TCP options of an xray inbound', () => {
  it('only the set fields go into the config, an empty one is not sent', () => {
    expect(sockoptConfig(base)).toEqual({})
    expect(sockoptConfig({ ...base, xrayTcpUserTimeout: 15000, xrayTcpKeepAliveInterval: 10 })).toEqual({ tcpUserTimeout: 15000, tcpKeepAliveInterval: 10 })
    const config = profileConfigOf({ ...base, xrayTcpKeepAliveIdle: 30 })
    expect(config.tcpKeepAliveIdle).toBe(30)
    expect('tcpUserTimeout' in config).toBe(false)
  })

  it('a sing-box profile carries none of them', () => {
    expect(sockoptConfig({ ...base, engine: 'singbox', xrayTcpUserTimeout: 15000 })).toEqual({})
  })

  it('the stored values come back into the form, absent stays empty', () => {
    expect(sockoptFromConfig({ tcpUserTimeout: 15000, tcpKeepAliveIdle: 'x' })).toEqual({ xrayTcpUserTimeout: 15000, xrayTcpKeepAliveIdle: '', xrayTcpKeepAliveInterval: '' })
  })

  it('a field emptied since the form opened goes as null, an untouched empty one not at all', () => {
    const profile = stored({ realityDest: 'a:443', tcpUserTimeout: 15000, tcpKeepAliveIdle: 30 })
    const initial = defaults(profile)
    expect(sockoptClears(initial, { ...initial, xrayTcpUserTimeout: '' })).toEqual({ tcpUserTimeout: null })
    const body = updateBody(initial, { ...initial, xrayTcpUserTimeout: '' }, profile)
    const sent: Record<string, unknown> = { ...body.config }
    expect(sent.tcpUserTimeout).toBeNull()
    expect(sent.tcpKeepAliveIdle).toBe(30)
    expect('tcpKeepAliveInterval' in sent).toBe(false)
  })

  it('refuses what the server refuses: not whole, below 1, above the bound', () => {
    expect(sockoptProblem({ ...base, xrayTcpUserTimeout: 0 })).toBe('xrayTcpUserTimeout')
    expect(sockoptProblem({ ...base, xrayTcpKeepAliveIdle: 1.5 })).toBe('xrayTcpKeepAliveIdle')
    expect(sockoptProblem({ ...base, xrayTcpKeepAliveInterval: 32768 })).toBe('xrayTcpKeepAliveInterval')
    expect(sockoptProblem({ ...base, xrayTcpUserTimeout: 2_147_483_647, xrayTcpKeepAliveIdle: 32767 })).toBeUndefined()
  })

  it('three answers of a node: true applies, false refuses, absent is unknown and never «refuses»', () => {
    expect(sockoptReach(true)).toBe('applies')
    expect(sockoptReach(false)).toBe('refuses')
    expect(sockoptReach(undefined)).toBe('unknown')
  })
})
