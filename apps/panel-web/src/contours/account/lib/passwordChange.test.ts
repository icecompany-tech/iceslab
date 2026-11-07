import { describe, expect, it } from 'vitest'
import { DICT } from '@/contours/account/dict'
import { passwordBody, passwordFormProblems, passwordRefusal, type PasswordForm } from '@/contours/account/lib/passwordChange'

const form = (over: Partial<PasswordForm> = {}): PasswordForm => ({ current: 'old-password', next: 'new-password', repeat: 'new-password', totp: '', ...over })
const refused = (status: number, data: object) => ({ response: { status, data } })

describe('passwordFormProblems', () => {
  it('a good form has none', () => {
    expect(passwordFormProblems(form(), false)).toEqual({})
  })

  it('each field is refused by its own rule', () => {
    expect(passwordFormProblems(form({ current: '' }), false).current).toBe('required')
    expect(passwordFormProblems(form({ next: 'short', repeat: 'short' }), false).next).toBe('short')
    expect(passwordFormProblems(form({ next: 'x'.repeat(129), repeat: 'x'.repeat(129) }), false).next).toBe('long')
    expect(passwordFormProblems(form({ next: 'old-password', repeat: 'old-password' }), false).next).toBe('same')
    expect(passwordFormProblems(form({ repeat: 'other-password' }), false).repeat).toBe('mismatch')
  })

  it('the code is asked only with 2FA on', () => {
    expect(passwordFormProblems(form(), true).totp).toBe('totpFormat')
    expect(passwordFormProblems(form({ totp: '123456' }), true).totp).toBeUndefined()
    expect(passwordFormProblems(form({ totp: 'abc' }), false).totp).toBeUndefined()
  })
})

describe('passwordBody', () => {
  it('sends the code only with 2FA on', () => {
    expect(passwordBody(form({ totp: '123456' }), false)).toEqual({ currentPassword: 'old-password', newPassword: 'new-password' })
    expect(passwordBody(form({ totp: '123456' }), true)).toEqual({ currentPassword: 'old-password', newPassword: 'new-password', totpCode: '123456' })
  })
})

describe('passwordRefusal', () => {
  it('input first', () => {
    expect(passwordRefusal(null)).toBeNull()
    expect(passwordRefusal(new Error('x'))).toBeNull()
  })

  it('each refusal lands on its field', () => {
    expect(passwordRefusal(refused(403, { error: 'INVALID_CURRENT_PASSWORD' }))).toEqual({ field: 'current', problem: 'wrongCurrent' })
    expect(passwordRefusal(refused(400, { error: 'PASSWORD_UNCHANGED' }))).toEqual({ field: 'next', problem: 'same' })
    expect(passwordRefusal(refused(400, { error: 'VALIDATION_ERROR' }))).toEqual({ field: 'next', problem: 'weak' })
    expect(passwordRefusal(refused(403, { error: 'TOTP_REQUIRED' }))).toEqual({ field: 'totp', problem: 'totpRequired' })
    expect(passwordRefusal(refused(403, { error: 'INVALID_TOTP' }))).toEqual({ field: 'totp', problem: 'totpWrong' })
    expect(passwordRefusal(refused(429, { error: 'ACCOUNT_LOCKED', retryAfterSeconds: 90 }))).toEqual({ field: 'form', problem: 'locked', retryAfterSeconds: 90 })
    expect(passwordRefusal(refused(500, { error: 'X' }))).toBeNull()
  })

  it('every problem has words in both languages', () => {
    const keys = ['required', 'short', 'long', 'same', 'mismatch', 'totpFormat', 'wrongCurrent', 'weak', 'totpRequired', 'totpWrong', 'locked'] as const
    for (const dict of [DICT.ru, DICT.en]) for (const key of keys) expect(typeof dict.passwordProblem[key]).toBe('string')
  })
})
