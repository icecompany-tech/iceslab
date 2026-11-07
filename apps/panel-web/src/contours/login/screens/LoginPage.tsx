import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AuthFrame } from '@/contours/login/components/AuthFrame'
import styles from '@/contours/login/screens/LoginPage.module.css'
import { NoAdminCard } from '@/contours/login/components/NoAdminCard'
import { DICT } from '@/contours/login/dict'
import { useAuthStatus, useSignIn } from '@/contours/login/hooks/useAuthStatus'
import { readRefusal } from '@/contours/login/lib/refusal'
import { readLoginNotice, safeReturnPath } from '@/lib/auth/session'
import { useBrandName } from '@/lib/domain/brand'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { AuthCard } from '@/ui/AuthCard/AuthCard'
import { AuthNotice } from '@/ui/AuthNotice/AuthNotice'
import { Button } from '@/ui/Button/Button'
import { CODE_LENGTH, CodeInput } from '@/ui/CodeInput/CodeInput'
import { Field, Input, PasswordInput } from '@/ui/Field/Field'
import { QueryLoading } from '@/ui/QueryState/QueryState'

type Failure = { place: 'password' | 'code'; text: string; tone: 'error' | 'warning' } | null

export default function LoginPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const brand = useBrandName()
  const navigate = useNavigate()
  const location = useLocation()
  const status = useAuthStatus()
  const signIn = useSignIn()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [failure, setFailure] = useState<Failure>(null)
  const [lockSeconds, setLockSeconds] = useState(0)

  useEffect(() => {
    if (lockSeconds <= 0) return
    const timer = setTimeout(() => {
      setLockSeconds((s) => s - 1)
      if (lockSeconds === 1) setFailure(null)
    }, 1000)
    return () => clearTimeout(timer)
  }, [lockSeconds])

  const notice = readLoginNotice(location.state)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    signIn.mutate(
      { username, password, totpCode: step === 'code' ? code : undefined },
      {
        onSuccess: () => void navigate(safeReturnPath(location.state), { replace: true }),
        onError: (err) => {
          const refusal = readRefusal(err)
          switch (refusal.kind) {
            case 'needCode':
              setStep('code')
              return
            case 'credentials':
              setStep('password')
              setFailure({ place: 'password', text: words.badCredentials, tone: 'error' })
              return
            case 'badCode':
              setFailure({ place: 'code', text: words.badCode, tone: 'error' })
              return
            case 'locked':
              setLockSeconds(refusal.seconds)
              setStep('password')
              setFailure({ place: 'password', text: words.lockedNote, tone: 'warning' })
              return
            case 'other':
              setFailure({ place: step, text: failureText(refusal.err, locale), tone: 'error' })
              return
          }
        },
      },
    )
  }

  if (status.isPending) {
    return (
      <AuthFrame>
        <QueryLoading label={words.checking} />
      </AuthFrame>
    )
  }

  if (status.isError) {
    return (
      <AuthFrame>
        <AuthCard title={words.serverDownTitle} subtitle={words.serverDownBody}>
          <Button size="md" wide onClick={() => void status.refetch()}>
            {words.retry}
          </Button>
        </AuthCard>
      </AuthFrame>
    )
  }

  if (status.data.registration.enabled) {
    return (
      <AuthFrame>
        <NoAdminCard onDone={() => void status.refetch()} />
      </AuthFrame>
    )
  }

  if (step === 'code') {
    const codeError = failure?.place === 'code' ? failure.text : undefined
    return (
      <AuthFrame>
        <AuthCard title={words.codeTitle} subtitle={words.codeBody(username)}>
          <form className={styles.form} onSubmit={submit}>
            <div className={styles.code}>
              <CodeInput label={words.codeLabel} value={code} onChange={setCode} invalid={codeError !== undefined} />
              {codeError && (
                <div role="alert" className={styles.codeError}>
                  {codeError}
                </div>
              )}
            </div>
            <Button type="submit" variant="primary" size="md" wide loading={signIn.isPending} disabled={code.length !== CODE_LENGTH}>
              {words.confirm}
            </Button>
          </form>
          <button
            type="button"
            className={styles.back}
            onClick={() => {
              setStep('password')
              setCode('')
              setFailure(null)
            }}
          >
            {words.back}
          </button>
        </AuthCard>
      </AuthFrame>
    )
  }

  const locked = lockSeconds > 0
  const passwordFailure = failure?.place === 'password' ? failure : null
  return (
    <AuthFrame>
      <AuthCard title={words.title(brand)} notice={notice && <AuthNotice tone={notice === 'logoutUnconfirmed' ? 'warn' : 'info'}>{words.notice[notice]}</AuthNotice>}>
        <form className={styles.form} onSubmit={submit}>
          <Field label={words.username}>{(a11y) => <Input {...a11y} name="username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />}</Field>
          <Field label={words.password} error={passwordFailure?.tone === 'error' ? passwordFailure.text : undefined} warning={passwordFailure?.tone === 'warning' ? passwordFailure.text : undefined}>
            {(a11y) => <PasswordInput {...a11y} name="password" autoComplete="current-password" showLabel={words.show} hideLabel={words.hide} value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" size="md" wide loading={signIn.isPending} disabled={locked || username === '' || password === ''}>
            {locked ? words.locked(lockSeconds) : words.submit}
          </Button>
        </form>
      </AuthCard>
    </AuthFrame>
  )
}
