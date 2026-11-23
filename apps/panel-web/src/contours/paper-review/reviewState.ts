import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { readStored, writeStored } from '@/lib/storage'

function sameShape(value: unknown, example: unknown): boolean {
  if (Array.isArray(example))
    return (
      Array.isArray(value) &&
      value.every((item) => !example.length || example.some((model: unknown) => sameShape(item, model)))
    )
  if (example && typeof example === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const fields = value as Record<string, unknown>
    return Object.entries(example).every(([key, field]) => sameShape(fields[key], field))
  }
  return typeof value === typeof example
}

export function useReviewValue<T>(name: string, initial: T): [T, (next: T) => void] {
  const key = 'paper-review.v1.' + name
  const [value, setValue] = useState<T>(
    () =>
      readStored(
        key,
        (candidate) => {
          if (!sameShape(candidate, initial)) throw new Error('Invalid local review data')
          return candidate as T
        },
        'session',
      ) ?? initial,
  )
  return [
    value,
    (next) => {
      setValue(next)
      writeStored(key, next, 'session')
    },
  ]
}

export function useSample() {
  const [params, setParams] = useSearchParams()
  return {
    sample: params.get('sample'),
    reset: () => {
      const next = new URLSearchParams(params)
      next.delete('sample')
      setParams(next, { replace: true })
    },
  }
}

export function matches(row: string[], needle: string) {
  return row.some((cell) => cell.toLocaleLowerCase('ru').includes(needle.trim().toLocaleLowerCase('ru')))
}
