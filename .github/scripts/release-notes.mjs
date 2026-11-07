/**
 * Текст GitHub-релиза для тега: шапка руками, список изменений от changelogen,
 * блок образов GHCR. Зовёт его .github/workflows/release.yml, когда CI на теге
 * зелёный.
 *
 *   node .github/scripts/release-notes.mjs <тег> <файл-вывода>
 *
 * Пишет текст в файл, а в $GITHUB_OUTPUT три ответа: `prerelease`, `latest`,
 * `previous`. Из них workflow ставит флаги релиза, сам он ничего не решает.
 *
 * Почему прошлый тег считается здесь, а не внутри changelogen: тот берёт
 * `git describe --tags` от HEAD, а на теге это сам тег, и список выходит пустым.
 * Плюс финалу нужен прошлый ФИНАЛ: v0.3.0 сравнивается с v0.2.1, а не с
 * v0.3.0-rc.2, иначе в релиз попадёт только хвост после последнего кандидата.
 *
 * Без зависимостей, кроме changelogen через npx по пиновой версии.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CHANGELOGEN_VERSION = '0.6.2';

// Имена образов, которые публикует job `docker` в ci.yml. Тест держит этот
// список равным матрице оттуда, чтобы релиз не называл образ, которого нет.
export const IMAGES = ['iceslab-backend', 'iceslab-frontend', 'iceslab-panel-web', 'iceslab-node'];

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;

/** Тег вида vX.Y.Z или vX.Y.Z-что-то. Остальное не релиз, и молчать нельзя. */
export function parseTag(tag) {
  const m = TAG_RE.exec(tag);
  if (!m) throw new Error(`"${tag}" is not a release tag (want vX.Y.Z or vX.Y.Z-rc.N)`);
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
}

export function isPrerelease(tag) {
  return parseTag(tag).pre !== null;
}

function compareFinal(a, b) {
  const x = parseTag(a);
  const y = parseTag(b);
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch;
}

/**
 * «Latest» получает только финал, и только самый старший из финалов. Без этого
 * GitHub отдаёт Latest каждому новому релизу, и хотфикс v0.2.2, выпущенный
 * после v0.3.0, сказал бы панелям на v0.2.1 обновляться до v0.2.2: панель
 * читает версию для подсказки об обновлении из /releases/latest.
 */
export function isLatest(tag, allTags) {
  if (isPrerelease(tag)) return false;
  const finals = allTags.filter((t) => TAG_RE.test(t) && !isPrerelease(t));
  return finals.every((t) => compareFinal(tag, t) >= 0);
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Ближайший тег-предок, по истории, а не по номеру: changelogen берёт
 * `from...to`, симметричную разность, и тег не из истории текущего притащил
 * бы в список чужие коммиты. Для финала только финалы, для кандидата любой.
 * Нет предка (первый тег в истории): null.
 */
export function previousTag(tag, cwd) {
  const args = ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'];
  if (!isPrerelease(tag)) args.push('--exclude', 'v*-*');
  try {
    return git([...args, `${tag}^`], cwd) || null;
  } catch {
    return null;
  }
}

const BUMP_LINE = /^- (\*\*[^*]+:\*\* )?(⚠️\s+)?Bump\b/i;
// Свёртка только внутри Chore и CI: `fix(deps): bump x` ради уязвимости это
// исправление, и оно остаётся строкой.
const FOLD_GROUP = /(^|\s)(Chore|CI)$/;

/**
 * Обновления зависимостей (бот и `ci: bump` / `chore: bump` руками) сворачивает
 * в одну строку «Dependency updates: N» в конце, опустевшие группы убирает.
 */
export function foldDependencyBumps(markdown) {
  const out = [];
  let group = '';
  let folded = 0;
  for (const line of markdown.split('\n')) {
    const heading = /^###? (.*)$/.exec(line);
    if (heading) group = heading[1].trim();
    if (FOLD_GROUP.test(group) && BUMP_LINE.test(line)) {
      folded++;
      continue;
    }
    out.push(line);
  }
  // Группа, от которой остался один заголовок, уходит вместе с ним.
  const kept = [];
  for (let i = 0; i < out.length; i++) {
    if (/^###? /.test(out[i])) {
      let j = i + 1;
      while (j < out.length && out[j].trim() === '') j++;
      if (j >= out.length || /^#{2,4} /.test(out[j])) {
        i = j - 1;
        continue;
      }
    }
    kept.push(out[i]);
  }
  let text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (folded > 0) text += `\n\n### 📦 Dependencies\n\n- Dependency updates: ${folded}`;
  return { text: text.trim(), folded };
}

/**
 * Вывод changelogen без его обёртки: шапки файла `# Changelog` и заголовка
 * `## from...to` (у релиза свой заголовок). Ссылка «compare» остаётся.
 */
export function stripChangelogenFrame(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.startsWith('[compare changes]') || l.startsWith('### '));
  return start === -1 ? '' : lines.slice(start).join('\n').trim();
}

/**
 * Теги образов такие, какие ставит metadata-action в ci.yml: `type=semver`
 * пишет версию без `v`, `type=sha` пишет `sha-` и семь знаков.
 */
