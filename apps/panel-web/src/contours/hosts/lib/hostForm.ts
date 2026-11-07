// The form of a host and what a save sends. Only what changed on an edit (F-K3); a field the
// profile cannot serve goes as null on a create, so no dead override from an earlier choice stays.
import { addressProblem } from '@/contours/hosts/lib/hostAddress'
import { descriptionProblem } from '@/contours/hosts/lib/hostVisibility'
import type { CreateHostInput, Host, UpdateHostInput } from '@/lib/old/hosts'
import type { HostFieldMap } from '@/lib/old/profiles'

export interface HostDraft {
  remark: string
  enabled: boolean
  address: string
  sni: string
  hostHeader: string
  path: string
  fingerprint: string
  alpn: string[]
  securityLayer: 'default' | 'tls' | 'none'
  allowInsecure: boolean
  disabledFormats: string[]
  description: string
  hidden: boolean
}

export const emptyDraft = (): HostDraft => ({ remark: '', enabled: true, address: '', sni: '', hostHeader: '', path: '', fingerprint: '', alpn: [], securityLayer: 'default', allowInsecure: false, disabledFormats: [], description: '', hidden: false })

export const draftOfHost = (host: Host): HostDraft => ({
  remark: host.remark,
  enabled: host.enabled,
  address: host.addressOverride ?? '',
  sni: host.sniOverride ?? '',
  hostHeader: host.hostHeaderOverride ?? '',
  path: host.pathOverride ?? '',
  fingerprint: host.fingerprintOverride ?? '',
  alpn: host.alpn,
  securityLayer: host.securityLayer as HostDraft['securityLayer'],
  allowInsecure: host.allowInsecure,
  disabledFormats: host.disableForFormats,
  description: host.serverDescription ?? '',
  hidden: host.isHidden ?? false,
})

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))
const orNull = (s: string) => s.trim() || null

export function hostUpdateBody(initial: HostDraft, draft: HostDraft): UpdateHostInput {
  const body: UpdateHostInput = {}
  if (draft.remark.trim() !== initial.remark) body.remark = draft.remark.trim()
  if (draft.enabled !== initial.enabled) body.enabled = draft.enabled
  if (draft.address !== initial.address) body.addressOverride = orNull(draft.address)
  if (draft.sni !== initial.sni) body.sniOverride = orNull(draft.sni)
  if (draft.hostHeader !== initial.hostHeader) body.hostHeaderOverride = orNull(draft.hostHeader)
  if (draft.path !== initial.path) body.pathOverride = orNull(draft.path)
  if (draft.fingerprint !== initial.fingerprint) body.fingerprintOverride = (draft.fingerprint || null) as UpdateHostInput['fingerprintOverride']
  if (!sameList(draft.alpn, initial.alpn)) body.alpn = draft.alpn as UpdateHostInput['alpn']
  if (draft.securityLayer !== initial.securityLayer) body.securityLayer = draft.securityLayer
  if (draft.allowInsecure !== initial.allowInsecure) body.allowInsecure = draft.allowInsecure
  if (!sameList(draft.disabledFormats, initial.disabledFormats)) body.disableForFormats = draft.disabledFormats as UpdateHostInput['disableForFormats']
  if (draft.description !== initial.description) body.serverDescription = orNull(draft.description)
  if (draft.hidden !== initial.hidden) body.isHidden = draft.hidden
  return body
}

export function hostCreateFields(draft: HostDraft, fields: HostFieldMap | undefined): Omit<CreateHostInput, 'profileId' | 'nodeId' | 'port'> {
  const can = (key: string) => fields?.[key]?.supported === true
  return {
    remark: draft.remark.trim(),
    enabled: draft.enabled,
    addressOverride: orNull(draft.address),
    sniOverride: can('sniOverride') ? orNull(draft.sni) : null,
    hostHeaderOverride: can('hostHeaderOverride') ? orNull(draft.hostHeader) : null,
    pathOverride: can('pathOverride') ? orNull(draft.path) : null,
    fingerprintOverride: can('fingerprintOverride') ? ((draft.fingerprint || null) as CreateHostInput['fingerprintOverride']) : null,
    alpn: (can('alpn') ? draft.alpn : []) as CreateHostInput['alpn'],
    securityLayer: can('securityLayer') ? draft.securityLayer : 'default',
    ...(can('allowInsecure') ? { allowInsecure: draft.allowInsecure } : {}),
    disableForFormats: draft.disabledFormats as CreateHostInput['disableForFormats'],
    ...(draft.description.trim() ? { serverDescription: draft.description.trim() } : {}),
    ...(draft.hidden ? { isHidden: true } : {}),
  }
}

export const draftProblems = (draft: HostDraft) => ({
  remark: draft.remark.trim() === '',
  address: addressProblem(draft.address),
  description: descriptionProblem(draft.description) !== null,
})
