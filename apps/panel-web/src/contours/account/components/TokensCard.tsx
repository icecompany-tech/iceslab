import { useState } from 'react'
import { Link } from 'react-router-dom'
import styles from '@/contours/account/components/account.module.css'
import { DICT } from '@/contours/account/dict'
import { useRevokeAll, useRevokeToken, useTokens } from '@/contours/account/hooks/useAccount'
import { OFFER_KEY } from '@/contours/account/lib/revokeOffer'
import { isFullToken } from '@/contours/account/lib/tokenBody'
import { fmtDateTime } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { bool } from '@/lib/net/parse'
import type { ApiToken } from '@/lib/old/settings'
import { readStored, writeStored } from '@/lib/storage'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { useToast } from '@/ui/Toast/useToast'

export function TokensCard() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const tokens = useTokens()
  const revoke = useRevokeToken()
  const revokeAll = useRevokeAll()
  const [offer, setOffer] = useState(() => readStored(OFFER_KEY, bool) === true)
  const [asking, setAsking] = useState<ApiToken | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = tokens.data?.tokens ?? []
  const date = (iso: string | null) => (iso ? fmtDateTime(iso, locale) : words.never)
  const closeOffer = () => {
    writeStored(OFFER_KEY, false)
    setOffer(false)
  }
  const copyId = (id: string) => void navigator.clipboard?.writeText(id).then(() => toast.show(words.idCopied))
  const confirm = () => {
    setError(null)
    if (asking === 'all') {
      revokeAll.mutate(
        list.map((t) => t.id),
        {
          onSuccess: (done) => {
            setAsking(null)
            if (done === list.length) {
              closeOffer()
              toast.show(words.revoked)
            } else toast.show(words.offerPartial(done, list.length), 'partial')
          },
        },
      )
      return
    }
    if (asking) {
      revoke.mutate(asking.id, {
        onSuccess: () => {
          setAsking(null)
          toast.show(words.revoked)
        },
        onError: (err) => setError(failureText(err, locale)),
      })
    }
  }
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>{words.tokensTitle}</h2>
          <p className={styles.note}>{words.tokensHint}</p>
        </div>
        <Link className={styles.linkPrimary} to="/account/tokens/new">
          <Icon name="plus" size="md" />
          {words.tokenCreate}
        </Link>
      </div>
      {offer && list.length > 0 && (
        <Banner
          tone="warn"
          title={words.offerTitle}
          action={
            <span className={styles.actions}>
              <Button size="sm" variant="danger" onClick={() => setAsking('all')}>
                {words.offerAll}
              </Button>
              <Button size="sm" onClick={closeOffer}>
                {words.offerKeep}
              </Button>
            </span>
          }
        >
          {words.offerBody}
        </Banner>
      )}
      {tokens.isPending && <QueryLoading label={words.loading} />}
      {/* A list that did not arrive is not «no tokens». */}
      {tokens.isError && <QueryFailed title={words.tokensFailed} body={failureText(tokens.error, locale)} retryLabel={words.retry} onRetry={() => void tokens.refetch()} />}
      {tokens.data && list.length === 0 && (
        <div className={styles.empty}>
          <h3 className={styles.emptyTitle}>{words.tokensEmpty}</h3>
          <p>{words.tokensEmptyBody}</p>
        </div>
      )}
      {list.length > 0 && (
        <div className={styles.tableBox}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{words.colName}</th>
                <th scope="col">{words.colScope}</th>
                <th scope="col">{words.colCreated}</th>
                <th scope="col">{words.colLastUsed}</th>
                <th scope="col">{words.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className={isFullToken(t.scopes) ? styles.amber : undefined} title={isFullToken(t.scopes) ? undefined : t.scopes.join(', ')}>
                    {isFullToken(t.scopes) ? words.scopeFull : words.scopeCount(t.scopes.length)}
                  </td>
                  <td>{date(t.createdAt)}</td>
                  <td>{date(t.lastUsedAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      <Button size="sm" onClick={() => copyId(t.id)}>
                        {words.copyId}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setAsking(t)}>
                        {words.revoke}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {asking && (
        <Confirm
          title={asking === 'all' ? words.offerAllTitle(list.length) : words.revokeTitle(asking.name)}
          labels={{ confirm: asking === 'all' ? words.offerAll : words.revoke, cancel: words.cancel }}
          tone="danger"
          state={{ busy: revoke.isPending || revokeAll.isPending, error }}
          onConfirm={confirm}
          onClose={() => setAsking(null)}
        >
          {asking === 'all' ? (
            <p>{words.offerAllBody(list.map((t) => `${t.name} (${date(t.lastUsedAt)})`).join(', '))}</p>
          ) : (
            <>
              <p>{words.revokeLast(date(asking.lastUsedAt))}</p>
              <p>{words.revokeBody}</p>
            </>
          )}
        </Confirm>
      )}
    </section>
  )
}
