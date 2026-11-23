import type { ProfileError } from '@/ui/CodeArea/text'
import type { FormValues } from '@/contours/profiles/lib/profileFormValues'
import { SOCKOPT_FIELDS, sockoptConfig, sockoptFromConfig } from '@/contours/profiles/lib/xraySockopt'

export type JsonObject = { [key: string]: unknown }
export const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (list: string) => list.split(',').map((part) => part.trim()).filter(Boolean)
const masked = '••••••••••••'
export const supportsConsole = (v: FormValues) => v.protocol === 'xray' && v.engine === 'native' && ['vless', 'vmess', 'trojan'].includes(v.xraySubprotocol)
const pick = (object: JsonObject, key: string) => isObject(object[key]) ? object[key] : {}

// Native Xray inbound as shown at creation. Null and [] stand for values assigned on deployment.
export function fromForm(v: FormValues): JsonObject {
  const stream: JsonObject = { network: v.xrayNetwork, security: v.xraySecurity }
  if (v.xraySecurity === 'reality') stream.realitySettings = {
    show: false, dest: v.xrayDest, xver: v.xrayRealityXver, serverNames: strings(v.xrayServerNames),
    privateKey: v.xrayPrivateKey ? masked : '', shortIds: strings(v.xrayShortIds),
  }
  if (v.xraySecurity === 'tls') stream.tlsSettings = { serverName: v.xrayTlsServerName, rejectUnknownSni: v.xrayTlsRejectUnknownSni }
  if (v.xrayNetwork === 'grpc') stream.grpcSettings = { serviceName: v.xrayServiceName, multiMode: v.xrayGrpcMultiMode }
  if (v.xrayNetwork === 'ws') stream.wsSettings = { path: v.xrayPath, headers: { Host: v.xrayHostHeader } }
  if (v.xrayNetwork === 'xhttp') stream.xhttpSettings = { path: v.xrayPath, host: v.xrayHostHeader, mode: v.xrayXhttpMode }
  if (v.xrayNetwork === 'httpupgrade') stream.httpupgradeSettings = { path: v.xrayPath, host: v.xrayHostHeader }
  const sockopt = sockoptConfig(v)
  if (Object.keys(sockopt).length) stream.sockopt = sockopt
  return {
    tag: null, listen: '0.0.0.0', port: null, protocol: v.xraySubprotocol,
    settings: { clients: [], ...(v.xraySubprotocol === 'vless' ? { decryption: 'none' } : {}) },
    streamSettings: stream, sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
  }
}

// Replay only changes made in the form. Operators can add core fields the form does not represent.
export function rebase(base: JsonObject, next: JsonObject, raw: JsonObject): JsonObject {
  const result = { ...raw }
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (JSON.stringify(base[key]) === JSON.stringify(next[key])) continue
    if (!(key in next)) delete result[key]
    else if (isObject(base[key]) && isObject(next[key]) && isObject(raw[key])) result[key] = rebase(base[key], next[key], raw[key])
    else result[key] = next[key]
  }
  return result
}

