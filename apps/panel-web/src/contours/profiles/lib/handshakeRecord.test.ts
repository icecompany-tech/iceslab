import { describe, expect, it } from 'vitest';
import { REALITY_RECORD_LIMIT } from '@iceslab/shared';
import { handshakeRecordFacts } from '@/contours/profiles/lib/handshakeRecord';

describe('handshakeRecordFacts: запись хендшейка цели REALITY', () => {
  it('поле есть и в пределах: число и предел из контракта, не красное (www.apple.com, замер BACK)', () => {
    expect(handshakeRecordFacts({ kind: 'dest', handshakeRecordMax: 4738 })).toEqual({
      bytes: 4738,
      limit: REALITY_RECORD_LIMIT,
      over: false,
    });
  });

  it('больше предела: красное (www.microsoft.com, E23); ровно предел проходит', () => {
    expect(handshakeRecordFacts({ kind: 'dest', handshakeRecordMax: 8273 })).toMatchObject({ over: true });
    expect(handshakeRecordFacts({ kind: 'dest', handshakeRecordMax: REALITY_RECORD_LIMIT })).toMatchObject({
      over: false,
    });
  });

  it('поля нет (сервер старше, проба не дошла): строки нет', () => {
    expect(handshakeRecordFacts({ kind: 'dest' })).toBeNull();
  });

  it('не dest или мусор вместо числа: строки нет', () => {
    expect(handshakeRecordFacts({ kind: 'endpoint', handshakeRecordMax: 4738 })).toBeNull();
    for (const v of ['4738', NaN, -1, 12.5, null]) {
      expect(handshakeRecordFacts({ kind: 'dest', handshakeRecordMax: v as unknown as number })).toBeNull();
    }
  });
});
