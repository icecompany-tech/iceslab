/**
 * What the delivery probe found (A-137, BACK 371d5d85).
 *
 *   ok           the subscription route itself answered (its 404 for a token
 *                nobody owns): subscribers get configs at this address;
 *   notRoute     something answered (status > 0) but not the route: the SPA's
 *                index.html, a proxy's own page, a redirect. Subscribers get
 *                that instead of configs, so it is red, with the server's words;
 *   unreachable  nothing answered (status 0).
 *
 * `ok` used to be «anything under 500», and the screen said «the address
 * answers» over an HTML page every subscriber received.
 */
export type ProbeVerdict = 'ok' | 'notRoute' | 'unreachable';

export function probeVerdict(r: { ok: boolean; status: number }): ProbeVerdict {
  if (r.ok) return 'ok';
  return r.status > 0 ? 'notRoute' : 'unreachable';
}
