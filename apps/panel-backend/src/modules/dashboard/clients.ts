// K1-b SRH Inspector: map a raw subscription-fetch User-Agent to a canonical
// client family. The subscription endpoint records the UA verbatim in
// subscription_request_history; this turns that high-cardinality string into a
// small, chartable set ("Hiddify", "v2rayNG", "Clash.Meta", ...).
//
// Matching is ordered: more specific patterns first, because some family names
// are substrings of others (v2rayNG contains v2rayN; Clash.Meta contains
// Clash). Each entry is a case-insensitive regex tested against the raw UA.
// First hit wins; nothing matches -> "Other"; a missing UA -> "Unknown".
const CLIENT_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/hiddify/i, 'Hiddify'],
  [/v2rayng/i, 'v2rayNG'],
  [/v2rayn/i, 'v2rayN'],
  [/nekobox|nekoray/i, 'NekoBox'],
  // sing-box official apps report SFA/SFI/SFM (Android/iOS/macOS) or sing-box.
  [/sing-box|\bsf[aim]\//i, 'sing-box'],
  [/mihomo|clash\.?meta/i, 'Clash.Meta'],
  [/clash/i, 'Clash'],
  [/streisand/i, 'Streisand'],
  [/shadowrocket/i, 'Shadowrocket'],
  [/stash/i, 'Stash'],
  [/happ/i, 'Happ'],
  [/v2box/i, 'V2Box'],
  [/karing/i, 'Karing'],
  [/loon/i, 'Loon'],
  [/surfboard/i, 'Surfboard'],
  [/surge/i, 'Surge'],
  [/quantumult/i, 'Quantumult'],
  [/throne/i, 'Throne'],
  [/foxray/i, 'FoXray'],
  // Anything that looks like a browser or a scripted fetch, admins eyeballing
  // the panel sub URL, curl probes, uptime checks. Grouped so it doesn't
  // pollute the real-client breakdown.
  [/mozilla|chrome|safari|gecko|curl|wget|python|go-http|okhttp/i, 'Browser/Script'],
] as const;

export function classifyClient(ua: string | null | undefined): string {
  if (!ua || ua.trim() === '') return 'Unknown';
  for (const [re, label] of CLIENT_PATTERNS) {
    if (re.test(ua)) return label;
  }
  return 'Other';
}
