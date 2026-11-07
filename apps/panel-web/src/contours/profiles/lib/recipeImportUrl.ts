/**
 * Адрес, который окно импорта отдаёт серверу вместо вставленного.
 *
 * Владелец вставил ссылку на страницу файла GitHub и получил «Валидных
 * рецептов не найдено»: сервер скачал HTML страницы, а не JSON (25.09).
 * Страницы GitHub и gist переводятся в raw-адрес того же файла, и окно
 * показывает, что подставило. Всё остальное уходит как вставлено.
 *
 *   github.com/<o>/<r>/blob/<ref>/<path>   raw.githubusercontent.com/<o>/<r>/<ref>/<path>
 *   github.com/<o>/<r>/raw/<ref>/<path>    то же
 *   gist.github.com/<u>/<id>               gist.githubusercontent.com/<u>/<id>/raw
 *
 * У gist raw без имени файла отдаёт ПЕРВЫЙ файл. Якорь `#file-...` на
 * странице gist имя файла не сохраняет (точки становятся дефисами), обратно
 * его не восстановить, поэтому `fromGistPage` говорит экрану, что взят первый
 * файл: для другого нужна ссылка с кнопки Raw.
 */
export interface RecipeImportUrl {
  url: string;
  /** Адрес переписан: экран показывает подставленный. */
  rewritten: boolean;
  /** Взят первый файл gist. */
  fromGistPage: boolean;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

export function recipeImportUrl(input: string): RecipeImportUrl {
  const raw = input.trim();
  const same = { url: raw, rewritten: false, fromGistPage: false };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return same;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return same;
  const parts = u.pathname.split('/').filter(Boolean);

  if (u.hostname === 'github.com' && parts.length >= 5 && (parts[2] === 'blob' || parts[2] === 'raw')) {
    const [owner, repo, , ref, ...path] = parts;
    if (![owner, repo, ref].every((s) => SEGMENT.test(s!))) return same;
    return {
      url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path.join('/')}`,
      rewritten: true,
      fromGistPage: false,
    };
  }

  if (u.hostname === 'gist.github.com' && parts.length === 2 && parts.every((s) => SEGMENT.test(s))) {
    const [user, id] = parts;
    return { url: `https://gist.githubusercontent.com/${user}/${id}/raw`, rewritten: true, fromGistPage: true };
  }

  return same;
}
