// Bk-170: the TCP options of an xray inbound. The server keeps a key the save leaves out and
// clears one sent as null (profiles.service.ts keepXraySockopt), so a save sends only the fields
// that are set, and null only for one the operator emptied. The form keeps what was typed: a
// typo is the field's error and closes the save, it never turns into a silent clear (F-34).
import type { FormValues } from '@/contours/profiles/lib/profileFormValues'

export const SOCKOPT_FIELDS = [
  { field: 'xrayTcpUserTimeout', key: 'tcpUserTimeout', max: 2_147_483_647, unit: 'ms' },
  { field: 'xrayTcpKeepAliveIdle', key: 'tcpKeepAliveIdle', max: 32_767, unit: 's' },
  { field: 'xrayTcpKeepAliveInterval', key: 'tcpKeepAliveInterval', max: 32_767, unit: 's' },
] as const

export type SockoptField = (typeof SOCKOPT_FIELDS)[number]['field']

const WHOLE = /^\d+$/

/** sing-box refuses them (SINGBOX_XRAY_FAMILY): only the xray engine carries the options. */
export const carriesSockopt = (values: Pick<FormValues, 'engine'>) => values.engine !== 'singbox'

/** What the stored config gives the form: the number as typed text, or empty for «as the core does». */
export const sockoptFromConfig = (cfg: Record<string, unknown>) =>
  Object.fromEntries(SOCKOPT_FIELDS.map(({ field, key }) => [field, typeof cfg[key] === 'number' ? String(cfg[key]) : ''])) as Record<SockoptField, string>

/** The set fields only, as numbers: an empty one is not sent at all. */
export function sockoptConfig(values: FormValues): Record<string, number> {
  if (!carriesSockopt(values)) return {}
  const out: Record<string, number> = {}
  for (const { field, key } of SOCKOPT_FIELDS) {
    const text = values[field].trim()
    if (WHOLE.test(text)) out[key] = Number(text)
  }
  return out
}

/** A field set when the form opened and emptied by the operator since: null, or the server keeps the old value. */
export function sockoptClears(initial: FormValues, values: FormValues): Record<string, null> {
  const out: Record<string, null> = {}
  for (const { field, key } of SOCKOPT_FIELDS) {
    if (initial[field].trim() !== '' && (values[field].trim() === '' || !carriesSockopt(values))) out[key] = null
  }
  return out
}

/** The first field the server would refuse: not a whole number, below 1, above the kernel's or xray's limit. */
export function sockoptProblem(values: FormValues): SockoptField | undefined {
  if (!carriesSockopt(values)) return undefined
  return SOCKOPT_FIELDS.find(({ field, max }) => {
    const text = values[field].trim()
    return text !== '' && (!WHOLE.test(text) || Number(text) < 1 || Number(text) > max)
  })?.field
}

/** The stored options a plain subprotocol (SOCKS5, HTTP) keeps and the agent still draws (F-34). */
export const keptSockopt = (values: FormValues) => SOCKOPT_FIELDS.filter(({ field }) => values[field].trim() !== '').map(({ field, unit }) => ({ field, value: values[field].trim(), unit }))

export type SockoptReach = 'applies' | 'refuses' | 'unknown'

/**
 * How a node answers for the options, from its xray core report. Absent is an agent that
 * predates the field and drops them without a word: unknown, never «does not apply».
 */
export const sockoptReach = (rendersSockopt: boolean | undefined): SockoptReach => (rendersSockopt === true ? 'applies' : rendersSockopt === false ? 'refuses' : 'unknown')
