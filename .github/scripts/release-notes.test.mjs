import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IMAGES,
  agentBlock,
  assemble,
  foldDependencyBumps,
  imageBlock,
  isLatest,
  isPrerelease,
  parseTag,
  previousTag,
  stripChangelogenFrame,
} from './release-notes.mjs';

/**
 * Текст и флаги релиза собираются этим скриптом без человека: неверный прошлый
 * тег даёт релиз со списком не того диапазона, неверный `latest` переводит
 * подсказку об обновлении в панелях на старую версию. Оба ответа проверены
 * здесь на настоящем git, а не на заглушке. Запуск: `node --test`.
 */

const here = dirname(fileURLToPath(import.meta.url));

test('1. кандидат это тег с дефисом, мусорный тег отказ', () => {
  assert.equal(isPrerelease('v0.3.0-rc.1'), true);
  assert.equal(isPrerelease('v0.3.0'), false);
  assert.throws(() => parseTag('v0.3'), /not a release tag/);
  assert.throws(() => parseTag('release-1'), /not a release tag/);
});

test('2. Latest только у старшего финала: хотфикс после минора и кандидат его не берут', () => {
  const tags = ['v0.2.1', 'v0.3.0-rc.1', 'v0.3.0', 'v0.2.2', 'v0.4.0-rc.1'];
  assert.equal(isLatest('v0.3.0', tags), true);
  assert.equal(isLatest('v0.2.2', tags), false);
  assert.equal(isLatest('v0.4.0-rc.1', tags), false);
  // Сравнение числами, не строкой: 0.10 старше 0.9.
  assert.equal(isLatest('v0.10.0', ['v0.9.0', 'v0.10.0']), true);
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-git-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'tag.gpgsign', 'false');
  let n = 0;
  const commit = (msg) => g('commit', '-q', '--allow-empty', '-m', msg ?? `feat: c${++n}`);
  return { dir, g, commit };
}

test('3. прошлый тег: финалу прошлый финал, кандидату любой, первому никакого', () => {
  const { dir, g, commit } = repo();
  commit();
  g('tag', 'v0.2.1');
  commit();
  g('tag', 'v0.3.0-rc.1');
  commit();
  g('tag', 'v0.3.0-rc.2');
  commit();
  g('tag', 'v0.3.0');
  assert.equal(previousTag('v0.3.0', dir), 'v0.2.1');
  assert.equal(previousTag('v0.3.0-rc.2', dir), 'v0.3.0-rc.1');
  assert.equal(previousTag('v0.3.0-rc.1', dir), 'v0.2.1');
  assert.equal(previousTag('v0.2.1', dir), null);
});

test('4. финал на том же коммите, что последний кандидат, всё равно идёт от прошлого финала', () => {
  const { dir, g, commit } = repo();
  commit();
  g('tag', 'v1.0.0');
  commit();
  g('tag', 'v1.1.0-rc.1');
  g('tag', 'v1.1.0');
  assert.equal(previousTag('v1.1.0', dir), 'v1.0.0');
});

