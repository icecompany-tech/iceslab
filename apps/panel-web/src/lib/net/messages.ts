// A failure in words (F-K2): the server's own, or the panel's for what the server could
// not say. Never "Request failed with status code 500".
import { isApiError, NO_ANSWER } from '@/lib/net/errors'
import type { Locale } from '@/lib/i18n'

const WORDS = {
  ru: {
    noAnswer: 'Сервер панели не ответил. Проверьте связь и повторите.',
    badResponse: 'Сервер ответил не так, как ждёт эта версия панели.',
    server: 'Сервер панели сообщил об ошибке и не назвал причину.',
    unknown: 'Не получилось, причина неизвестна.',
  },
  en: {
    noAnswer: 'The panel server did not answer. Check the connection and retry.',
    badResponse: 'The server answered differently from what this panel version expects.',
    server: 'The panel server reported an error and gave no reason.',
    unknown: 'It did not work, the reason is unknown.',
  },
} satisfies Record<Locale, Record<string, string>>

export function failureText(err: unknown, locale: Locale): string {
  const words = WORDS[locale]
  if (!isApiError(err)) return words.unknown
  if (err.status === NO_ANSWER) return words.noAnswer
  if (err.code === 'BAD_RESPONSE') return words.badResponse
  return err.serverMessage ?? words.server
}
