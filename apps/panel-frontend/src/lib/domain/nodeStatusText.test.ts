import { describe, expect, it } from 'vitest';
import { nodeStatusText } from '@/lib/domain/nodeStatusText';

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
