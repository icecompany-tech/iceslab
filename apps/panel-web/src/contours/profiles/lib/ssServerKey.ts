/**
 * The shadowsocks server key (`serverPsk`) on the profile form (A-028).
 *
 * The form has no field for the key, and every edit used to send
 * `config: { method }` as the whole config, which erased the stored key. Since
 * 2a09844 the server keeps the stored key when a config arrives without one,
 * and issues a new one only when the cipher changes to another key length
 * (`pskFitsMethod`, panel-backend `profiles/ss-helpers.ts`). So the form sends
 * the cipher alone and never a key: the length rule lives in one place, on the
 * server.
 */

/** The stored key, read from the config the server sent. Input checked first. */
export function storedSsKey(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const key = (config as { serverPsk?: unknown }).serverPsk;
  return typeof key === 'string' && key !== '' ? key : null;
}

/** The stored cipher, the same way. */
export function storedSsMethod(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const m = (config as { method?: unknown }).method;
  return typeof m === 'string' && m !== '' ? m : null;
}

/**
 * What the form says about the key.
 *
 *   set     there is a stored key and the cipher is the stored one: the save
 *           leaves the key alone;
 *   change  the cipher changed: the server keeps the key if it fits the new
 *           cipher and issues a new one if not (then clients get new links);
 *   new     there is no stored key: the save issues one;
 *   server  a profile being created: the server issues the key.
 */
export type SsKeyState = 'set' | 'change' | 'new' | 'server';

export function ssKeyState(storedConfig: unknown, isEdit: boolean, method: string): SsKeyState {
  if (!isEdit) return 'server';
  if (storedSsKey(storedConfig) === null) return 'new';
  return storedSsMethod(storedConfig) === method ? 'set' : 'change';
}

/**
 * The config an edit sends: nothing while the cipher is the stored one and a
 * key is stored, the cipher alone otherwise. A create sends the cipher alone
 * too; the server fills the key in on both paths.
 */
export function ssConfigPatch(
  storedConfig: unknown,
  isEdit: boolean,
  method: string,
): { config?: { method: string } } {
  return isEdit && ssKeyState(storedConfig, isEdit, method) === 'set' ? {} : { config: { method } };
}
