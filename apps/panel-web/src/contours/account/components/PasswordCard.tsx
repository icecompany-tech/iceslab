import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from '@/contours/account/components/account.module.css'
import { DICT } from '@/contours/account/dict'
import { use2faStatus, useChangePassword } from '@/contours/account/hooks/useAccount'
import { passwordBody, passwordFormProblems, passwordRefusal, type PasswordField, type PasswordForm, type PasswordRefusal } from '@/contours/account/lib/passwordChange'
import { OFFER_KEY } from '@/contours/account/lib/revokeOffer'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { writeStored } from '@/lib/storage'
import { Button } from '@/ui/Button/Button'
import { Field, Input, PasswordInput } from '@/ui/Field/Field'

const EMPTY: PasswordForm = { current: '', next: '', repeat: '', totp: '' }
const SECONDS_IN_MINUTE = 60

/**
 * F-3, A-039. A change ends every session of this admin, this one too, so the offer to revoke
 * tokens waits for the sign-in that follows: the token list cannot be read before it.
 */
export function PasswordCard() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const navigate = useNavigate()
  const client = useQueryClient()
  const status = use2faStatus()
  const change = useChangePassword()
  const twofaOn = status.data?.enabled ?? false
  const [form, setForm] = useState<PasswordForm>(EMPTY)
  const [tried, setTried] = useState(false)
  const [refusal, setRefusal] = useState<PasswordRefusal | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const problems = passwordFormProblems(form, twofaOn)
  const edit = (field: keyof PasswordForm, value: string) => {
    setFailure(null)
    setForm((f) => ({ ...f, [field]: field === 'totp' ? value.replace(/\D/g, '') : value }))
    setRefusal((r) => (r && (r.field === field || r.field === 'form') ? null : r))
  }
  const errorOf = (field: PasswordField): string | undefined => {
    if (refusal?.field === field) return words.passwordProblem[refusal.problem]
    const problem = tried ? problems[field] : undefined
    return problem ? words.passwordProblem[problem] : undefined
  }
  const submit = () => {
    setTried(true)
    setRefusal(null)
    setFailure(null)
    if (Object.keys(problems).length > 0) return
    change.mutate(passwordBody(form, twofaOn), {
      onSuccess: () => {
        writeStored(OFFER_KEY, true)
        client.clear()
        void navigate('/login', { replace: true, state: { notice: 'passwordChanged', from: '/account' } })
      },
      onError: (err) => {
        const read = passwordRefusal(err)
        if (read) setRefusal(read)
        else setFailure(failureText(err, locale))
      },
    })
  }
  const secret = { showLabel: words.show, hideLabel: words.hide }
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{words.passwordTitle}</h2>
      <p className={styles.note}>{words.passwordHint}</p>
      <Field label={words.current} error={errorOf('current')}>{(a11y) => <PasswordInput {...a11y} {...secret} autoComplete="current-password" value={form.current} onChange={(e) => edit('current', e.target.value)} />}</Field>
      <Field label={words.next} hint={words.nextHint} error={errorOf('next')}>{(a11y) => <PasswordInput {...a11y} {...secret} autoComplete="new-password" value={form.next} onChange={(e) => edit('next', e.target.value)} />}</Field>
      <Field label={words.repeat} error={errorOf('repeat')}>{(a11y) => <PasswordInput {...a11y} {...secret} autoComplete="new-password" value={form.repeat} onChange={(e) => edit('repeat', e.target.value)} />}</Field>
      {twofaOn && <Field label={words.codeLabel} error={errorOf('totp')}>{(a11y) => <Input {...a11y} inputMode="numeric" maxLength={6} value={form.totp} onChange={(e) => edit('totp', e.target.value)} />}</Field>}
      {refusal?.field === 'form' && <p className={styles.danger}>{refusal.retryAfterSeconds ? words.lockedFor(Math.ceil(refusal.retryAfterSeconds / SECONDS_IN_MINUTE)) : words.passwordProblem[refusal.problem]}</p>}
      {failure && <p className={styles.danger}>{failure}</p>}
      <p className={styles.note}>{words.signOutHint}</p>
      <p className={styles.note}>{words.tokensKeptHint}</p>
      <div>
        {/* Without the 2FA status the form cannot know whether to ask for a code: it waits. */}
        <Button variant="primary" loading={change.isPending} disabled={!status.data} onClick={submit}>
          {words.passwordSave}
        </Button>
      </div>
    </section>
  )
}
