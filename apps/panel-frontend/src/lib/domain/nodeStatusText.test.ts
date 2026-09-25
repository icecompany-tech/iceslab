import { describe, expect, it } from 'vitest';
import { nodeStatusText, statusRepeatsRefusal } from '@/lib/domain/nodeStatusText';

describe('statusRepeatsRefusal: одна беда один раз (E38)', () => {
  const refusal = { reason: 'fetch failed', full: 'agent > sync > fetch failed' };
  it('совпадает с причиной или полным текстом отказа: повтор', () => {
    expect(statusRepeatsRefusal('fetch failed', refusal)).toBe(true);
    expect(statusRepeatsRefusal('  agent >  sync > fetch failed ', refusal)).toBe(true);
  });
  it('разные тексты, нет отказа или нет причины: не повтор, показываются оба', () => {
    expect(statusRepeatsRefusal('system resolver not answering', refusal)).toBe(false);
    expect(statusRepeatsRefusal('fetch failed', null)).toBe(false);
    expect(statusRepeatsRefusal(null, refusal)).toBe(false);
    expect(statusRepeatsRefusal('', { reason: '', full: '' })).toBe(false);
  });
});

const t = (k: string) => (k === 'nodeCard.statusPhrase.resolverDown' ? 'нода не резолвит домены' : k);

describe('nodeStatusText: причина статуса ноды по-русски', () => {
  it('фраза о резолвере переводится, хвост сообщения остаётся как есть', () => {
    expect(nodeStatusText('system resolver not answering; not running: xray', t)).toBe(
      'нода не резолвит домены; not running: xray',
    );
    expect(nodeStatusText('system resolver not answering', t)).toBe('нода не резолвит домены');
  });

  it('незнакомое сообщение без изменений; пустое и не строка: нечего показать', () => {
    expect(nodeStatusText('chain-process: exited', t)).toBe('chain-process: exited');
    for (const v of [null, undefined, '', '   ']) expect(nodeStatusText(v, t)).toBeNull();
  });
});
