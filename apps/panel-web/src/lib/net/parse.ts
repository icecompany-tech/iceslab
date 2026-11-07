// Codex F2: an answer becomes a type here, at the edge. A small hand-written reader
// instead of a schema library: this runs on every screen and the entry budget is 120 KB.
export type Parser<T> = (value: unknown, path?: string) => T

const fail = (path: string, expected: string): never => {
  throw new Error(`${path || 'answer'}: expected ${expected}`)
}

export const str: Parser<string> = (v, p = '') => (typeof v === 'string' ? v : fail(p, 'a string'))
export const num: Parser<number> = (v, p = '') => (typeof v === 'number' && Number.isFinite(v) ? v : fail(p, 'a number'))
export const bool: Parser<boolean> = (v, p = '') => (typeof v === 'boolean' ? v : fail(p, 'a boolean'))
export const anything: Parser<unknown> = (v) => v

export const nullable =
  <T>(inner: Parser<T>): Parser<T | null> =>
  (v, p) =>
    v === null ? null : inner(v, p)

/** A field an older server does not send: absent stays absent, it does not become "no". */
export const optional =
  <T>(inner: Parser<T>): Parser<T | undefined> =>
  (v, p) =>
    v === undefined ? undefined : inner(v, p)

/** A field that may be absent, null, or the value: the three things a read can mean. */
export const maybe = <T>(inner: Parser<T>): Parser<T | null | undefined> => optional(nullable(inner))

export const arr =
  <T>(inner: Parser<T>): Parser<T[]> =>
  (v, p = '') =>
    Array.isArray(v) ? v.map((item, i) => inner(item, `${p}[${i}]`)) : fail(p, 'a list')

export const oneOf =
  <const T extends string>(values: readonly T[]): Parser<T> =>
  (v, p = '') =>
    typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fail(p, values.join(' | '))

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export const record =
  <T>(inner: Parser<T>): Parser<Record<string, T>> =>
  (v, p = '') => {
    if (!isRecord(v)) return fail(p, 'an object')
    return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, inner(item, `${p}.${k}`)]))
  }

type Shape = Record<string, Parser<unknown>>
type Parsed<S extends Shape> = { [K in keyof S]: S[K] extends Parser<infer T> ? T : never }

export const obj =
  <S extends Shape>(shape: S): Parser<Parsed<S>> =>
  (v, p = '') => {
    if (!isRecord(v)) return fail(p, 'an object')
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(shape)) {
      const read = shape[key]
      if (read) out[key] = read(v[key], p ? `${p}.${key}` : key)
    }
    return out as Parsed<S>
  }
