// Codex rule D: the time comes from the app, a test hands in its own.
import { createContext, useContext } from 'react'

export type Now = () => number

const ClockContext = createContext<Now | null>(null)

export const ClockProvider = ClockContext.Provider

export function useNow(): Now {
  const now = useContext(ClockContext)
  if (now === null) throw new Error('no ClockProvider above this component')
  return now
}