export const printInbound = (raw: JsonObject) => JSON.stringify(raw, null, 2)
  .replace(/\[\n\s+((?:"(?:\\.|[^"\\])*"(?:,\n\s+)?)+)\n\s*\]/g, (_, entries: string) => '[' + entries.replace(/,\n\s+/g, ', ') + ']')

function requireString(value: unknown, key: string): string {
  if (typeof value !== 'string') throw Error('Ожидалась строка в ' + key)
  return value
}
function stringList(value: unknown, key: string): string {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw Error('Ожидался список строк в ' + key)
  return value.join(', ')
}
export function readInbound(text: string, v: FormValues): { raw: JsonObject; values: FormValues } {
  const raw: unknown = JSON.parse(text)
  if (!isObject(raw)) throw Error('Конфигурация должна быть объектом JSON')
  const settings = pick(raw, 'settings'), stream = pick(raw, 'streamSettings')
  if (raw.tag !== null || raw.listen !== '0.0.0.0' || raw.port !== null || !Array.isArray(settings.clients) || settings.clients.length) {
    throw Error('Поля tag, listen, port и clients задаёт панель')
  }
  if (raw.protocol !== v.xraySubprotocol) throw Error('Смените протокол через меню редактора')
  const network = stream.network, security = stream.security
  if (!['raw','grpc','ws','xhttp','httpupgrade','kcp'].some((n) => n === network)) throw Error('Неизвестный транспорт streamSettings.network')
  if (security !== 'reality' && security !== 'tls' && security !== 'none') throw Error('Допустимая защита: reality, tls или none')
  const next = { ...v, xrayNetwork: network as FormValues['xrayNetwork'], xraySecurity: security } as FormValues
  if (security === 'reality') {
    const r = pick(stream, 'realitySettings')
    next.xrayDest = requireString(r.dest, 'dest')
    next.xrayServerNames = stringList(r.serverNames, 'serverNames')
    next.xrayShortIds = stringList(r.shortIds, 'shortIds')
    if (r.xver !== 0 && r.xver !== 1 && r.xver !== 2) throw Error('xver должен быть 0, 1 или 2')
    next.xrayRealityXver = r.xver
    if (r.privateKey !== (v.xrayPrivateKey ? masked : '')) throw Error('Измените пару ключей в шаге «Маскировка»')
  }
  const tls = pick(stream, 'tlsSettings'), grpc = pick(stream, 'grpcSettings')
  if (security === 'tls') {
    next.xrayTlsServerName = requireString(tls.serverName ?? '', 'serverName')
    if ('rejectUnknownSni' in tls && typeof tls.rejectUnknownSni !== 'boolean') throw Error('rejectUnknownSni должен быть true или false')
    next.xrayTlsRejectUnknownSni = tls.rejectUnknownSni === true
  }
  if (network === 'grpc') {
    next.xrayServiceName = requireString(grpc.serviceName ?? '', 'serviceName')
    if ('multiMode' in grpc && typeof grpc.multiMode !== 'boolean') throw Error('multiMode должен быть true или false')
    next.xrayGrpcMultiMode = grpc.multiMode === true
  }
  if (network === 'ws' || network === 'httpupgrade' || network === 'xhttp') {
    const transport = pick(stream, network + 'Settings')
    next.xrayPath = requireString(transport.path ?? '', 'path')
    next.xrayHostHeader = requireString((network === 'ws' ? pick(transport, 'headers').Host : transport.host) ?? '', 'host')
    if (network === 'xhttp' && transport.mode !== undefined) {
      const mode = transport.mode
      if (!['auto','packet-up','stream-up','stream-one'].some((item) => item === mode)) throw Error('Неизвестное значение xhttpSettings.mode')
      next.xrayXhttpMode = mode as FormValues['xrayXhttpMode']
    }
  }
  const sockopt = pick(stream, 'sockopt')
  for (const { key, max } of SOCKOPT_FIELDS) {
    const n = sockopt[key]
    if (n !== undefined && (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max)) throw Error('Проверьте значение ' + key)
  }
  Object.assign(next, sockoptFromConfig(sockopt))
  return { raw, values: next }
}

export function consoleError(error: unknown, text: string): ProfileError {
  const message = error instanceof Error ? error.message : 'Проверьте конфигурацию'
  const pos = /line (\d+) column (\d+)/.exec(message)
  const offset = /position (\d+)/.exec(message)
  const lines = text.slice(0, offset ? Number(offset[1]) : text.length).split('\n')
  return { line: pos ? Number(pos[1]) : lines.length, column: pos ? Number(pos[2]) : (lines.at(-1)?.length ?? 0) + 1,
    reason: error instanceof SyntaxError ? 'Ошибка синтаксиса JSON' : message }
}

/** Identify edits that the installed API cannot represent, independently of JSON key order. */
export function unrepresentedField(value: unknown, expected: unknown, path = ''): string | null {
  if (Object.is(value, expected)) return null
  if (Array.isArray(value) && Array.isArray(expected)) {
    if (value.length !== expected.length) return path
    for (let i = 0; i < value.length; i++) {
      const changed = unrepresentedField(value[i], expected[i], path + '[' + i + ']')
      if (changed) return changed
    }
    return null
  }
  if (isObject(value) && isObject(expected)) {
    for (const key of new Set([...Object.keys(value), ...Object.keys(expected)])) {
      const name = path ? path + '.' + key : key
      if (!Object.hasOwn(value, key) || !Object.hasOwn(expected, key)) return name
      const changed = unrepresentedField(value[key], expected[key], name)
      if (changed) return changed
    }
    return null
  }
  return path || 'config.json'
}
