import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Код выхода этого скрипта решает судьбу шага «Lint frontend»: eslint там
 * запущен с `|| true`, иначе job умер бы до печати аннотаций. Значит любая
 * тихая ошибка внутри скрипта делает джобу ЗЕЛЁНОЙ при живых нарушениях, и
 * это ровно тот отказ, который никто не заметит.
 *
 * Запускается встроенным `node --test`, без единой зависимости, как и сам
 * скрипт.
 */

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'eslint-annotations.mjs');
const dir = mkdtempSync(join(tmpdir(), 'eslint-ann-'));

function run(name, contents) {
  const file = join(dir, name);
  if (contents !== null) writeFileSync(file, contents, 'utf8');
  return spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
}

test('1. чистый отчёт: код 0, счёт нулями', () => {
  const r = run('clean.json', '[]');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /0 errors, 0 warnings/);
});

test('2. ошибка в отчёте: код 1 и аннотация с файлом, строкой и правилом', () => {
  const r = run('err.json', JSON.stringify([
    {
      filePath: '/repo/src/a.ts',
      errorCount: 1,
      warningCount: 0,
      messages: [{ severity: 2, line: 12, column: 3, message: 'no', ruleId: 'x/y' }],
    },
  ]));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error file=\/repo\/src\/a\.ts,line=12,col=3::no \(x\/y\)/);
});

test('3. одни предупреждения: аннотации есть, код 0, шаг не валится', () => {
  const r = run('warn.json', JSON.stringify([
    {
      filePath: '/repo/src/b.ts',
      errorCount: 0,
      warningCount: 1,
      messages: [{ severity: 1, line: 1, column: 1, message: 'meh', ruleId: 'a/b' }],
    },
  ]));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /::warning file=/);
});

test('4. СЛОМАННЫЙ json: код НЕ ноль и сказано про сам отчёт', () => {
  // Главный случай. Молчаливый выход нулём здесь означал бы зелёную джобу
  // поверх непрочитанных нарушений.
  const r = run('broken.json', '{ not json');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /::error::eslint report .* is missing or unreadable/);
});

test('5. отчёта нет вовсе: тоже не ноль', () => {
  const r = run('absent.json', null);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /missing or unreadable/);
});

test('6. перевод строки и «::» в сообщении не ломают аннотацию', () => {
  const r = run('nasty.json', JSON.stringify([
    {
      filePath: '/repo/src/c.ts',
      errorCount: 1,
      warningCount: 0,
      messages: [{ severity: 2, line: 2, column: 2, message: 'a\nb ::c', ruleId: null }],
    },
  ]));
  assert.equal(r.status, 1);
  const line = r.stdout.split('\n').find((l) => l.startsWith('::error file='));
  assert.equal(line, '::error file=/repo/src/c.ts,line=2,col=2::a b :c');
});
