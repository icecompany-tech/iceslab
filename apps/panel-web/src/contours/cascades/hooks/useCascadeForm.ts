import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateCascade, useEntryFacts, useOutbounds, useRoutePolicies, useUpdateCascade } from '@/contours/cascades/hooks/useCascades'
import { cascadeCreateBody, cascadeUpdateBody, isUntouched } from '@/contours/cascades/lib/cascadeBody'
import { entryProtocolDefault, entryQuestionRepeats, type DirectionDraft, type EntryChangeRefusal, type EntryNodesDropped, type PositionDraft } from '@/contours/cascades/lib/cascadeForm'
import { allNodeIds, draftOfCascade, firstBlocker, newDraft, type CascadeDraft } from '@/contours/cascades/lib/draft'
import { readRefusal, type SaveRefusal } from '@/contours/cascades/lib/refusal'
import { DICT } from '@/contours/cascades/dict'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { cascadeClaims } from '@/lib/old/cascadeMembership'
import type { Cascade } from '@/lib/old/cascades'
import { directionOutbounds } from '@/lib/old/namedOutbounds'
import { listFieldKnown } from '@/lib/old/nodeFields'
import type { Node } from '@/lib/old/nodes'
import { useToast } from '@/ui/Toast/useToast'

export type StepId = 'entry' | 'transit' | 'exit' | 'link' | 'subscription'
export type EntryAsk = { kind: 'entryChange'; asked: EntryChangeRefusal } | { kind: 'entryNodes'; groups: EntryNodesDropped[] }

const STEP_OF: Partial<Record<SaveRefusal['kind'], StepId>> = { entryChain: 'entry', policyGone: 'entry', direction: 'exit', tags: 'exit', cells: 'link', ports: 'link', underlay: 'link' }

export interface CascadeFormInput {
  cascade: Cascade | null
  cascades: readonly Cascade[]
  fields: unknown
  nodes: readonly Node[]
}

