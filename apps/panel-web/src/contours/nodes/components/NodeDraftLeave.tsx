import { useState } from 'react'
import { DICT } from '@/contours/nodes/dict'
import { useDict } from '@/lib/i18n'
import { useLeaveGuard } from '@/lib/leaveGuard'
import { Confirm } from '@/ui/Dialog/Confirm'

export function useNodeDraftLeave(dirty: boolean, busy: boolean) {
  const words = useDict(DICT)
  const [pending, setPending] = useState<{ go: () => void } | null>(null)
  useLeaveGuard(dirty, go => setPending({ go }))
  return pending && <Confirm title={words.leaveTitle} tone="warn" state={{ busy }}
    labels={{ confirm: words.leaveDiscard, cancel: words.leaveStay }}
    onClose={() => setPending(null)} onConfirm={() => { setPending(null); pending.go() }}>{words.leaveDraft}</Confirm>
}
