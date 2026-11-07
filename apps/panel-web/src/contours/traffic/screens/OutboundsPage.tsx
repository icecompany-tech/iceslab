import { useState } from 'react'
import { Link } from 'react-router-dom'
import { OutboundWindow } from '@/contours/traffic/components/OutboundWindow'
import styles from '@/contours/traffic/components/traffic.module.css'
import { useDeleteOutbound, useOutbounds } from '@/contours/traffic/hooks/useOutbounds'
import { DICT } from '@/contours/traffic/outboundsDict'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { CREATABLE_OUTBOUND_TYPES, namedOutboundRefusal, type NamedOutbound, type NamedOutboundUse } from '@/lib/old/namedOutbounds'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { useToast } from '@/ui/Toast/useToast'

export default function OutboundsPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const list = useOutbounds()
  const remove = useDeleteOutbound()
  // null: no window; 'new': a new one; otherwise the one being edited.
  const [editing, setEditing] = useState<NamedOutbound | 'new' | null>(null)
  const [deleting, setDeleting] = useState<NamedOutbound | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<readonly NamedOutboundUse[] | null>(null)
  const askDelete = (outbound: NamedOutbound) => {
    if (outbound.usedBy.length > 0) {
      setBlocked(outbound.usedBy)
      return
    }
    setDeleteError(null)
    setDeleting(outbound)
  }
  const confirmDelete = () => {
    if (!deleting) return
    setDeleteError(null)
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.show(words.deleted)
        setDeleting(null)
      },
      onError: (err) => {
        const read = namedOutboundRefusal(err)
        if (read?.code === 'IN_USE') {
          setDeleting(null)
          setBlocked(read.usedBy)
        } else setDeleteError(failureText(err, locale))
      },
    })
  }
  const target = (outbound: NamedOutbound) => {
    const c = outbound.config
    if (outbound.type !== 'vless' && outbound.type !== 'socks') return ''
    const where = `${String(c.server ?? '')}:${String(c.port ?? '')}`
    if (outbound.type === 'socks') return c.username ? `${where} · ${words.withAuth}` : where
    const security = c.security === 'tls' || c.security === 'reality' ? c.security : words.noSecurity
    return c.flow ? `${where} · ${security} · vision` : `${where} · ${security}`
  }
  const outbounds = list.data?.outbounds ?? []
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.intro}>
          <p className={styles.noteRow}>{words.intro}</p>
          {list.data && <p className={styles.note}>{words.count(outbounds.length)}</p>}
        </div>
        <Button variant="primary" icon={<Icon name="plus" size="md" />} onClick={() => setEditing('new')}>
          {words.add}
        </Button>
      </div>
      {list.isError && <QueryFailed title={words.failed} body={failureText(list.error, locale)} retryLabel={words.retry} onRetry={() => void list.refetch()} />}
      {list.isPending && <QueryLoading label={words.loading} />}
      {list.data && outbounds.length === 0 && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.emptyTitle}</h2>
          <p>{words.emptyBody}</p>
        </div>
      )}
      {outbounds.length > 0 && (
        <div className={styles.tableBox}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{words.colName}</th>
                <th>{words.colType}</th>
                <th>{words.colTarget}</th>
                <th>{words.colUsed}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {outbounds.map((outbound) => {
                const imported = !CREATABLE_OUTBOUND_TYPES.includes(outbound.type)
                return (
                  <tr key={outbound.id} className={`${styles.rowClick} ${imported ? styles.rowDim : ''}`} onClick={() => setEditing(outbound)}>
                    <td>
                      <span className={styles.lockCell}>
                        {outbound.countryCode && <Flag code={outbound.countryCode} />}
                        <button
                          type="button"
                          className={styles.rowName}
                          aria-label={words.openRow(outbound.name)}
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditing(outbound)
                          }}
                        >
                          {outbound.name}
                        </button>
                      </span>
                    </td>
                    <td>
                      {outbound.type}
                      {imported && (
                        <span className={styles.note} title={words.importedHint}>
                          {' '}
                          {words.importedOnly}
                        </span>
                      )}
                    </td>
                    <td className={styles.mono}>{target(outbound)}</td>
                    <td>
                      {outbound.usedBy.length === 0 && <span className={styles.note}>{words.notUsed}</span>}
                      {outbound.usedBy.map((use) => (
                        <div key={`${use.cascadeId}-${use.directionTag}`}>
                          <Link className={styles.link} to={`/cascades/${use.cascadeId}`} onClick={(e) => e.stopPropagation()}>
                            {words.usedBy(use.cascadeName, use.directionTag)}
                          </Link>
                        </div>
                      ))}
                    </td>
                    <td>
                      <div className={styles.rowMenu}>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={(e) => {
                            e.stopPropagation()
                            askDelete(outbound)
                          }}
                        >
                          {words.delete}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing !== null && <OutboundWindow key={editing === 'new' ? 'new' : editing.id} stored={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <Confirm title={words.deleteTitle(deleting.name)} labels={{ confirm: words.delete, cancel: words.cancel }} tone="danger" state={{ busy: remove.isPending, error: deleteError }} onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
          <p>{words.deleteBody}</p>
        </Confirm>
      )}
      {blocked && (
        <Dialog title={words.blockedTitle} closeLabel={words.close} onClose={() => setBlocked(null)} footer={<Button onClick={() => setBlocked(null)}>{words.close}</Button>}>
          <p>{words.blockedBody}</p>
          <ul className={styles.linkList}>
            {blocked.map((use) => (
              <li key={`${use.cascadeId}-${use.directionTag}`} className={styles.blockedRow}>
                <span>{words.usedBy(use.cascadeName, use.directionTag)}</span>
                <Link className={styles.link} to={`/cascades/${use.cascadeId}`}>
                  {words.openCascade}
                </Link>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </div>
  )
}
