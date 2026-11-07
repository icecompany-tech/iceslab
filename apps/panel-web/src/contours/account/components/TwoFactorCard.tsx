import { useState } from 'react'
import styles from '@/contours/account/components/account.module.css'
import { DICT } from '@/contours/account/dict'
import { use2faStatus, useDisable2fa, useEnable2fa, useSetup2fa, type TotpSetup } from '@/contours/account/hooks/useAccount'
import { isTotpRefusal } from '@/contours/account/lib/totpRefusal'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Button } from '@/ui/Button/Button'
import { Command } from '@/ui/Command/Command'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Field, Input } from '@/ui/Field/Field'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { useToast } from '@/ui/Toast/useToast'

/** A wrong code is said at the field, 2FA stays as it was, the secret does not change. */
export function TwoFactorCard() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const status = use2faStatus()
  const setup = useSetup2fa()
  const enable = useEnable2fa()
  const disable = useDisable2fa()
  const [pending, setPending] = useState<TotpSetup | null>(null)
  const [code, setCode] = useState('')
  const [wrong, setWrong] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const codeOk = /^\d{6}$/.test(code)
  const editCode = (value: string) => {
    setCode(value.replace(/\D/g, ''))
    setWrong(false)
    setFailure(null)
  }
  const onRefused = (err: unknown) => {
    if (isTotpRefusal(err)) setWrong(true)
    else setFailure(failureText(err, locale))
  }
  const start = () =>
    setup.mutate(undefined, {
      onSuccess: (data) => {
        setPending(data)
        editCode('')
      },
      onError: (err) => setFailure(failureText(err, locale)),
    })
  const confirmEnable = () =>
    enable.mutate(code, {
      onSuccess: () => {
        setPending(null)
        editCode('')
        toast.show(words.enabledNotice)
      },
      onError: onRefused,
    })
  const confirmDisable = () =>
    disable.mutate(code, {
      onSuccess: () => {
        setAsking(false)
        editCode('')
        toast.show(words.disabledNotice)
      },
      onError: (err) => {
        setAsking(false)
        onRefused(err)
      },
    })
  const codeField = <Field label={words.codeLabel} error={wrong ? words.codeWrong : undefined}>{(a11y) => <Input {...a11y} inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => editCode(e.target.value)} />}</Field>
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{words.twofaTitle}</h2>
        {status.data && <span className={status.data.enabled ? styles.ok : styles.amber}>{status.data.enabled ? words.twofaOn : words.twofaOff}</span>}
      </div>
      <p className={styles.note}>{words.twofaHint}</p>
      {status.isPending && <QueryLoading label={words.loading} />}
      {/* «Off» without the status is a claim about the account: the error and a retry instead. */}
      {status.isError && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void status.refetch()}>
          {`${words.twofaFailed}: ${failureText(status.error, locale)}`}
        </QueryFailedLine>
      )}
      {status.data?.enabled === true && (
        <>
          {codeField}
          <div>
            <Button variant="danger" disabled={!codeOk} onClick={() => setAsking(true)}>
              {words.twofaDisable}
            </Button>
          </div>
        </>
      )}
      {status.data?.enabled === false && !pending && (
        <div>
          <Button loading={setup.isPending} onClick={start}>
            {words.twofaEnable}
          </Button>
        </div>
      )}
      {status.data?.enabled === false && pending && (
        <>
          <p className={styles.note}>{words.scanHint}</p>
          <span className={styles.note}>{words.secretLabel}</span>
          <Command text={pending.secret} copyLabel={words.copy} copiedLabel={words.copied} />
          <span className={styles.note}>{words.uriLabel}</span>
          <Command text={pending.uri} copyLabel={words.copy} copiedLabel={words.copied} />
          {codeField}
          <div className={styles.actions}>
            <Button onClick={() => setPending(null)}>{words.cancel}</Button>
            <Button variant="primary" loading={enable.isPending} disabled={!codeOk} onClick={confirmEnable}>
              {words.twofaConfirm}
            </Button>
          </div>
        </>
      )}
      {failure && <p className={styles.danger}>{failure}</p>}
      {asking && (
        <Confirm title={words.disableTitle} labels={{ confirm: words.twofaDisable, cancel: words.cancel }} tone="danger" state={{ busy: disable.isPending, error: null }} onConfirm={confirmDisable} onClose={() => setAsking(false)}>
          <p>{words.disableBody}</p>
        </Confirm>
      )}
    </section>
  )
}
