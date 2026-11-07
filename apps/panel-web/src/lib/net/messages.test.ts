import { describe, expect, it } from 'vitest'
import { ApiError, NO_ANSWER } from '@/lib/net/errors'
import { failureText } from '@/lib/net/messages'

describe('failureText, F-K2 and F-K7', () => {
  it('uses the words of the server', () => {
    expect(failureText(new ApiError({ status: 409, serverMessage: 'Name taken' }), 'ru')).toBe('Name taken')
  })

  it('names what the server could not say', () => {
    expect(failureText(new ApiError({ status: NO_ANSWER }), 'ru')).toMatch(/не ответил/)
    expect(failureText(new ApiError({ status: 200, code: 'BAD_RESPONSE' }), 'en')).toMatch(/differently/)
    expect(failureText(new ApiError({ status: 502 }), 'ru')).toMatch(/не назвал/)
  })

  it.each([[null], [undefined], ['boom'], [{}], [new Error('Request failed with status code 500')]])('%j is not read for a message', (bad) => {
    expect(failureText(bad, 'ru')).toBe('Не получилось, причина неизвестна.')
  })
})
