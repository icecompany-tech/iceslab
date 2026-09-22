import { describe, expect, it } from 'vitest';
import { coreReason, refusalOf } from '@/lib/domain/syncRefusal';

/**
 * Причина, по которой ядро не взяло конфиг, вытащенная из его же вывода.
 *
 * Ответ ядра это несколько сотен символов баннера, служебных строк и цепочки
 * подсистем. Оператору нужна последняя её часть, и ошибка здесь стоит дорого в
 * обе стороны: покажем не тот кусок, человек пойдёт чинить не то; покажем
 * пустую строку, и красная полоса будет кричать, не сказав ни слова.
 */

const REAL = [
  'agent: core refused the config it was handed, nothing was applied',
  'Xray 25.9.5 (Xray, Penetrates Everything.) Custom (go1.24.4 linux/amd64)',
  '2026/09/21 10:47:03 [Info] infra/conf/serial: Reading config from STDIN',
  '2026/09/21 10:47:03 Failed to start: main: failed to create server > infra/conf: failed to build inbound handler > proxy/vless/inbound: failed to parse account > "flow" doesn\'t support "xtls-rprx-nosuchflow" in this version',
].join('\n');

describe('coreReason', () => {
  it('1. берёт хвост после ПОСЛЕДНЕГО «>», а не после первого', () => {
    expect(coreReason(REAL)).toBe('"flow" doesn\'t support "xtls-rprx-nosuchflow" in this version');
  });

  it('2. цепочки нет: показывается весь текст, а не пустая строка', () => {
    expect(coreReason('bind: address already in use')).toBe('bind: address already in use');
  });

  it('3. переводы строк схлопываются: причина это одна строка', () => {
    expect(coreReason('main: failed\n  > inner: because\n  of this')).toBe('inner: because of this');
  });

  it('4. «>» в самом конце: хвост пуст, поэтому отдаётся весь текст', () => {
    expect(coreReason('failed to start >')).toBe('failed to start >');
  });

  it('5. пустая строка и пробелы: тоже пусто, но без падения', () => {
    expect(coreReason('')).toBe('');
    expect(coreReason('   \n  ')).toBe('');
  });
});

describe('refusalOf', () => {
  it('6. поля нет: отказа нет, и красная строка не рисуется', () => {
    expect(refusalOf({ lastInboundSyncError: null })).toBeNull();
    expect(refusalOf({ lastInboundSyncError: undefined })).toBeNull();
  });

  it('7. пустое сообщение это не отказ: кричать нечем', () => {
    expect(refusalOf({ lastInboundSyncError: { at: '2026-09-21T10:47:03Z', message: '' } })).toBeNull();
    expect(refusalOf({ lastInboundSyncError: { at: '2026-09-21T10:47:03Z', message: '   ' } })).toBeNull();
  });

  it('8. отказ есть: время как прислали, причина коротко, ответ целиком рядом', () => {
    const r = refusalOf({ lastInboundSyncError: { at: '2026-09-21T10:47:03Z', message: REAL } });
    expect(r?.at).toBe('2026-09-21T10:47:03Z');
    expect(r?.reason).toBe('"flow" doesn\'t support "xtls-rprx-nosuchflow" in this version');
    // Полный текст не режется: за ним и открывают раскрытие.
    expect(r?.full).toBe(REAL);
    expect(r?.full).toContain('Xray 25.9.5');
  });
});
