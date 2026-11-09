import { describe, expect, it } from 'vitest'
import { addressProblem } from '@/contours/hosts/lib/hostAddress'

describe('the own address of a host, F-15', () => {
  it('takes a name, an IP and an IPv6 literal', () => {
    for (const ok of ['', 'cdn.example.net', '91.1.1.1', '2001:db8::1', '[2001:db8::1]']) expect(addressProblem(ok)).toBeNull()
  })

  it('refuses what would break a subscription line', () => {
    expect(addressProblem('a\nb')).toBe('newline')
    expect(addressProblem('a b')).toBe('space')
    expect(addressProblem('a,b')).toBe('comma')
    expect(addressProblem('https://a')).toBe('scheme')
    for (const bad of ['a.example/path', 'a.example?x=1', 'a.example#frag', 'user@a.example', '/a']) expect(addressProblem(bad), bad).toBe('url')
    expect(addressProblem('a.example:443')).toBe('port')
    expect(addressProblem('[2001:db8::1]:443')).toBe('port')
  })
})
