/**
 * The node's mTLS certificate, the pair the panel reaches the agent with
 * (A-124, BACK 92572130). Issued at bootstrap for a year; the panel renews it
 * by itself 30 days ahead, and the node page can renew it on request.
 *
 * `certNotAfter` has three values, and only one of them is a date:
 *   undefined  a server older than the field: nothing to say, no row;
 *   null       the agent never said (an agent older than rotation): «срок
 *              неизвестен», NOT «истёк»;
 *   string     the end of the certificate the node serves.
 * A string that does not parse is an incomplete fact and reads as unknown.
 */

/** Warn this long before the end; the same window the panel renews in. */
export const CERT_WARN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CertTerm =
  | { kind: 'unknown' }
  | { kind: 'ok' | 'soon'; notAfter: string; days: number }
  | { kind: 'expired'; notAfter: string; daysAgo: number };

export function certTerm(certNotAfter: unknown, now: number): CertTerm | null {
  if (certNotAfter === undefined) return null;
  if (typeof certNotAfter !== 'string' || certNotAfter === '') return { kind: 'unknown' };
  const end = Date.parse(certNotAfter);
  if (Number.isNaN(end)) return { kind: 'unknown' };
  if (end <= now) return { kind: 'expired', notAfter: certNotAfter, daysAgo: Math.floor((now - end) / DAY_MS) };
  const days = Math.floor((end - now) / DAY_MS);
  return { kind: days < CERT_WARN_DAYS ? 'soon' : 'ok', notAfter: certNotAfter, days };
}

/**
 * What the node page says beside the term (A-221, BACK 2b725c64).
 *
 * `agentCanRotate` false: the agent is older than rotation, the end was read
 * off a handshake, the panel cannot renew it and its cron skips the node. So
 * no button and no «the panel renews it itself»: the line says to update the
 * agent before the end. null or absent is not false (nothing known, or a
 * server older than the field): the button stays, the server's 409
 * CERT_UPDATE_AGENT still answers in words.
 */
export interface CertPageView {
  /** The renew button. */
  button: boolean;
  /** «Update the agent before <end>». */
  oldAgent: boolean;
  /** The hint under the row: soon says the panel renews by itself, so it is
   *  not given for an agent that cannot. */
  hint: 'soon' | 'expired' | null;
}

export function certPageView(term: CertTerm, agentCanRotate: unknown): CertPageView {
  const old = agentCanRotate === false && term.kind !== 'unknown';
  return {
    button: !old,
    oldAgent: old,
    hint: term.kind === 'expired' ? 'expired' : term.kind === 'soon' && !old ? 'soon' : null,
  };
}

/**
 * The warning on the node card in the fleet (ARCH 23.10): only where it
 * burns, without a date; the date and the button stay on the node page.
 * Worst first: expired, then soon, then an agent that cannot renew by itself.
 */
export type CertAlarm = 'expired' | 'soon' | 'oldAgent';

export function certAlarm(node: { certNotAfter?: unknown; agentCanRotate?: unknown }, now: number): CertAlarm | null {
  const term = certTerm(node.certNotAfter, now);
  if (!term || term.kind === 'unknown') return null;
  if (term.kind === 'expired') return 'expired';
  if (term.kind === 'soon') return 'soon';
  return node.agentCanRotate === false ? 'oldAgent' : null;
}

/**
 * A refused renewal, by the server's code (nodes.routes.ts, cert/rotate):
 *   404 CERT_NODE_NOT_FOUND;
 *   409 CERT_UPDATE_AGENT (the agent has no rotation), CERT_PENDING (one is
 *       already waiting for its confirm);
 *   502 CERT_INVALID (the agent refused the pair), CERT_UNCONFIRMED (served
 *       but not confirmed, the node goes back to its old pair by itself),
 *       CERT_UNREACHABLE.
 * The input is checked first; a code with the wrong status, or one not
 * listed, is null and goes to the toast in the server's words.
 */
const CODE_STATUS = {
  CERT_NODE_NOT_FOUND: 404,
  CERT_UPDATE_AGENT: 409,
  CERT_PENDING: 409,
  CERT_INVALID: 502,
  CERT_UNCONFIRMED: 502,
  CERT_UNREACHABLE: 502,
} as const;

export type CertRotateCode = keyof typeof CODE_STATUS;

export interface CertRotateRefusal {
  code: CertRotateCode;
  /** The server's sentence, the detail under the panel's words; '' when none. */
  detail: string;
}

export function certRotateRefusal(err: unknown): CertRotateRefusal | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return null;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (!data || typeof data !== 'object') return null;
  const { error, message } = data as { error?: unknown; message?: unknown };
  if (typeof error !== 'string' || !Object.hasOwn(CODE_STATUS, error)) return null;
  const code = error as CertRotateCode;
  if (status !== CODE_STATUS[code]) return null;
  return { code, detail: typeof message === 'string' ? message : '' };
}
