import type { TestConnectResult } from '@/lib/domain/profiles';

/**
 * The REALITY listener's limit per handshake record, header included (E23).
 * It is the engine's, not ours: metacubex/utls v1.8.4 reality.go:72 in sing-box
 * 1.13.14, xtls/reality tls.go:140 in xray 26.3.27. The server measures against
 * the same number (REALITY_RECORD_LIMIT, test-connect/reality-dest-flight.ts)
 * and is the one that says no; the screen only prints the ratio.
 */
export const REALITY_RECORD_LIMIT = 8192;

/**
 * «запись хендшейка N байт из 8192» for a dest row, or null.
 *
 * Only a dest row with a whole, non-negative number carries it: an older server
 * does not send the field, and a row the probe did not reach has nothing to
 * measure. `over` paints the number; the refusal itself is the server's
 * `error`, shown as it came, because it already names a target that works.
 */
export function handshakeRecordFacts(
  r: Pick<TestConnectResult, 'kind' | 'handshakeRecordMax'>,
): { bytes: number; limit: number; over: boolean } | null {
  if (r.kind !== 'dest') return null;
  const n = r.handshakeRecordMax;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
  return { bytes: n, limit: REALITY_RECORD_LIMIT, over: n > REALITY_RECORD_LIMIT };
}
