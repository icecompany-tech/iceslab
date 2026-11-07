import { describe, expect, it } from 'vitest';
import {
  portHopConfig,
  portHopProblem,
  portHopRefusal,
  portHopWords,
} from '@/contours/profiles/lib/portHopRange';

const res = (status: number, data: unknown) => ({ response: { status, data } });
const issue = (field: unknown) =>
  res(400, { error: 'VALIDATION_ERROR', issues: [{ code: 'custom', path: ['config', field], message: 'english' }] });

describe('portHopConfig: ни одна граница не пропадает молча (A-284)', () => {
  it('обе, одна, ни одной', () => {
    expect(portHopConfig(20000, 50000)).toEqual({ portHoppingStart: 20000, portHoppingEnd: 50000 });
    expect(portHopConfig(20000, '')).toEqual({ portHoppingStart: 20000 });
    expect(portHopConfig('', 50000)).toEqual({ portHoppingEnd: 50000 });
    expect(portHopConfig('', '')).toEqual({});
  });
});

describe('portHopProblem: те же правила, что у сервера (94266ace)', () => {
  it('пусто или верный диапазон: сказать нечего', () => {
    expect(portHopProblem('', '')).toBeNull();
    expect(portHopProblem(20000, 50000)).toBeNull();
  });
  it('только конец: поле начала; только начало, конец не выше: поле конца', () => {
    expect(portHopProblem('', 50000)).toBe('hyPortHopStart');
    expect(portHopProblem(20000, '')).toBe('hyPortHopEnd');
    expect(portHopProblem(50000, 20000)).toBe('hyPortHopEnd');
    expect(portHopProblem(20000, 20000)).toBe('hyPortHopEnd');
  });
});

describe('portHopRefusal: отказ сервера у поля по path', () => {
  it('config.portHoppingStart и config.portHoppingEnd', () => {
    expect(portHopRefusal(issue('portHoppingStart'))).toBe('hyPortHopStart');
    expect(portHopRefusal(issue('portHoppingEnd'))).toBe('hyPortHopEnd');
  });
  it('другое поле, другой код или статус, кривой вход: не этот отказ', () => {
    expect(portHopRefusal(issue('obfsPassword'))).toBeNull();
    expect(portHopRefusal(issue('constructor'))).toBeNull();
    expect(portHopRefusal(res(409, { error: 'VALIDATION_ERROR', issues: [{ path: ['config', 'portHoppingEnd'] }] }))).toBeNull();
    expect(portHopRefusal(res(400, { error: 'INVALID', issues: [{ path: ['config', 'portHoppingEnd'] }] }))).toBeNull();
    expect(portHopRefusal(res(400, { error: 'VALIDATION_ERROR', issues: [null, 'x', { path: 'config' }] }))).toBeNull();
    for (const e of [null, undefined, 'x', {}, { response: null }, res(400, null)]) expect(portHopRefusal(e)).toBeNull();
  });
});

describe('portHopWords: одна фраза на поле у формы и у отказа', () => {
  it('ключи по полю', () => {
    const t = (k: string) => k;
    expect(portHopWords('hyPortHopStart', t)).toBe('profileForm.portRangeNoStart');
    expect(portHopWords('hyPortHopEnd', t)).toBe('profileForm.portRangeBadEnd');
  });
});
