import { PROTOCOL_NAMES, type ProtocolName } from '@iceslab/shared';

/**
 * `?protocols=`: a subscription that hands out one protocol or a few (promised
 * to the operator 24.08, before Э3 is handed over).
 *
 * The names are the panel's own (PROTOCOL_NAMES), comma-separated, in any case,
 * duplicates folded. A cascade line belongs to the protocol of the cascade's
 * ENTRY, which is simply the protocol of the endpoint that carries it: an xray
 * entry's lines are `xray`, a hysteria entry's host is `hysteria`, an
 * AmneziaWG entry's `amneziawg`. No alias: `vless` is a door of `xray`, not a
 * protocol of the panel, and a second vocabulary here would drift from the one
 * the operator sees on every other screen.
 */
export type ProtocolFilter =
  | { kind: 'all' }
  | { kind: 'some'; protocols: ProtocolName[] }
  | { kind: 'unknown'; protocol: string };

export function parseProtocolsParam(raw: unknown): ProtocolFilter {
  if (typeof raw !== 'string') return { kind: 'all' };
  const asked = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  // `?protocols=` with nothing in it asks for no narrowing, which is all.
  if (asked.length === 0) return { kind: 'all' };
  for (const p of asked) {
    if (!(PROTOCOL_NAMES as readonly string[]).includes(p)) return { kind: 'unknown', protocol: p };
  }
  // In the panel's own order, so one selection has one spelling: the page
  // builds the same string, and a cache or a comparison never sees two.
  return { kind: 'some', protocols: PROTOCOL_NAMES.filter((p) => asked.includes(p)) };
}

/** The distinct protocols of a list of endpoints, in the panel's order. */
export function protocolsOf(endpoints: readonly { protocol: string }[]): ProtocolName[] {
  const have = new Set(endpoints.map((e) => e.protocol));
  return PROTOCOL_NAMES.filter((p) => have.has(p));
}

/**
 * `url` with its `protocols` parameter set to `list`, or taken away for an
 * empty one. Every other parameter stays, in its order; `protocols` goes
 * first, so one selection always spells the same URL.
 *
 * ⚠ Plain JavaScript with no outside references: the page's switcher runs THIS
 * function's source in the browser (subscription.page-script.ts), so the link
 * the server prints and the link the switcher writes are one rule.
 */
export function withProtocols(url: string, list: readonly string[]): string {
  var hash = url.indexOf('#');
  var frag = hash < 0 ? '' : url.slice(hash);
  var rest = hash < 0 ? url : url.slice(0, hash);
  var q = rest.indexOf('?');
  var base = q < 0 ? rest : rest.slice(0, q);
  var params = (q < 0 ? '' : rest.slice(q + 1)).split('&').filter(function (p) {
    return p !== '' && p.indexOf('protocols=') !== 0;
  });
  if (list.length > 0) params.unshift('protocols=' + list.join(','));
  return base + (params.length > 0 ? '?' + params.join('&') : '') + frag;
}

/** `url` with one more query parameter, whether or not it already has some. */
export function withQuery(url: string, query: string): string {
  return url + (url.indexOf('?') < 0 ? '?' : '&') + query;
}
