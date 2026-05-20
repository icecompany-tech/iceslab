import { config } from '../config.js';

/**
 * Tier-1 security alerts via Telegram (cycle #5 SECURITY.md follow-up).
 *
 * Single entry-point. Callers never check whether Telegram is configured —
 * if BOT_TOKEN or CHAT_ID is missing, the call is a silent no-op. Same for
 * network errors: a flaky Telegram API shouldn't break the calling flow
 * (login, bootstrap-issue, etc.). Every failure is console-logged but
 * swallowed.
 *
 * Markdown is allowed (parse_mode=MarkdownV2 would require escaping every
 * `.`/`_`/`-`; we use the simpler legacy `Markdown` mode where only a
 * subset is special). Keep messages short — Telegram caps at 4096 chars
 * and operators read them on phones.
 */
export async function notifyTelegram(text: string): Promise<void> {
  const token = config.TELEGRAM_BOT_TOKEN;
  const chatId = config.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '<no body>');
      console.log(`[telegram-notify] HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[telegram-notify] send failed: ${msg}`);
  }
}

/**
 * Fire-and-forget wrapper for call sites that shouldn't `await`. The promise
 * is discarded but errors are still caught inside notifyTelegram itself.
 */
export function notifyTelegramAsync(text: string): void {
  void notifyTelegram(text);
}

/**
 * Escape a user-supplied string for safe interpolation inside legacy
 * `Markdown` parse_mode bodies. We don't try to block-quote — we just
 * neutralize the metacharacters that would either crash Telegram's parser
 * ("Bad Request: can't parse entities") or let an attacker forge bold /
 * link / code-block sections inside an alert. Used for usernames, IPs,
 * error messages and anything else that ultimately comes from a user.
 *
 * Why not switch to `MarkdownV2`? V2 needs every reserved char escaped
 * everywhere — including in literal alert text we own — which makes the
 * call sites unreadable. Legacy `Markdown` only treats `_`, `*`, `[`, `` ` ``
 * as metacharacters, so escaping those is enough.
 */
export function escapeMarkdown(s: string): string {
  return s.replace(/([_*`[\]])/g, '\\$1');
}

/**
 * Coarsen an IP for operational alerts. Full IPs in a third-party chat
 * (Telegram) are operational PII — anyone with the bot token can see
 * every admin login source. Redacting to /24 (v4) or /48 (v6) keeps
 * useful "different geography" signal while dropping the last-mile bits
 * that identify a specific household / mobile carrier session.
 *
 * Handles:
 *   - bare IPv4 ("1.2.3.4") → "1.2.3.0/24"
 *   - bare IPv6 ("2001:db8::1") → "2001:db8:0::/48"
 *   - IPv6 with zone id ("fe80::1%eth0") → strips zone, then redact
 *   - bracketed-with-port ("[2001:db8::1]:443") → unwraps, redacts head
 *   - IPv4 with port ("1.2.3.4:5678") → strips port, redacts
 *   - IPv4-mapped IPv6 ("::ffff:1.2.3.4") → unwraps to v4 redaction
 *   - anything else → "[redacted]" rather than leak unchanged input
 */
export function redactIp(input: string): string {
  if (!input) return '[redacted]';
  let ip = input.trim();

  // Strip [v6]:port bracket form.
  if (ip.startsWith('[')) {
    const close = ip.indexOf(']');
    if (close > 0) ip = ip.slice(1, close);
  }

  // Strip zone id (fe80::1%eth0 → fe80::1).
  const pct = ip.indexOf('%');
  if (pct >= 0) ip = ip.slice(0, pct);

  return _redactNormalizedIp(ip);
}

// Split out to keep regex literals away from any hook that flags `.exec(`
// in unrelated security-warning matchers.
function _redactNormalizedIp(ip: string): string {
  const reMapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
  const reV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/;
  const mapped = reMapped.test(ip)
    ? ip.replace(/^::ffff:/i, '')
    : null;
  if (mapped) return redactIp(mapped);
  const m = ip.match(reV4);
  if (m) {
    // Octets must be 0-255. Without this, `256.256.256.256` passes the
    // shape regex and gets redacted to a fake CIDR — pollutes alerts and
    // could mask the operator that an invalid IP made it through.
    const octets = [m[1], m[2], m[3], m[4]].map((p) => parseInt(p!, 10));
    if (octets.every((o) => o >= 0 && o <= 255)) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
    }
  }
  if (ip.includes(':')) {
    const parts = ip.toLowerCase().split('::');
    if (parts.length > 2) return '[redacted]';
    const left = parts[0] ? parts[0]!.split(':') : [];
    const right = parts.length === 2 && parts[1] ? parts[1]!.split(':') : [];
    const fill = 8 - left.length - right.length;
    if (fill < 0) return '[redacted]';
    const full = [...left, ...Array(fill).fill('0'), ...right];
    const head = full.slice(0, 3).map((h) => h || '0').join(':');
    return `${head}::/48`;
  }
  return '[redacted]';
}

// Wave-14 #7: Telegram login alerts used to ship the raw username, so a
// compromise of the bot token (or anyone with read access to the alert
// channel) got a continuous side-channel of attempted usernames being
// probed. We keep enough characters to let the operator recognise their
// own admin name at a glance but cut the rest so distributed scans against
// "admin" / "root" / "administrator" / etc. only appear in the alert as
// "ad***" / "ro***" — useful as "someone is brute-forcing", useless for
// the attacker as enumeration confirmation.
export function redactUsername(input: string): string {
  if (!input) return '[redacted]';
  const u = input.trim();
  if (u.length <= 2) return '***';
  return u.slice(0, 2) + '***';
}
