import { DELETED_USER_RETENTION_DAYS } from '@iceslab/shared'
import { useState } from 'react'
import { ActionDialog, type DialogKind } from '@/contours/users/components/ActionDialogs'
import { ClientBlock, DevicesBlock, SubscriptionBlock } from '@/contours/users/components/UserBlocks'
import { AdvancedFields, SquadField, TermField, TrafficField } from '@/contours/users/components/UserFields'
import styles from '@/contours/users/components/users.module.css'
import { DICT } from '@/contours/users/dict'
import { useUpdateUser } from '@/contours/users/hooks/useUsers'
import { readSaveRefusal, type SaveRefusal } from '@/contours/users/lib/refusal'
import { deviceLimitValid, draftOfUser, limitError, updateBody, type UserDraft } from '@/contours/users/lib/userBody'
import { accessOutcome, subscriptionUrl, type User } from '@/contours/users/lib/users'
import { widenedBy } from '@/contours/users/lib/widen'
import { useNow } from '@/lib/clock'
import type { NodeRow } from '@/lib/domain/nodes'
import type { Squad } from '@/lib/domain/squads'
import { fmtBytes } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Icon, type IconName } from '@/ui/Icon/Icon'
import { useToast } from '@/ui/Toast/useToast'

interface WindowProps {
  user: User
  squads: readonly Squad[]
  squadsFailed: boolean
  nodes: ReadonlyMap<string, NodeRow>
  panel: TablePanel
  onClose: () => void
}

type TablePanel = { publicUrl?: string | null; subscriptionPathPrefix?: string | null } | undefined

function DangerRow({ title, body, action, icon, tone, onClick }: { title: string; body: string; action: string; icon: IconName; tone: 'warn' | 'danger'; onClick: () => void }) {
  return (
    <div className={styles.dangerRow}>
      <div>
        <div className={styles.dangerTitle}>{title}</div>
        <div className={styles.dangerBody}>{body}</div>
      </div>
      <Button variant={tone} icon={<Icon name={icon} size="md" />} onClick={onClick}>
        {action}
      </Button>
    </div>
  )
}

