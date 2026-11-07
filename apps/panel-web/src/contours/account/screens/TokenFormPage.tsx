import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styles from '@/contours/account/components/account.module.css'
import { DICT } from '@/contours/account/dict'
import { useCreateToken } from '@/contours/account/hooks/useAccount'
import { BOT_SCOPES, FULL, RESOURCES, scopesOf, SUB_READ, togglePicked, tokenBody, type TokenSet } from '@/contours/account/lib/tokenBody'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Check } from '@/ui/Check/Check'
import { Command } from '@/ui/Command/Command'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Field, Input } from '@/ui/Field/Field'
import { RadioRow } from '@/ui/RadioRow/RadioRow'

/** What the server grants today: a section whole, read or write. No per-request switches and no «Monitoring» until S3 (Б3). */
export default function TokenFormPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const navigate = useNavigate()
  const create = useCreateToken()
  const [name, setName] = useState('')
  const [set, setSet] = useState<TokenSet>('bot')
  const [picked, setPicked] = useState<readonly string[]>(BOT_SCOPES)
  const [failure, setFailure] = useState<string | null>(null)
  const [issued, setIssued] = useState<string | null>(null)
  const scopes = scopesOf({ set, picked })
  const body = tokenBody({ name, set, picked })
  const send = () => {
    if (!body) return
    setFailure(null)
    create.mutate(body, {
      onSuccess: (token) => setIssued(token.token),
      onError: (err) => setFailure(failureText(err, locale)),
    })
  }
  const tick = (scope: string, label: string) => <Check label={label} checked={picked.includes(scope)} onChange={(on) => setPicked((p) => togglePicked(p, scope, on))} />
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.actions}>
          <Link className={styles.link} to="/account">
            {words.title}
          </Link>
          <h1 className={styles.pageTitle}>{words.newTitle}</h1>
        </div>
        <div className={styles.actions}>
          {name.trim() === '' && <span className={styles.note}>{words.nameRequired}</span>}
          <Button onClick={() => void navigate('/account')}>{words.cancel}</Button>
          <Button variant="primary" loading={create.isPending} disabled={!body} onClick={send}>
            {words.issue}
          </Button>
        </div>
      </div>
      {failure && <Banner tone="danger">{failure}</Banner>}
      <div className={styles.formColumns}>
        <div className={styles.left}>
          <section className={styles.panel}>
            <Field label={words.tokenName} hint={words.tokenNameHint}>{(a11y) => <Input {...a11y} autoFocus maxLength={64} placeholder={words.tokenNamePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          </section>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.setTitle}</h2>
            <RadioRow name="set" title={words.setBot} description={words.setBotHint} checked={set === 'bot'} onSelect={() => setSet('bot')} />
            <RadioRow name="set" title={words.setFull} description={words.setFullHint} checked={set === 'full'} onSelect={() => setSet('full')} />
            <RadioRow name="set" title={words.setManual} description={words.setManualHint} checked={set === 'manual'} onSelect={() => setSet('manual')} />
          </section>
          {set === 'manual' && (
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>{words.resourcesTitle}</h2>
              <p className={styles.note}>{words.resourcesHint}</p>
              <div className={styles.resourceRow}>
                <span>{words.subRead}</span>
                {tick(SUB_READ, `${words.subRead}: ${words.read}`)}
                <span />
              </div>
              {RESOURCES.map((r) => (
                <div key={r} className={styles.resourceRow}>
                  <span>{words.resource[r] ?? r}</span>
                  {tick(`${r}:read`, `${words.resource[r] ?? r}: ${words.read}`)}
                  {tick(`${r}:write`, `${words.resource[r] ?? r}: ${words.write}`)}
                </div>
              ))}
            </section>
          )}
        </div>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{words.resultTitle}</h2>
          {scopes.length === 0 && <p className={styles.amber}>{words.resultNone}</p>}
          {scopes.includes(FULL) && <p className={styles.amber}>{words.resultFull}</p>}
          {scopes.length > 0 && !scopes.includes(FULL) && (
            <>
              <p className={styles.note}>{words.resultCount(scopes.length)}</p>
              <ul className={styles.plainList}>
                {scopes.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
          <p className={styles.note}>{words.resultFixed}</p>
        </section>
      </div>
      {issued && (
        <Dialog title={words.revealTitle} closeLabel={words.close} onClose={() => void navigate('/account')} footer={<Button variant="primary" onClick={() => void navigate('/account')}>{words.revealDone}</Button>}>
          <p>{words.revealBody}</p>
          <Command text={issued} copyLabel={words.copy} copiedLabel={words.copied} />
        </Dialog>
      )}
    </div>
  )
}
