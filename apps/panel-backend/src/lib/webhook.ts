import { createHmac } from 'node:crypto';
import { config } from '../config.js';

/**
 * K2: outbound webhook bus.
 *
 * Domain events flow through here as signed JSON POSTs to every configured
 * URL (`WEBHOOK_URLS`). Mirrors telegram-notify's contract: callers never
 * check whether webhooks are configured, and a flaky receiver never breaks
 * the calling flow (fire-and-forget, soft-fail, console-logged).
 *
 * Receivers verify authenticity by recomputing the HMAC over
 * `${timestamp}.${body}` with the shared `WEBHOOK_SECRET` and comparing to the
 * `x-iceslab-signature` header; the `x-iceslab-timestamp` lets them reject
 * stale replays.
 */

export interface WebhookPayload {
  event: string;
  timestamp: number;
  data: unknown;
}

/**
 * Serialise the event body. A plain JSON.stringify throws on bigint, and some
 * domain payloads carry bigints (e.g. user.traffic-reset.previousUsedBytes),
 * so bigints are emitted as decimal strings. Exported for unit testing.
 */
export function buildWebhookBody(event: string, data: unknown, timestamp: number): string {
  const payload: WebhookPayload = { event, timestamp, data };
  return JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/**
 * HMAC-SHA256 over `${timestamp}.${body}`, hex. Exported so receivers (and
 * tests) can replicate the signature exactly.
 */
export function signWebhook(body: string, timestamp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Fire-and-forget: POST a signed event to every configured webhook URL. No-op
 * when `WEBHOOK_URLS` is empty. Never throws.
 */
export function emitWebhook(event: string, data: unknown): void {
  const urls = config.WEBHOOK_URLS;
  if (!urls || urls.length === 0) return;

  const timestamp = Date.now();
  const body = buildWebhookBody(event, data, timestamp);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-iceslab-event': event,
    'x-iceslab-timestamp': String(timestamp),
  };
  if (config.WEBHOOK_SECRET) {
    headers['x-iceslab-signature'] = signWebhook(body, timestamp, config.WEBHOOK_SECRET);
  }

  for (const url of urls) {
    void fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => {
        if (!res.ok) {
          console.log(`[webhook] ${event} -> ${url} HTTP ${res.status}`);
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[webhook] ${event} -> ${url} failed: ${msg}`);
      });
  }
}