test('5. обновления зависимостей в Chore и CI свёрнуты в одну строку, пустые группы ушли', () => {
  const md = [
    '[compare changes](https://x/compare/a...b)',
    '',
    '### 🩹 Fixes',
    '',
    '- **deps:** Bump undici to close an advisory ([abc](u))',
    '',
    '### 🏡 Chore',
    '',
    '- Bump the minor-and-patch group with 27 updates ([#35](u))',
    '',
    '### 🤖 CI',
    '',
    '- Bump the actions group with 9 updates ([#34](u))',
    '- Gate develop like main ([def](u))',
  ].join('\n');
  const { text, folded } = foldDependencyBumps(md);
  assert.equal(folded, 2);
  assert.doesNotMatch(text, /Chore/);
  assert.match(text, /### 🤖 CI\n\n- Gate develop like main/);
  // Исправление остаётся строкой, даже если в нём слово bump.
  assert.match(text, /Bump undici/);
  assert.match(text, /- Dependency updates: 2$/);
});

test('6. обёртка changelogen снята, compare остался', () => {
  const raw = '# Changelog\r\n\r\n\r\n## v0.2.0...v0.2.1\r\n\r\n[compare changes](u)\r\n\r\n### 🚀 Features\r\n\r\n- A ([1](u))\r\n';
  const s = stripChangelogenFrame(raw);
  assert.match(s, /^\[compare changes\]/);
  assert.doesNotMatch(s, /# Changelog|## v0/);
  assert.equal(stripChangelogenFrame('# Changelog\n\n## a...b\n'), '');
});

test('7. шапка идёт первой, без неё и без коммитов текст всё равно собирается', () => {
  const images = imageBlock('v0.3.0', 'abcdef1234567', 'icecompany-tech');
  const withHeader = assemble({ header: '# Theme\n', changes: '- x', previous: 'v0.2.1', images });
  assert.match(withHeader, /^# Theme\n\n## Changes since v0\.2\.1\n\n- x\n\n## Container images/);
  const bare = assemble({ header: '', changes: '', previous: null, images });
  assert.match(bare, /^## Changes\n\n_No grouped changes\._/);
});

test('8. длинный список режется под потолок GitHub с пометкой, образы на месте', () => {
  const images = imageBlock('v0.3.0', 'abcdef1', 'o');
  const changes = Array.from({ length: 500 }, (_, i) => `- entry ${i} ${'y'.repeat(80)}`).join('\n');
  const body = assemble({ header: '', changes, previous: 'v0.2.1', images, limit: 10_000 });
  assert.ok(body.length <= 10_000, `${body.length}`);
  assert.match(body, /cut at \d+ of 500 entries/);
  assert.match(body, /## Container images/);
});

test('9. образы: версия без v и sha из семи знаков, у кандидата пометка про latest', () => {
  const rc = imageBlock('v0.3.0-rc.1', 'abcdef1234567', 'icecompany-tech');
  assert.match(rc, /ghcr\.io\/icecompany-tech\/iceslab-backend:0\.3\.0-rc\.1\n/);
  assert.match(rc, /iceslab-node:sha-abcdef1\n/);
  assert.match(rc, /not moved/);
  assert.match(imageBlock('v0.3.0', 'abcdef1', 'o'), /`:0\.3` and `:latest`/);
});

test('9b. блок бинарей агента: четыре файла тега и сверка подписи ключом из репо', () => {
  const b = agentBlock('v0.3.0-rc.1', 'icecompany-tech/iceslab');
  for (const f of ['iceslab-node-linux-amd64', 'iceslab-node-linux-arm64', 'SHA256SUMS', 'SHA256SUMS.sig']) {
    assert.match(b, new RegExp(f.replace('.', '\\.')));
  }
  assert.match(b, /releases\/download\/v0\.3\.0-rc\.1\/SHA256SUMS\.sig/);
  assert.match(b, /\/icecompany-tech\/iceslab\/v0\.3\.0-rc\.1\/\.github\/agent-keys\/primary\.pub/);
  assert.match(b, /openssl pkeyutl -verify -pubin -inkey primary\.pub -rawin/);
});

test('10. имена образов те же, что публикует job docker в ci.yml', () => {
  const ci = readFileSync(join(here, '..', 'workflows', 'ci.yml'), 'utf8');
  const matrix = ci.slice(ci.indexOf('  docker:'), ci.indexOf('    steps:', ci.indexOf('  docker:')));
  const names = [...matrix.matchAll(/- name: (iceslab-[a-z-]+)/g)].map((m) => m[1]);
  assert.deepEqual(names, IMAGES);
});

test('11. скрипт целиком: мусорный тег отказывает до git и до сети', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'rn-out-')), 'o');
  writeFileSync(out, '');
  assert.throws(
    () => execFileSync(process.execPath, [join(here, 'release-notes.mjs'), 'not-a-tag', out], { stdio: 'pipe' }),
    /not a release tag/,
  );
});