export function UserWindow({ user, squads, squadsFailed, nodes, panel, onClose }: WindowProps) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const toast = useToast()
  const update = useUpdateUser(user.id)
  const [initial] = useState<UserDraft>(() => draftOfUser(user))
  const [draft, setDraft] = useState<UserDraft>(initial)
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null)
  const [advanced, setAdvanced] = useState(true)
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [widenAsk, setWidenAsk] = useState<{ empty: Squad; narrowed: Squad[] } | null>(null)
  const patch = (next: Partial<UserDraft>) => {
    setDraft((d) => ({ ...d, ...next }))
    setRefusal(null)
  }

  const limitTouched = draft.limitText !== initial.limitText || draft.limitUnit !== initial.limitUnit || draft.unlimited !== initial.unlimited
  const invalid = limitError(draft, limitTouched, words.limitBad) !== undefined || !deviceLimitValid(draft.deviceLimit)
  const body = updateBody(initial, draft)
  const changed = Object.keys(body).length > 0
  const errors = refusal?.fields ?? {}
  const outcome = accessOutcome(draft.status, { expireAt: draft.noExpiry ? null : draft.expireAt, limitBytes: draft.unlimited ? null : user.trafficLimitBytes, usedBytes: user.trafficUsedBytes }, now())
  const accessNote = draft.status === 'disabled' ? (initial.status === 'disabled' ? null : words.accessOffNote) : outcome === 'expired' ? words.accessExpiredNote : outcome === 'limited' ? words.accessLimitedNote : null

  const save = () => {
    update.mutate(body, {
      onSuccess: () => {
        toast.show(words.saved(user.username))
        onClose()
      },
      onError: (err) => {
        const read = readSaveRefusal(err)
        if (read) setRefusal(read)
        else toast.show(failureText(err, locale), 'failed')
      },
    })
  }
  const submit = () => {
    const widen = widenedBy(initial.groupIds, draft.groupIds, squads)
    if (widen) setWidenAsk(widen)
    else save()
  }

  return (
    <Dialog
      size="window"
      title={user.username}
      closeLabel={words.close}
      onClose={onClose}
      footer={
        <>
          <span className={styles.footNote}>{refusal?.message ?? words.saveNote}</span>
          <Button onClick={onClose}>{words.cancel}</Button>
          <Button variant="primary" loading={update.isPending} disabled={!changed || invalid} icon={<Icon name="check" size="md" />} onClick={submit}>
            {words.save}
          </Button>
        </>
      }
    >
      <div className={styles.windowColumns}>
        <div className={styles.windowLeft}>
          <div className={styles.group}>
            <span className={styles.groupLabel}>{words.access}</span>
            <div className={styles.accessRow}>
              <Chip label={words.accessOn} active={draft.status === 'active'} onClick={() => patch({ status: 'active' })} />
              <Chip label={words.accessOff} active={draft.status === 'disabled'} onClick={() => patch({ status: 'disabled' })} />
            </div>
            {accessNote && <div className={styles.amberNote}>{accessNote}</div>}
          </div>
          <SquadField squads={squads} value={draft.groupIds} failed={squadsFailed} error={errors.groups} onChange={(groupIds) => patch({ groupIds })} />
          <TrafficField draft={draft} onChange={patch} errors={errors} limitTouched={limitTouched} storedLimit={user.trafficLimitBytes === null ? undefined : fmtBytes(user.trafficLimitBytes, locale)} />
          <TermField draft={draft} onChange={patch} errors={errors} limitTouched={limitTouched} leftLabel />
          <DevicesBlock user={user} />
          <SubscriptionBlock user={user} url={subscriptionUrl(user.subscriptionToken, panel)} onRevoke={() => setDialog('revoke')} />
        </div>
        <div className={styles.windowRight}>
          <ClientBlock user={user} nodes={nodes} squads={squads} />
        </div>
      </div>
      <section className={styles.block}>
        <div className={styles.blockHead}>
          <button type="button" className={styles.advancedToggle} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            <Icon name={advanced ? 'chevronDown' : 'chevronRight'} size="md" />
            {words.advanced}
          </button>
          <span className={styles.blockAside}>{advanced ? words.hide : words.advancedHintEdit}</span>
        </div>
        {advanced && <AdvancedFields draft={draft} onChange={patch} errors={errors} />}
      </section>
      <section className={styles.block}>
        <h3 className={styles.blockTitle}>
          <span className={styles.danger}>
            <Icon name="warn" size="lg" />
          </span>
          {words.danger}
        </h3>
        <DangerRow title={words.dangerReset} body={words.dangerResetBody} action={words.dangerResetAction} icon="rotateLeft" tone="warn" onClick={() => setDialog('reset')} />
        <DangerRow title={words.dangerRevoke} body={words.dangerRevokeBody} action={words.dangerRevokeAction} icon="ban" tone="danger" onClick={() => setDialog('revoke')} />
        <DangerRow title={words.dangerReissue} body={words.dangerReissueBody} action={words.dangerReissueAction} icon="key" tone="danger" onClick={() => setDialog('reissue')} />
        <DangerRow title={words.dangerRemove} body={words.dangerRemoveBody(DELETED_USER_RETENTION_DAYS)} action={words.dangerRemoveAction} icon="trash" tone="danger" onClick={() => setDialog('remove')} />
      </section>
      {dialog && (
        <ActionDialog
          dialog={{ kind: dialog, user }}
          onClose={() => setDialog(null)}
          onDone={(kind) => {
            if (kind === 'remove') onClose()
          }}
        />
      )}
      {widenAsk && (
        <Confirm
          title={words.emptySquadWidenTitle}
          labels={{ confirm: words.saveAnyway, cancel: words.cancel }}
          tone="warn"
          onClose={() => setWidenAsk(null)}
          onConfirm={() => {
            setWidenAsk(null)
            save()
          }}
        >
          {words.emptySquadWiden(widenAsk.empty.name, widenAsk.narrowed.map((s) => s.name).join(', '))}
        </Confirm>
      )}
    </Dialog>
  )
}