/** One place for the form's state and what its steps read: each step takes this and names no list of its own. */
export function useCascadeForm({ cascade, cascades, fields, nodes }: CascadeFormInput) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const navigate = useNavigate()
  const create = useCreateCascade()
  const update = useUpdateCascade(cascade?.id ?? '')
  const outbounds = useOutbounds()
  const policies = useRoutePolicies()

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const claimedBy = useMemo(() => cascadeClaims([...cascades], cascade?.id), [cascades, cascade?.id])
  const entryPolicyKnown = listFieldKnown(fields, cascades, 'entryPolicy')
  const directionRows = useMemo(() => cascades.flatMap((c) => c.directions), [cascades])
  const legCellKnown = cascade === null || listFieldKnown(fields, directionRows, 'linkProtocol', 'directions[].linkProtocol')
  const outboundKnown = cascade === null || listFieldKnown(fields, directionRows, 'outboundId', 'directions[].outboundId')

  const [initial, setInitial] = useState<CascadeDraft>(() => (cascade ? draftOfCascade(cascade, nodeById, entryPolicyKnown) : newDraft(entryPolicyKnown)))
  const [draft, setDraft] = useState<CascadeDraft>(initial)
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [ask, setAsk] = useState<EntryAsk | null>(null)
  const [open, setOpen] = useState<StepId | null>(cascade ? null : 'entry')
  const consented = useRef<Set<string>>(new Set())

  const clear = () => {
    setRefusal(null)
    setFailure(null)
  }
  const patch = (next: Partial<CascadeDraft>) => {
    clear()
    setDraft((d) => ({ ...d, ...next }))
  }
  const setPool = (index: number, next: Partial<PositionDraft>) => {
    clear()
    setDraft((d) => ({ ...d, pools: d.pools.map((p, i) => (i === index ? { ...p, ...next } : p)) }))
  }
  /** The first entry node sets the protocol too: it has to be a core the node runs. It stays editable. */
  const setPoolNodes = (index: number, ids: string[]) => {
    const first = ids.find(Boolean)
    const node = first ? nodeById.get(first) : undefined
    const guess = index === 0 && node ? entryProtocolDefault(node) : null
    setPool(index, { nodeIds: ids, ...(guess?.kind === 'protocol' ? { entryProtocol: guess.protocol } : {}) })
  }
  const setDirection = (index: number, next: Partial<DirectionDraft>) => {
    clear()
    setDraft((d) => ({ ...d, directions: d.directions.map((x, i) => (i === index ? { ...x, ...next } : x)) }))
  }

  const usedIds = allNodeIds(draft)
  const othersThan = (mine: readonly string[]) => {
    const spent = [...usedIds]
    for (const id of mine) {
      const at = spent.indexOf(id)
      if (at >= 0) spent.splice(at, 1)
    }
    return spent
  }
  const nodeName = (id: string) => nodeById.get(id)?.name ?? '?'
  const blocker = firstBlocker(draft, nodeName)
  const body = cascade ? cascadeUpdateBody(initial, draft) : null
  const untouched = body !== null && isUntouched(body)
  const saving = create.isPending || update.isPending

  const entryIds = useMemo(() => draft.pools[0]?.nodeIds.filter(Boolean) ?? [], [draft.pools])
  const entry = useEntryFacts(draft.pools[0]?.entryProtocol, entryIds, nodeById)

  const onRefused = (err: unknown, withConsent: boolean) => {
    const read = readRefusal(err)
    if (read === null) {
      setFailure(failureText(err, locale))
      return
    }
    if (read.kind === 'entryChange' || read.kind === 'entryNodes') {
      const code = read.kind === 'entryChange' ? 'ENTRY_CHANGE_DROPS_USERS' : 'ENTRY_NODES_DROPPED'
      if (entryQuestionRepeats(code, consented.current, withConsent)) setFailure(words.questionRepeated)
      else setAsk(read)
      return
    }
    setRefusal(read)
    const step = STEP_OF[read.kind]
    if (step) setOpen(step)
  }

  const sendUpdate = (confirmed: boolean) => {
    update.mutate(cascadeUpdateBody(initial, draft, confirmed), {
      onSuccess: (saved) => {
        const next = draftOfCascade(saved, nodeById, entryPolicyKnown)
        setInitial(next)
        setDraft(next)
        toast.show(words.saved)
      },
      onError: (err) => onRefused(err, confirmed),
    })
  }

  const save = () => {
    clear()
    consented.current.clear()
    if (!cascade) {
      create.mutate(cascadeCreateBody(draft), {
        onSuccess: (saved) => {
          toast.show(words.created)
          void navigate(`/cascades/${saved.id}`, { replace: true })
        },
        onError: (err) => onRefused(err, false),
      })
      return
    }
    sendUpdate(false)
  }

  /** A consent lives for one request; the chain of questions restarts with every press of Save. */
  const agree = () => {
    if (!ask) return
    consented.current.add(ask.kind === 'entryChange' ? 'ENTRY_CHANGE_DROPS_USERS' : 'ENTRY_NODES_DROPPED')
    setAsk(null)
    sendUpdate(true)
  }

  return {
    cascade,
    draft,
    initial,
    patch,
    setPool,
    setPoolNodes,
    setDirection,
    nodes,
    nodeById,
    claimedBy,
    othersThan,
    nodeName,
    usedIds,
    entryIds,
    entry,
    entryPolicyKnown,
    legCellKnown,
    outboundKnown,
    outbounds,
    outboundOptions: directionOutbounds(outbounds.data?.outbounds),
    policies,
    refusal,
    failure,
    ask,
    dismissAsk: () => setAsk(null),
    agree,
    open,
    toggleStep: (step: StepId) => setOpen((now) => (now === step ? null : step)),
    blocker,
    untouched,
    saving,
    save,
  }
}

export type CascadeForm = ReturnType<typeof useCascadeForm>
