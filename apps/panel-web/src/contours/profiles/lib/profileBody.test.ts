import { describe, expect, it } from 'vitest'
import { createBody, formProblems, updateBody } from '@/contours/profiles/lib/profileBody'
import { defaults } from '@/contours/profiles/lib/profileDefaults'
import { settleXrayFields } from '@/contours/profiles/lib/xrayFieldReactions'
import type { Profile } from '@/lib/old/profiles'

const profile = (over: object): Profile =>
  ({ id: 'p', name: 'vless-1', protocol: 'xray', engine: null, description: null, enabled: true, awgProtocol: null, config: { realityDest: 'www.cloudflare.com:443', realityServerNames: ['www.cloudflare.com'], realityShortIds: ['ab'], realityPrivateKey: 'x', realityPublicKey: 'y', network: 'raw', security: 'reality', subprotocol: 'vless', flow: '', fingerprint: 'firefox' }, ...over }) as unknown as Profile

describe('the body of a profile save', () => {
  it('an untouched form sends nothing', () => {
    const stored = profile({})
    const values = settleXrayFields(defaults(stored))
    expect(updateBody(values, { ...values }, stored)).toEqual({})
  })

  it('a changed name goes alone, a changed config goes whole', () => {
    const stored = profile({})
    const values = settleXrayFields(defaults(stored))
    expect(updateBody(values, { ...values, name: 'n' }, stored)).toEqual({ name: 'n' })
    const body = updateBody(values, { ...values, xrayDest: 'a.example:443' }, stored)
    expect(Object.keys(body)).toEqual(['config'])
    expect((body.config as unknown as { realityDest: string; realityPrivateKey: string }).realityDest).toBe('a.example:443')
    expect((body.config as unknown as { realityPrivateKey: string }).realityPrivateKey).toBe('x')
  })

  it('shadowsocks keeps its server key: the cipher unchanged sends no config', () => {
    const stored = profile({ protocol: 'shadowsocks', config: { method: 'aes-256-gcm', serverPsk: 'k' } })
    const values = defaults(stored)
    expect(updateBody(values, { ...values, name: 'n' }, stored)).toEqual({ name: 'n' })
    expect(updateBody(values, { ...values, ssMethod: 'aes-128-gcm' }, stored).config).toEqual({ method: 'aes-128-gcm' })
  })

  it('a create carries the protocol and the engine', () => {
    const values = { ...defaults(null), name: 'a', protocol: 'hysteria' as const, engine: 'singbox' as const }
    expect(createBody(values).engine).toBe('singbox')
    expect(createBody(values).protocol).toBe('hysteria')
  })

  it('refuses what the server would refuse, before asking it', () => {
    const values = settleXrayFields(defaults(profile({})))
    expect(formProblems(values)).toEqual({})
    expect(formProblems({ ...values, name: 'с пробелом' }).name).toBe('latin')
    expect(formProblems({ ...values, name: '' }).name).toBe('required')
    expect(formProblems({ ...values, xrayNetwork: 'ws' }).security).toBe('network')
  })
})
