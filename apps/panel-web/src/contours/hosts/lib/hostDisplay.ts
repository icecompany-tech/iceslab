import { fmtAge } from '@/lib/format'
import type { Locale } from '@/lib/i18n'
import type { Host } from '@/lib/old/hosts'
import type { Node } from '@/lib/old/nodes'
import type { Binding, Profile } from '@/lib/old/profiles'
import { protocolLabelCompact } from '@/lib/old/protocols'

export const nodeHost = (address: string) => address.replace(/^\[([^\]]+)\](?::\d+)?$|^([^:]+):\d+$/, '$1$2')

export function clientAddress(override: string | null, node?: Node, binding?: Binding, profile?: Profile) {
  const config = profile?.config
  const hostname = profile?.protocol === 'naive' && config && 'hostname' in config ? config.hostname : ''
  return override || hostname || binding?.publicHost || (node ? nodeHost(node.address) : '')
}

export function hostEndpoint(host: Host, node?: Node, binding?: Binding, profile?: Profile) {
  const address = clientAddress(host.addressOverride, node, binding, profile)
  if (!address) return ''
  const port = host.portOverride ?? binding?.publicPort ?? binding?.port
  if (!port) return address
  const hostname = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address
  return `${hostname}:${port}`
}

export function hostProtocol(profile?: Profile, withEngine = false) {
  if (!profile) return '-'
  const config = profile.config
  if (profile.protocol === 'xray' && config && 'subprotocol' in config && config.subprotocol) {
    const label = config.subprotocol.toUpperCase()
    return withEngine && profile.effectiveEngine ? label + ' · ' + profile.effectiveEngine : label
  }
  return protocolLabelCompact(profile.protocol)
}

export function statusAge(node: Node | undefined, locale: Locale, now: number) {
  const since = Date.parse(node?.lastStatusChange ?? '')
  return Number.isFinite(since) ? ', ' + fmtAge((now - since) / 1000, locale) : ''
}
