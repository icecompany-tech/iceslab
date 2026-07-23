/**
 * Routing Templates (design plan E, R1a): panel-wide preset controlling the
 * routing rules emitted into full-config subscription formats
 * (clash / singbox / xrayjson). URI-list formats (plain) and wgconf carry no
 * routing section, so the preset does not apply to them.
 *
 *   - `proxy-all`: everything through the tunnel. Legacy behaviour; output
 *     is byte-identical to pre-R1 builds.
 *   - `ru-split` : ads/malware blocked, RU domains + RU IPs + private ranges
 *     direct, everything else (including blocked sites) through the tunnel.
 *   - `cn-split` : the China-direct mirror of `ru-split`. Ads/malware blocked,
 *     China domains (geosite:cn) + China IPs (geoip:cn) + private ranges
 *     direct, everything else through the tunnel. Same shape as `ru-split`;
 *     only the geo categories and the clean-DNS resolver differ (AliDNS
 *     223.5.5.5 instead of Yandex 77.88.8.8).
 *   - `roscomvpn`: Mihomo-only client-side rule providers from RoscomVPN.
 *     Other full-config formats intentionally fall back to `proxy-all`.
 *
 * Stored in AppSetting under `subscriptionRoutingPreset`; overridable per
 * request via `?routing=` on /sub (mirrors the `bundle` param pattern).
 */
export const ROUTING_PRESET_IDS = [
  'proxy-all',
  'ru-split',
  'cn-split',
  'roscomvpn',
] as const;

export type RoutingPresetId = (typeof ROUTING_PRESET_IDS)[number];

export function isRoutingPresetId(value: unknown): value is RoutingPresetId {
  return (
    typeof value === 'string' &&
    (ROUTING_PRESET_IDS as readonly string[]).includes(value)
  );
}
