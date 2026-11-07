import type { RoutingPresetId } from '@iceslab/shared'
import type { AdminSettings, DeadTexts, DeadTextState, SubscriptionFormat, SubscriptionLinkShape, UpdateSettingsInput } from '@/lib/old/settings'

export interface ParamsDraft {
  profileTitle: string
  interval: string
  supportUrl: string
  announce: string
  preset: RoutingPresetId
  tlsFragment: boolean
  format: SubscriptionFormat
  shape: SubscriptionLinkShape
  publicHost: string
  dead: DeadTexts
}

export const DEAD_STATES: readonly DeadTextState[] = ['expired', 'limited', 'disabled']

const DEFAULT_INTERVAL = 24
const MIN_INTERVAL = 1
const MAX_INTERVAL = 168

export function draftOfSettings(s: AdminSettings): ParamsDraft {
  return {
    profileTitle: s.subscriptionProfileTitle ?? '',
    interval: String(s.subscriptionUpdateIntervalHours ?? DEFAULT_INTERVAL),
    supportUrl: s.subscriptionSupportUrl ?? '',
    announce: s.subscriptionAnnounceTemplate ?? '',
    preset: s.subscriptionRoutingPreset ?? 'proxy-all',
    tlsFragment: s.subscriptionTlsFragment ?? false,
    format: s.subscriptionDefaultFormat ?? 'plain',
    shape: s.subscriptionLinkShape ?? 'per-exit',
    publicHost: s.subscriptionPublicHost ?? '',
    dead: s.subscriptionDeadTexts ?? {},
  }
}

/** An empty field means «keep our text», not «show an empty line», so empty branches never reach the server. */
export function cleanDead(d: DeadTexts): DeadTexts | null {
  const out: DeadTexts = {}
  for (const key of DEAD_STATES) {
    const ru = d[key]?.ru?.trim()
    const en = d[key]?.en?.trim()
    if (ru || en) out[key] = { ...(ru ? { ru } : {}), ...(en ? { en } : {}) }
  }
  return Object.keys(out).length > 0 ? out : null
}

/** F-11: the same list the server is to check, refused at the field before any request. */
export function supportUrlValid(url: string): boolean {
  const value = url.trim()
  if (value === '') return true
  if (!/^(https?:\/\/|tg:\/\/)/i.test(value)) return false
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

export function intervalValid(text: string): boolean {
  if (!/^\d+$/.test(text.trim())) return false
  const hours = Number(text.trim())
  return hours >= MIN_INTERVAL && hours <= MAX_INTERVAL
}

const nullable = (text: string) => text.trim() || null

/** Only what changed goes out: a key that is absent is no edit (F-K3). */
export function paramsBody(stored: ParamsDraft, draft: ParamsDraft): UpdateSettingsInput {
  const dead = cleanDead(draft.dead)
  return {
    ...(draft.profileTitle.trim() !== stored.profileTitle.trim() ? { subscriptionProfileTitle: nullable(draft.profileTitle) } : {}),
    ...(draft.interval.trim() !== stored.interval.trim() ? { subscriptionUpdateIntervalHours: Number(draft.interval.trim()) } : {}),
    ...(draft.supportUrl.trim() !== stored.supportUrl.trim() ? { subscriptionSupportUrl: nullable(draft.supportUrl) } : {}),
    ...(draft.announce.trim() !== stored.announce.trim() ? { subscriptionAnnounceTemplate: nullable(draft.announce) } : {}),
    ...(draft.preset !== stored.preset ? { subscriptionRoutingPreset: draft.preset } : {}),
    ...(draft.tlsFragment !== stored.tlsFragment ? { subscriptionTlsFragment: draft.tlsFragment } : {}),
    ...(draft.format !== stored.format ? { subscriptionDefaultFormat: draft.format } : {}),
    ...(draft.shape !== stored.shape ? { subscriptionLinkShape: draft.shape } : {}),
    ...(draft.publicHost.trim() !== stored.publicHost.trim() ? { subscriptionPublicHost: nullable(draft.publicHost) } : {}),
    ...(JSON.stringify(dead) !== JSON.stringify(cleanDead(stored.dead)) ? { subscriptionDeadTexts: dead } : {}),
  }
}

/** Same units the server's formatBytes produces, so the announce sample reads as the header will. */
export function sampleBytes(n: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let v = Math.max(n, 0)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i] ?? ''}`
}
