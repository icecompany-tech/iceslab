import { createContext, useContext } from 'react'

export type ToastTone = 'done' | 'partial' | 'failed'

export interface ToastApi {
  show: (message: string, tone?: ToastTone) => void
}

export const ToastContext = createContext<ToastApi>({ show: () => undefined })

export const useToast = () => useContext(ToastContext)
