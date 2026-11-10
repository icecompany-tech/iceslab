import { describe, expect, it } from 'vitest'
import { formProblems, updateBody } from '@/contours/profiles/lib/profileBody'
import { profileConfigOf } from '@/contours/profiles/lib/profileConfig'
import { defaults } from '@/contours/profiles/lib/profileDefaults'
import { keptSockopt, sockoptClears, sockoptConfig, sockoptFromConfig, sockoptProblem, sockoptReach } from '@/contours/profiles/lib/xraySockopt'
import type { Profile } from '@/lib/old/profiles'

const base = defaults(null)
const stored = (config: Record<string, unknown>, engine: string | null = null) => ({ id: 'p1', protocol: 'xray', name: 'p', description: null, enabled: true, engine, config }) as unknown as Profile

describe('Bk-170: TCP options of an xray inbound', () => {
  it('only the set fields go into the config, as numbers; an empty one is not sent', () => {
    expect(sockoptConfig(base)).toEqual({})
    expect(sockoptConfig({ ...base, xrayTcpUserTimeout: '15000', xrayTcpKeepAliveInterval: ' 10 ' })).toEqual({ tcpUserTimeout: 15000, tcpKeepAliveInterval: 10 })
    const config = profileConfigOf({ ...base, xrayTcpKeepAliveIdle: '30' })
    expect(config.tcpKeepAliveIdle).toBe(30)
    expect('tcpUserTimeout' in config).toBe(false)
  })

  it('a sing-box profile carries none of them', () => {
    expect(sockoptConfig({ ...base, engine: 'singbox', xrayTcpUserTimeout: '15000' })).toEqual({})
  })

  it('the stored values come back into the form as text, absent stays empty', () => {
    expect(sockoptFromConfig({ tcpUserTimeout: 15000, tcpKeepAliveIdle: 'x' })).toEqual({ xrayTcpUserTimeout: '15000', xrayTcpKeepAliveIdle: '', xrayTcpKeepAliveInterval: '' })
  })

  it('a field the operator emptied goes as null, an untouched empty one not at all', () => {
    const profile = stored({ realityDest: 'a:443', tcpUserTimeout: 15000, tcpKeepAliveIdle: 30 })
    const initial = defaults(profile)
    expect(sockoptClears(initial, { ...initial, xrayTcpUserTimeout: '' })).toEqual({ tcpUserTimeout: null })
    const sent: Record<string, unknown> = { ...updateBody(initial, { ...initial, xrayTcpUserTimeout: '' }, profile).config }
    expect(sent.tcpUserTimeout).toBeNull()
    expect(sent.tcpKeepAliveIdle).toBe(30)
    expect('tcpKeepAliveInterval' in sent).toBe(false)
  })

  it('F-34: a typo over a stored value is the field\'s error and closes the save, never a silent null', () => {
    const profile = stored({ realityDest: 'a:443', tcpUserTimeout: 15000 })
    const initial = defaults(profile)
    const typo = { ...initial, xrayTcpUserTimeout: 'abc' }
    expect(formProblems(typo).tcp).toBe('xrayTcpUserTimeout')
    expect(sockoptClears(initial, typo)).toEqual({})
    expect(sockoptConfig(typo)).toEqual({})
  })

  it('refuses what the server refuses: not whole, below 1, above the bound', () => {
    expect(sockoptProblem({ ...base, xrayTcpUserTimeout: '0' })).toBe('xrayTcpUserTimeout')
    expect(sockoptProblem({ ...base, xrayTcpKeepAliveIdle: '1.5' })).toBe('xrayTcpKeepAliveIdle')
    expect(sockoptProblem({ ...base, xrayTcpKeepAliveInterval: '32768' })).toBe('xrayTcpKeepAliveInterval')
    expect(sockoptProblem({ ...base, xrayTcpUserTimeout: '2147483647', xrayTcpKeepAliveIdle: '32767' })).toBeUndefined()
  })

  it('F-34: a profile moved to SOCKS5 keeps the stored values: no null goes and the screen names them', () => {
    const profile = stored({ realityDest: 'a:443', tcpUserTimeout: 15000, tcpKeepAliveInterval: 10 })
    const initial = defaults(profile)
    const socks = { ...initial, xraySubprotocol: 'socks' as const }
    const sent: Record<string, unknown> = { ...updateBody(initial, socks, profile).config }
    expect('tcpUserTimeout' in sent || 'tcpKeepAliveInterval' in sent).toBe(false)
    expect(keptSockopt(socks)).toEqual([
      { field: 'xrayTcpUserTimeout', value: '15000', unit: 'ms' },
      { field: 'xrayTcpKeepAliveInterval', value: '10', unit: 's' },
    ])
  })

  it('three answers of a node: true applies, false refuses, absent is unknown and never «refuses»', () => {
    expect(sockoptReach(true)).toBe('applies')
    expect(sockoptReach(false)).toBe('refuses')
    expect(sockoptReach(undefined)).toBe('unknown')
  })
})
