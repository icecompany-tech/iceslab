// A convenience per browser: a screen must work with storage blocked, so every touch is
// guarded and a stored shape is parsed like any answer from outside.
import type { Parser } from '@/lib/net/parse'

export function readStored<T>(key: string, parse: Parser<T>): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Stays for this page's life.
  }
}