export function imageBlock(tag, sha, owner) {
  const version = tag.slice(1);
  const short = sha.slice(0, 7);
  const lines = IMAGES.flatMap((name) => [
    `ghcr.io/${owner}/${name}:${version}`,
    `ghcr.io/${owner}/${name}:sha-${short}`,
  ]);
  const note = isPrerelease(tag)
    ? 'Release candidate: the `latest`, `main` and `X.Y` image tags are not moved by it.'
    : `\`:${parseTag(tag).major}.${parseTag(tag).minor}\` and \`:latest\` point at the same images.`;
  return ['## Container images', '', '```', ...lines, '```', '', note].join('\n');
}

// Тело релиза GitHub принимает до 125 000 знаков, и `gh release create` на
// большем падает. v0.2.1 дал 81 000 на 517 коммитах, так что следующий крупный
// минор упрётся в потолок. Запас на шапку и образы.
export const BODY_LIMIT = 120_000;

/**
 * Бинари агента, которые release.yml кладёт в тот же релиз, и как их сверить
 * руками: checksums, подпись ключом из .github/agent-keys, provenance.
 */
export function agentBlock(tag, repo) {
  const base = `https://github.com/${repo}/releases/download/${tag}`;
  return [
    '## Node agent binaries',
    '',
    '`iceslab-node-linux-amd64`, `iceslab-node-linux-arm64`, `SHA256SUMS` and `SHA256SUMS.sig` are attached below.',
    '',
    '```',
    `curl -fsSLO ${base}/iceslab-node-linux-amd64`,
    `curl -fsSLO ${base}/SHA256SUMS`,
    `curl -fsSLO ${base}/SHA256SUMS.sig`,
    'sha256sum -c --ignore-missing SHA256SUMS',
    `curl -fsSL https://raw.githubusercontent.com/${repo}/${tag}/.github/agent-keys/primary.pub -o primary.pub`,
    'openssl pkeyutl -verify -pubin -inkey primary.pub -rawin -in SHA256SUMS -sigfile SHA256SUMS.sig',
    '```',
    '',
    `Build provenance: \`gh attestation verify iceslab-node-linux-amd64 --repo ${repo}\`.`,
  ].join('\n');
}

export function assemble({ header, changes, previous, images, limit = BODY_LIMIT }) {
  const head = header && header.trim() ? [header.trim()] : [];
  const since = previous ? ` since ${previous}` : '';
  let list = changes && changes.trim() ? changes.trim() : '_No grouped changes._';
  const build = (l) => [...head, `## Changes${since}`, l, images].join('\n\n') + '\n';
  if (build(list).length > limit) {
    // Режется по строкам с конца, ссылка «compare» в начале списка остаётся.
    const lines = list.split('\n');
    const total = lines.filter((l) => l.startsWith('- ')).length;
    const note = (n) => `\n\n_The list is cut at ${n} of ${total} entries to fit a GitHub release; the compare link above has all of them._`;
    while (lines.length && build(lines.join('\n') + note(total)).length > limit) lines.pop();
    list = lines.join('\n').trim() + note(lines.filter((l) => l.startsWith('- ')).length);
  }
  return build(list);
}

function runChangelogen(from, tag, cwd) {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  const out = join(dir, 'changes.md');
  // npx на Windows это .cmd, без оболочки его не запустить; на раннере не нужно.
  execFileSync(
    'npx',
    ['--yes', `changelogen@${CHANGELOGEN_VERSION}`, `--from=${from}`, `--to=${tag}`, `--output=${out}`],
    { cwd, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' },
  );
  return existsSync(out) ? readFileSync(out, 'utf8') : '';
}

function main() {
  const [tag, outFile] = process.argv.slice(2);
  if (!tag || !outFile) {
    console.error('usage: release-notes.mjs <tag> <out-file>');
    process.exit(2);
  }
  parseTag(tag);
  const cwd = process.cwd();
  const sha = git(['rev-list', '-n1', tag], cwd);
  const owner = (process.env.GITHUB_REPOSITORY || 'icecompany-tech/iceslab').split('/')[0];

  const previous = previousTag(tag, cwd);
  // Первый тег в истории: от корневого коммита.
  const from = previous ?? git(['rev-list', '--max-parents=0', tag], cwd).split('\n').at(-1);
  const { text: changes, folded } = foldDependencyBumps(stripChangelogenFrame(runChangelogen(from, tag, cwd)));

  // docs/ в git не ходит, поэтому шапка релиза лежит здесь. Нет файла: релиз
  // выходит с одним автосписком, это не ошибка.
  const headerPath = join(cwd, '.github', 'release-notes', `${tag}.md`);
  const header = existsSync(headerPath) ? readFileSync(headerPath, 'utf8') : '';

  const repo = process.env.GITHUB_REPOSITORY || 'icecompany-tech/iceslab';
  const images = `${imageBlock(tag, sha, owner)}\n\n${agentBlock(tag, repo)}`;
  writeFileSync(outFile, assemble({ header, changes, previous, images }), 'utf8');

  const allTags = git(['tag', '--list', 'v*'], cwd).split('\n').filter(Boolean);
  const answers = {
    prerelease: String(isPrerelease(tag)),
    latest: String(isLatest(tag, allTags)),
    previous: previous ?? '',
    header: header ? 'yes' : 'no',
    folded: String(folded),
  };
  for (const [k, v] of Object.entries(answers)) console.log(`${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(answers).map(([k, v]) => `${k}=${v}\n`).join(''));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
