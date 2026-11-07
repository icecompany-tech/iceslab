// A refused save, read so it lands at its field (F-K2). Input checked first (F-K7).
import { isApiError } from '@/lib/net/errors'
import { isRecord } from '@/lib/net/parse'

export type FormField = 'username' | 'subscriptionToken' | 'limit' | 'strategy' | 'term' | 'status' | 'description' | 'tag' | 'email' | 'telegramId' | 'deviceLimit' | 'groups' | 'routing'

const FIELD_OF: Record<string, FormField> = {
  username: 'username',
  subscriptionToken: 'subscriptionToken',
  trafficLimitGb: 'limit',
  trafficLimitStrategy: 'strategy',
  expireDays: 'term',
  expireAt: 'term',
  status: 'status',
  description: 'description',
  tag: 'tag',
  email: 'email',
  telegramId: 'telegramId',
  hwidDeviceLimit: 'deviceLimit',
  groupIds: 'groups',
  routingPreset: 'routing',
  customRoutingPresetId: 'routing',
}

const AT_FIELD: Record<string, FormField> = {
  USERNAME_TAKEN: 'username',
  SUBSCRIPTION_TOKEN_TAKEN: 'subscriptionToken',
  ROUTING_PRESET_NOT_FOUND: 'routing',
}

export interface SaveRefusal {
  fields: Partial<Record<FormField, string>>
  /** The code of a known field refusal, for the panel's own words. */
  code: string | null
  /** Said at the form: what the server explained and no field owns. */
  message: string | null
}

export function readSaveRefusal(err: unknown): SaveRefusal | null {
  if (!isApiError(err) || err.status < 400 || err.status >= 500) return null
  const field = err.code === null ? undefined : AT_FIELD[err.code]
  if (field) return { fields: { [field]: err.serverMessage ?? '' }, code: err.code, message: null }
  if (err.code === 'VALIDATION_ERROR' && isRecord(err.body) && Array.isArray(err.body.issues)) {
    const fields: SaveRefusal['fields'] = {}
    const loose: string[] = []
    for (const issue of err.body.issues) {
      if (!isRecord(issue)) continue
      const text = typeof issue.message === 'string' ? issue.message : ''
      const head = Array.isArray(issue.path) ? issue.path[0] : undefined
      const at = typeof head === 'string' ? FIELD_OF[head] : undefined
      if (at && !fields[at]) fields[at] = text
      else if (text) loose.push(text)
    }
    return { fields, code: null, message: loose.length > 0 ? loose.join('; ') : null }
  }
  return err.serverMessage ? { fields: {}, code: err.code, message: err.serverMessage } : null
}
