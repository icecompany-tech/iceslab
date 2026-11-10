// Bk-170: the TCP options of an xray inbound. The server keeps a key the save leaves out and
// clears one sent as null (profiles.service.ts keepXraySockopt), so a save sends only the fields
// that are set, and null only for one that was set and is now emptied.
import type { FormValues } from '@/contours/profiles/lib/profileFormValues'

export const SOCKOPT_FIELDS = [
  { field: 'xrayTcpUserTimeout', key: 'tcpUserTimeout', max: 2_147_483_647 },
  { field: 'xrayTcpKeepAliveIdle', key: 'tcpKeepAliveIdle', max: 32_767 },
  { field: 'xrayTcpKeepAliveInterval', key: 'tcpKeepAliveInterval', max: 32_767 },
] as const

export type SockoptField = (typeof SOCKOPT_FIELDS)[number]['field']

/** sing-box refuses them (SINGBOX_XRAY_FAMILY): only the xray engine carries the options. */
export const carriesSockopt = (values: Pick<FormValues, 'engine'>) => values.engine !== 'singbox'

/** What the stored config gives the form: a number, or empty for «as the core does». */
export const sockoptFromConfig = (cfg: Record<string, unknown>) =>
  Object.fromEntries(SOCKOPT_FIELDS.map(({ field, key }) => [field, typeof cfg[key] === 'number' ? cfg[key] : ''])) as Record<SockoptField, number | ''>

/** The set fields only: an empty one is not sent at all. */
export function sockoptConfig(values: FormValues): Record<string, number> {
  if (!carriesSockopt(values)) return {}
  const out: Record<string, number> = {}
  for (const { field, key } of SOCKOPT_FIELDS) {
    const value = values[field]
    if (value !== '') out[key] = value
  }
  return out
}

/** A field set when the form opened and emptied since: null, or the server would keep the old value. */
export function sockoptClears(initial: FormValues, values: FormValues): Record<string, null> {
  const out: Record<string, null> = {}
  for (const { field, key } of SOCKOPT_FIELDS) {
    if (initial[field] !== '' && (values[field] === '' || !carriesSockopt(values))) out[key] = null
  }
  return out
}

/** The first field out of the server's bounds: a whole number from 1 up to the kernel's or xray's limit. */
export function sockoptProblem(values: FormValues): SockoptField | undefined {
  if (!carriesSockopt(values)) return undefined
  return SOCKOPT_FIELDS.find(({ field, max }) => {
    const value = values[field]
    return value !== '' && (!Number.isInteger(value) || value < 1 || value > max)
  })?.field
}

export type SockoptReach = 'applies' | 'refuses' | 'unknown'

/**
 * How a node answers for the options, from its xray core report. Absent is an agent that
 * predates the field and drops them without a word: unknown, never «does not apply».
 */
export const sockoptReach = (rendersSockopt: boolean | undefined): SockoptReach => (rendersSockopt === true ? 'applies' : rendersSockopt === false ? 'refuses' : 'unknown')
