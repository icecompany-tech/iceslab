/**
 * Что сказать про последний пуш каскада (E46, BACK 3962886).
 *
 * Сервер сам решает, сломан ли каскад, и присылает фразу агента строкой:
 * экран её не разбирает, только показывает. `broken` выигрывает у `done`:
 * с E46 сервер и так отдаёт done=false при любом broken, а противоречивый
 * ответ «готово и сломан» читается как сломан, потому что «готово» поверх
 * неработающей цепи это ровно та ложь, которую E46 закрывает.
 *
 *   loading  ответа ещё нет (или пришло не то, что ждали);
 *   broken   фраза «<нода>: <причина>»;
 *   done     все хопы приняли конфиг, никто не сломан;
 *   pending  ждём хопы, `waiting` их имена.
 */
export type CascadeStatusView =
  | { kind: 'loading' }
  | { kind: 'broken'; broken: string }
  | { kind: 'done' }
  | { kind: 'pending'; waiting: string[] };

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

export function cascadeStatusView(status: unknown): CascadeStatusView {
  if (typeof status !== 'object' || status === null) return { kind: 'loading' };
  const s = status as { done?: unknown; broken?: unknown; hops?: unknown };
  const broken = text(s.broken);
  if (broken) return { kind: 'broken', broken };
  if (s.done === true) return { kind: 'done' };
  // Список хопов может не прийти (ещё ничего не пушили): это не падение.
  const hops = Array.isArray(s.hops) ? s.hops : [];
  const waiting = hops
    .filter((h): h is { name: string; applied?: unknown } => typeof h === 'object' && h !== null && typeof h.name === 'string')
    .filter((h) => h.applied !== true)
    .map((h) => h.name);
  return { kind: 'pending', waiting };
}

/** Причина у одного хопа: строка агента или null (нет ключа, null, пусто). */
export function hopBroken(hop: unknown): string | null {
  if (typeof hop !== 'object' || hop === null) return null;
  return text((hop as { broken?: unknown }).broken);
}
