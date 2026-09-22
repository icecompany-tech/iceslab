/**
 * Отчёт eslint -> аннотации GitHub на строках файлов в PR.
 *
 * Почему не форматтер: `unix` и `compact`, на которые ссылаются все рецепты с
 * problem-matcher, из ядра ESLint 9 УБРАНЫ («The unix formatter is no longer
 * part of core ESLint»), а `@microsoft/eslint-formatter-sarif` это лишний пакет
 * в дереве ради того же результата. Встроенный `json` никуда не делся, и
 * перевод его в `::error file=...` это десять строк без единой зависимости.
 *
 * Скрипт САМ решает судьбу шага: eslint запускается с `|| true`, иначе падение
 * линта оборвало бы job до того, как аннотации напечатаны, и человек увидел бы
 * красный крест без единой подсказки, где именно.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
let report;
try {
  report = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  // Отчёта нет: это не «линт чист», это сломанный запуск, и молчать нельзя.
  console.log(`::error::eslint report ${file} is missing or unreadable (${err.message})`);
  process.exit(1);
}

// `::` и перевод строки в тексте аннотации ломают её разбор: GitHub ждёт одну
// строку на команду и свой разделитель.
const clean = (s) => String(s).replace(/\r?\n/g, ' ').replace(/::/g, ':');

let errors = 0;
let warnings = 0;
for (const result of report) {
  for (const m of result.messages) {
    const level = m.severity === 2 ? 'error' : 'warning';
    if (m.severity === 2) errors++;
    else warnings++;
    const where = `file=${result.filePath},line=${m.line ?? 1},col=${m.column ?? 1}`;
    console.log(`::${level} ${where}::${clean(m.message)}${m.ruleId ? ` (${m.ruleId})` : ''}`);
  }
}

console.log(`eslint: ${errors} errors, ${warnings} warnings`);
process.exit(errors > 0 ? 1 : 0);
