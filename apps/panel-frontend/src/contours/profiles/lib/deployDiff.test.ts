import { describe, expect, it } from 'vitest';
import { deployDiff } from '@/contours/profiles/lib/deployDiff';

describe('deployDiff', () => {
  const b = (id: string, nodeId: string) => ({ id, nodeId });

  it('1. отметили новую ноду: одна привязка создаётся, ничего не снимается', () => {
    expect(deployDiff(new Set(['n1']), new Set(['n1', 'n2']), [b('b1', 'n1')])).toEqual({
      create: ['n2'],
      remove: [],
    });
  });

  it('2. сняли галку: снимается ровно эта привязка', () => {
    expect(deployDiff(new Set(['n1', 'n2']), new Set(['n1']), [b('b1', 'n1'), b('b2', 'n2')])).toEqual({
      create: [],
      remove: ['b2'],
    });
  });

  it('3. привязка появилась где-то ещё, пока окно открыто: НЕ удаляется', () => {
    // Сервер принёс b3 на n3 фоновым рефетчем; галки у n3 нет, потому что
    // окно засеялось раньше. Оператор её не видел и не снимал.
    expect(
      deployDiff(new Set(['n1']), new Set(['n1']), [b('b1', 'n1'), b('b3', 'n3')]),
    ).toEqual({ create: [], remove: [] });
  });

  it('4. отмеченная нода уже получила привязку сама: второй раз не создаётся', () => {
    expect(deployDiff(new Set(), new Set(['n2']), [b('b2', 'n2')])).toEqual({ create: [], remove: [] });
  });

  it('5. ничего не меняли: ни одного запроса', () => {
    expect(deployDiff(new Set(['n1']), new Set(['n1']), [b('b1', 'n1')])).toEqual({ create: [], remove: [] });
  });
});
