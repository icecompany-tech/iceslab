import { useState, type DragEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DICT } from '@/contours/squads/dict'
import { SQUADS_KEY } from '@/lib/domain/squads'
import { useDict, useLocale } from '@/lib/i18n'
import { isApiError, NO_ANSWER } from '@/lib/net/errors'
import { failureText } from '@/lib/net/messages'
import { listSquads, reorderSquads, type Squad } from '@/lib/old/squads'

interface Drag { id: string; expectedIds: string[] }

export function useSquadOrder(squads: readonly Squad[], enabled: boolean) {
  const client = useQueryClient()
  const words = useDict(DICT)
  const { locale } = useLocale()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  function end() { setDrag(null); setOver(null) }
  async function drop(before: string | null) {
    end()
    if (!enabled || !drag || busy || drag.id === before) return
    const ids = drag.expectedIds.filter(id => id !== drag.id)
    const index = before === null ? ids.length : ids.indexOf(before)
    if (index < 0) return
    ids.splice(index, 0, drag.id)
    if (ids.every((id, i) => id === drag.expectedIds[i])) return
    setBusy(true)
    setMessage('')
    let failure: unknown
    try {
      await reorderSquads(drag.expectedIds, ids)
    } catch (error) { failure = error }
    try {
      // GET also reconciles membership changes and a committed PUT whose reply was lost.
      const key = ['old-squads']
      await client.cancelQueries({queryKey: key})
      const latest = await client.fetchQuery({queryKey: key, queryFn: listSquads, staleTime: 0})
      void client.invalidateQueries({queryKey: SQUADS_KEY})
      const matches = latest.squads.length === ids.length && latest.squads.every((s, i) => s.id === ids[i])
      if (isApiError(failure) && failure.status === 409) setMessage(words.orderConflict)
      else if (failure && !(isApiError(failure) && failure.status === NO_ANSWER && matches)) setMessage(failureText(failure, locale))
      else setMessage(matches ? words.orderSaved : words.orderConflict)
    } catch (error) {
      setMessage(words.orderUnverified + ' ' + failureText(error, locale))
      void client.invalidateQueries({queryKey:['old-squads']})
    } finally { setBusy(false) }
  }
  function props(id: string) {
    return {
      draggable: enabled && !busy,
      onDragStart(event: DragEvent) {
        if (!enabled || busy) { event.preventDefault(); return }
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', id)
        setDrag({id, expectedIds:squads.map(s => s.id)})
        setMessage('')
      },
      onDragOver(event: DragEvent) {
        if (!drag || !enabled) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setOver(id)
      },
      onDragEnd: end,
      onDrop(event: DragEvent) {
        event.preventDefault()
        if (drag) void drop(id)
      },
    }
  }
  return {drag, over, busy, message, drop, props}
}
