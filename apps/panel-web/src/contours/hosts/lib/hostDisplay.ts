import { fmtAge } from '@/lib/format'
import type { Locale } from '@/lib/i18n'
import type { Host } from '@/lib/old/hosts'
import type { Node } from '@/lib/old/nodes'
import type { Binding, Profile } from '@/lib/old/profiles'
import { protocolLabelCompact } from '@/lib/old/protocols'

export function hostEndpoint(host: Host, node?: Node, binding?: Binding) {
  const address = host.addressOverride || node?.address.replace(/^(\[[^\]]+\]|[^:]+):\d+$/, '$1')
  if (!address) return ''
  const port = host.portOverride ?? binding?.port
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
