import { DELETED_USER_RETENTION_DAYS } from '@iceslab/shared'
import { useState } from 'react'
import { DICT } from '@/contours/users/dict'
import { useDeleteUser, useUpdateUser, useUserAction } from '@/contours/users/hooks/useUsers'
import { daysBetween, extendFrom, termLeft } from '@/contours/users/lib/term'
import type { User } from '@/contours/users/lib/users'
import { useNow } from '@/lib/clock'
import { fmtDateTime, fmtDuration } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Button } from '@/ui/Button/Button'
import { LazyDateTimeField } from '@/ui/DateTimeField/LazyDateTimeField'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Dialog } from '@/ui/Dialog/Dialog'
import styles from '@/contours/users/components/users.module.css'
import { Field, Input } from '@/ui/Field/Field'
import { useToast } from '@/ui/Toast/useToast'

export type DialogKind = 'extend' | 'disable' | 'reset' | 'rotate' | 'revoke' | 'reissue' | 'remove'

export interface UserDialog {
  kind: DialogKind
  user: User
}

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

function ExtendDialog({ user, expireAt, onClose }: { user: User; expireAt: string; onClose: () => void }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const toast = useToast()
  const update = useUpdateUser(user.id)
  const start = now()
  const [next, setNext] = useState(() => extendFrom(expireAt, 30, start))
  const expired = Date.parse(expireAt) < start
  const from = new Date(Math.max(Date.parse(expireAt), start)).toISOString()
  const days = daysBetween(from, next)
  const left = termLeft(expireAt, start)
  const zero = Date.parse(next) <= Date.parse(from)
  return (
    <Dialog
      title={words.extendTitle(user.username)}
      closeLabel={words.close}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{words.cancel}</Button>
          <Button
            variant="primary"
            loading={update.isPending}
            disabled={zero}
            onClick={() =>
              update.mutate(
                { expireAt: next },
                {
                  onSuccess: () => {
                    toast.show(words.extended(user.username))
                    onClose()
                  },
                },
              )
            }
          >
            {words.extend}
          </Button>
        </>
      }
    >
      <div className={styles.extendNow}>
        <span>{words.extendNow}</span>
        <b>
          {fmtDateTime(expireAt, locale)}, {expired ? words.extendExpired(fmtDuration((start - Date.parse(expireAt)) / 1000, locale)) : words.extendLeft(`${left.days} ${words.daysUnit}`)}
        </b>
      </div>
      <div className={styles.extendFields}>
        <Field label={words.extendDays} error={zero ? words.extendZero : undefined}>
          {(a11y) => <Input {...a11y} inputMode="numeric" value={Number.isNaN(days) ? '' : String(days)} onChange={(e) => {
            const n = Number(e.target.value)
            setNext(extendFrom(expireAt, Number.isFinite(n) && n > 0 ? n : 0, start))
          }} />}
        </Field>
        <LazyDateTimeField label={words.extendNew} locale={locale} value={next} timeZone={TIME_ZONE} onChange={(v) => v && setNext(v)} texts={{ open: words.calendarOpen, previousMonth: words.calendarPrev, nextMonth: words.calendarNext }} />
      </div>
      <p className={styles.extendNote}>{expired ? words.extendNoteExpired : words.extendNote}</p>
      {update.isError && <div role="alert" className={styles.formError}>{failureText(update.error, locale)}</div>}
    </Dialog>
  )
}

function ConfirmAction({ dialog, onClose, onDone }: { dialog: UserDialog; onClose: () => void; onDone?: (kind: DialogKind) => void }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const { user, kind } = dialog
  const update = useUpdateUser(user.id)
  const action = useUserAction()
  const remove = useDeleteUser()
  const name = user.username
  const done = (message: string) => () => {
    toast.show(message)
    onDone?.(kind)
    onClose()
  }
  const run = () => {
    switch (kind) {
      case 'disable':
        update.mutate({ status: 'disabled' }, { onSuccess: done(words.disabled(name)) })
        return
      case 'reset':
        action.mutate({ user, action: 'reset-traffic' }, { onSuccess: done(words.resetDone(name)) })
        return
      case 'rotate':
        action.mutate({ user, action: 'rotate-subscription' }, { onSuccess: done(words.rotateDone(name)) })
        return
      case 'revoke':
        action.mutate({ user, action: 'revoke' }, { onSuccess: done(words.revokeDone(name)) })
        return
      case 'reissue':
        action.mutate({ user, action: 'reissue-credentials' }, { onSuccess: done(words.reissueDone(name)) })
        return
      case 'remove':
        remove.mutate(user.id, { onSuccess: done(words.removeDone(name)) })
        return
      case 'extend':
        return
    }
  }
  const text = (): { title: string; body: string; label: string; tone: 'danger' | 'warn' } => {
    switch (kind) {
      case 'disable':
        return { title: words.disableTitle(name), body: words.disableBody, label: words.disable, tone: 'warn' }
      case 'reset':
        return { title: words.resetTitle(name), body: words.resetBody, label: words.dangerResetAction, tone: 'warn' }
      case 'rotate':
        return { title: words.rotateTitle(name), body: words.rotateBody, label: words.dangerReissueAction, tone: 'danger' }
      case 'revoke':
        return { title: words.revokeTitle(name), body: words.revokeBody, label: words.dangerRevokeAction, tone: 'danger' }
      case 'reissue':
        return { title: words.reissueTitle(name), body: words.reissueBody, label: words.dangerReissueAction, tone: 'danger' }
      case 'remove':
        return { title: words.removeTitle(name), body: words.removeBody(DELETED_USER_RETENTION_DAYS), label: words.dangerRemoveAction, tone: 'danger' }
      case 'extend':
        return { title: '', body: '', label: '', tone: 'warn' }
    }
  }
  const t = text()
  const failed = update.error ?? action.error ?? remove.error
  return (
    <Confirm title={t.title} labels={{ confirm: t.label, cancel: words.cancel }} tone={t.tone} state={{ busy: update.isPending || action.isPending || remove.isPending, error: failed ? failureText(failed, locale) : null }} onConfirm={run} onClose={onClose}>
      {t.body}
    </Confirm>
  )
}

export function ActionDialog({ dialog, onClose, onDone }: { dialog: UserDialog; onClose: () => void; onDone?: (kind: DialogKind) => void }) {
  if (dialog.kind === 'extend') {
    return dialog.user.expireAt ? <ExtendDialog user={dialog.user} expireAt={dialog.user.expireAt} onClose={onClose} /> : null
  }
  return <ConfirmAction dialog={dialog} onClose={onClose} onDone={onDone} />
}
