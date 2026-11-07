import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_TARGET_KINDS, type AdminAuditEventDto } from '@iceslab/shared'
import { describe, expect, it } from 'vitest'
import { DICT } from '@/contours/audit/dict'
import { ACTION_GROUPS, actionFilterParam, actorWords, detailLines, isLoginSummary, outcomeWords, periodFrom, targetWords } from '@/contours/audit/lib/auditWords'

const words = DICT.ru
const event = (over: Partial<AdminAuditEventDto> = {}): AdminAuditEventDto => ({ id: '1', at: '2026-11-06T00:00:00Z', actor: { kind: 'admin', id: 'a', label: 'admin' }, action: 'user.delete', target: { kind: 'user', id: 'u', label: 'kate' }, outcome: 'ok', refusal: null, detail: null, sourceNetwork: null, ...over }) as AdminAuditEventDto

describe('contract coverage', () => {
  it('every action, group and target kind has a word in both languages', () => {
    for (const dict of [DICT.ru, DICT.en]) {
      expect(ADMIN_AUDIT_ACTIONS.filter((a) => typeof dict.action[a] !== 'string')).toEqual([])
      expect(ACTION_GROUPS.filter((g) => typeof dict.group[g] !== 'string')).toEqual([])
      expect(ADMIN_AUDIT_TARGET_KINDS.filter((k) => typeof dict.target[k] !== 'string')).toEqual([])
    }
  })
})

describe('F-1: a synthetic target is named in panel words, old and new rows alike', () => {
  it('unknown account, by empty label and by the old english one', () => {
    expect(targetWords(event({ target: { kind: 'admin', id: null, label: 'unknown account' } }), words)).toBe('неизвестный аккаунт')
    expect(targetWords(event({ target: { kind: 'admin', id: null, label: '' } }), words)).toBe('неизвестный аккаунт')
  })

  it('n users from the detail, from the old label too', () => {
    expect(targetWords(event({ action: 'users.bulk', target: { kind: 'user', id: null, label: '' }, detail: { requested: 3 } as never }), words)).toBe('3 юзера')
    expect(targetWords(event({ action: 'users.bulk', target: { kind: 'user', id: null, label: '21 users' } }), words)).toBe('21 юзер')
  })

  it('panel settings', () => {
    expect(targetWords(event({ target: { kind: 'settings', id: null, label: 'panel settings' } }), words)).toBe('настройки панели')
    expect(targetWords(event({ target: { kind: 'settings', id: null, label: '' } }), words)).toBe('настройки панели')
  })

  it('the sign-in refusal summary: a network or all networks', () => {
    const summary = { suppressed: 5, windowStart: '2026-11-06T00:00:00Z' } as never
    expect(targetWords(event({ action: 'auth.login', detail: summary, target: { kind: 'admin', id: null, label: '203.0.113.0/24' } }), words)).toBe('сеть 203.0.113.0/24')
    expect(targetWords(event({ action: 'auth.login', detail: summary, target: { kind: 'admin', id: null, label: '' } }), words)).toBe('все сети')
    expect(isLoginSummary(event({ action: 'auth.login', detail: summary }))).toBe(true)
    expect(isLoginSummary(event({ action: 'auth.login', detail: { twoFactor: false } as never }))).toBe(false)
  })

  it('a token: name (token), with and without the old prefix', () => {
    expect(actorWords(event({ actor: { kind: 'api_token', id: null, label: 'api token: billing' } }), words)).toBe('billing (токен)')
    expect(actorWords(event({ actor: { kind: 'api_token', id: null, label: 'billing' } }), words)).toBe('billing (токен)')
    expect(targetWords(event({ target: { kind: 'api_token', id: null, label: 'api token: billing' } }), words)).toBe('токен billing')
  })

  it('no english survives in the russian words of these rows', () => {
    const rows = [event({ target: { kind: 'settings', id: null, label: 'panel settings' } }), event({ target: { kind: 'admin', id: null, label: 'unknown account' } })]
    expect(rows.map((e) => targetWords(e, words)).join(' ')).not.toMatch(/panel settings|unknown account/)
  })
})

describe('the rest', () => {
  it('the outcome reads the refusal', () => {
    expect(outcomeWords({ outcome: 'refused', refusal: 'BAD_PASSWORD' }, words)).toBe('отказ: BAD_PASSWORD')
    expect(outcomeWords({ outcome: 'refused', refusal: null }, words)).toBe('отказ')
    expect(outcomeWords({ outcome: 'failed', refusal: null }, words)).toBe('сбой')
  })

  it('the action filter sends a group prefix or an action, nothing else', () => {
    expect(actionFilterParam('')).toBeUndefined()
    expect(actionFilterParam('group:cascade')).toBe('cascade.')
    expect(actionFilterParam('user.delete')).toBe('user.delete')
    expect(actionFilterParam('nonsense')).toBeUndefined()
  })

  it('the period is days before now, all sends nothing', () => {
    expect(periodFrom(null, 0)).toBeUndefined()
    expect(periodFrom(1, Date.parse('2026-11-06T00:00:00Z'))).toBe('2026-11-05T00:00:00.000Z')
  })

  it('detail lines read each field and a broken one says less', () => {
    const date = (iso: string) => iso.slice(0, 10)
    expect(detailLines(event({ action: 'users.bulk', detail: { action: 'reset-traffic', requested: 2, succeeded: 1, failed: 1, userIds: ['a', 'b'], expireDays: 5 } as never }), words, date)).toEqual(['действие: сброс трафика', 'запрошено 2, выполнено 1, не вышло 1', 'на 5 дней', 'затронуто 2 юзера'])
    expect(detailLines(event({ action: 'apiToken.create', detail: { scopes: ['*'] } as never, sourceNetwork: '1.1.1.0/24' }), words, date)).toEqual(['права: полный доступ', 'сеть 1.1.1.0/24'])
    expect(detailLines(event({ action: 'user.delete', detail: { erasedAfter: 'nope' } as never }), words, date)).toEqual([])
    expect(detailLines(event({ action: 'auth.login', detail: { suppressed: 5, windowStart: '2026-11-06T00:00:00Z' } as never }), words, date)).toEqual(['не записано 5 отказов за час с 2026-11-06'])
  })
})
