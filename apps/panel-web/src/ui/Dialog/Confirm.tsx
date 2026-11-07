import type { ReactNode } from 'react'
import { Button } from '@/ui/Button/Button'
import { Dialog } from '@/ui/Dialog/Dialog'

export interface ConfirmProps {
  title: string
  /** The cost of the action, on the spot (F-K6). */
  children: ReactNode
  labels: { confirm: string; cancel: string }
  /** Red for what cannot be undone, amber for what can. */
  tone?: 'danger' | 'warn'
  /** A refusal stays in the window, in the server's words. */
  state?: { busy?: boolean; error?: string | null }
  onConfirm: () => void
  onClose: () => void
}

/** One shape of asking for every dangerous action: nothing is sent before the click here. */
export function Confirm({ title, children, labels, tone = 'danger', state, onConfirm, onClose }: ConfirmProps) {
  return (
    <Dialog
      title={title}
      closeLabel={labels.cancel}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{labels.cancel}</Button>
          <Button variant={tone} loading={state?.busy} onClick={onConfirm}>
            {labels.confirm}
          </Button>
        </>
      }
    >
      {children}
      {state?.error && <div role="alert">{state.error}</div>}
    </Dialog>
  )
}
