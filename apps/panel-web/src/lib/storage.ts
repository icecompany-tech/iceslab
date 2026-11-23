// A convenience per browser: a screen must work with storage blocked, so every touch is
// guarded and a stored shape is parsed like any answer from outside.
import type { Parser } from '@/lib/net/parse'

export function readStored<T>(key: string, parse: Parser<T>, scope: 'local' | 'session' = 'local'): T | null {
  try {
    const storage = scope === 'session' ? sessionStorage : localStorage
    const raw = storage.getItem(key)
    return raw === null ? null : parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writeStored(key: string, value: unknown, scope: 'local' | 'session' = 'local'): void {
  try {
    const storage = scope === 'session' ? sessionStorage : localStorage
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Stays for this page's life.
  }
}
