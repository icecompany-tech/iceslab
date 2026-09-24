import { REALITY_RECORD_LIMIT } from '@iceslab/shared';
import type { TestConnectResult } from '@/lib/domain/profiles';

// The REALITY listener's limit per handshake record, header included (E23),
// comes from the contract (packages/shared/src/reality.ts): the server measures
// against the same number and is the one that says no; the screen only prints
// the ratio. A copy here is what contractCopies refuses.

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
