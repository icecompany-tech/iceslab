import { LineCounter, parseDocument, stringify } from 'yaml'
import type { FormValues } from '@/contours/profiles/lib/profileFormValues'
import { isObject } from './createInbound'

const mask = '••••••••••••'
export const isNativeHysteria = (v: FormValues) => v.protocol === 'hysteria' && v.engine === 'native'
export const hysteriaFile = { file: 'config.yaml', engine: 'hysteria' }

export function printHysteria(v: FormValues): string {
  const sections = []
  if (v.hyObfsPassword) sections.push({ obfs: { type: 'salamander', salamander: { password: mask } } })
  if (v.hyMasqueradeUrl) sections.push({ masquerade: { type: 'proxy', proxy: { url: v.hyMasqueradeUrl, rewriteHost: true } } })
  if (v.hyBrutalUp || v.hyBrutalDown) {
    sections.push({ bandwidth: {
      ...(v.hyBrutalUp && { up: v.hyBrutalUp + ' mbps' }),
      ...(v.hyBrutalDown && { down: v.hyBrutalDown + ' mbps' }),
    } })
  } else sections.push({ ignoreClientBandwidth: true })
  return sections.map(section => stringify(section).trimEnd()).join('\n\n')
}

export function readHysteria(text: string, v: FormValues): FormValues {
  const positions = new LineCounter()
  const doc = parseDocument(text, { lineCounter: positions, prettyErrors: false })
  function fail(path: string, reason: string): never {
    const node = doc.getIn(path ? path.split('.') : [], true)
    const at = positions.linePos(node && typeof node === 'object' && 'range' in node && Array.isArray(node.range) ? Number(node.range[0]) : 0)
    throw Error(reason + ' (line ' + at.line + ' column ' + at.col + ')')
  }
  const issue = doc.errors[0] ?? doc.warnings[0]
  if (issue) {
    const at = positions.linePos(issue.pos[0])
    throw Error('Ошибка YAML (line ' + at.line + ' column ' + at.col + ')')
  }
  let raw: unknown
  try { raw = doc.toJS({ maxAliasCount: 0 }) } catch { fail('', 'Ссылки YAML здесь недоступны') }
  function section(value: unknown, path: string, keys: string[]): Record<string, unknown> {
    if (!isObject(value)) fail(path, 'Ожидается раздел конфигурации')
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) fail(path ? path + '.' + key : key, 'Поле не поддерживается профилем: ' + key)
    }
    return value
  }
  const root = section(raw, '', ['masquerade', 'obfs', 'bandwidth', 'ignoreClientBandwidth'])
  const next: FormValues = { ...v, hyMasqueradeUrl: '', hyObfsPassword: '', hyBrutalUp: '', hyBrutalDown: '' }
  if ('masquerade' in root) {
    const m = section(root.masquerade, 'masquerade', ['type','proxy'])
    const proxy = section(m.proxy, 'masquerade.proxy', ['url','rewriteHost'])
    if (m.type !== 'proxy' || ('rewriteHost' in proxy && proxy.rewriteHost !== true)) fail('masquerade', 'Ожидается proxy с rewriteHost: true')
    let url: URL | undefined
    try { if (typeof proxy.url === 'string') url = new URL(proxy.url) } catch { /* The field error below keeps the draft open. */ }
    if (!url || !['https:', 'http:'].includes(url.protocol) || typeof proxy.url !== 'string' || /\s/.test(proxy.url)) fail('masquerade.proxy.url', 'Введите адрес HTTP или HTTPS')
    next.hyMasqueradeUrl = proxy.url
  }
  if ('obfs' in root) {
    const block = section(root.obfs, 'obfs', ['type','salamander'])
    const detail = section(block.salamander, 'obfs.salamander', ['password'])
    if (block.type !== 'salamander' || typeof detail.password !== 'string' || !detail.password || (detail.password === mask && !v.hyObfsPassword)) fail('obfs', 'Проверьте пароль Salamander')
    next.hyObfsPassword = detail.password === mask ? v.hyObfsPassword : detail.password
  }
  if ('bandwidth' in root) {
    const bw = section(root.bandwidth, 'bandwidth', ['up','down'])
    function rate(key: string): number | '' {
      if (!(key in bw)) return ''
      const match = /^(\d+) mbps$/i.exec(String(bw[key]))
      const value = Number(match?.[1])
      if (!Number.isInteger(value) || value < 1 || value > 10000) fail('bandwidth.' + key, 'Введите скорость от 1 до 10000 mbps')
      return value
    }
    next.hyBrutalUp = rate('up')
    next.hyBrutalDown = rate('down')
    if (!next.hyBrutalUp && !next.hyBrutalDown) fail('bandwidth', 'Укажите up или down')
  }
  if ('ignoreClientBandwidth' in root && (root.ignoreClientBandwidth !== true || 'bandwidth' in root)) fail('ignoreClientBandwidth', 'При заданной скорости уберите ignoreClientBandwidth')
  return next
}
