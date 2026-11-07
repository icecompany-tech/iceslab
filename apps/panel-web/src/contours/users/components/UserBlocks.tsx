// The blocks of the user window that read their own data: each loads, fails and stays empty
// on its own, its neighbours keep working (F-K1).
import { HWID_DEVICE_RETENTION_DAYS } from '@iceslab/shared'
import { useState } from 'react'
import styles from '@/contours/users/components/users.module.css'
import { DICT } from '@/contours/users/dict'
import { useDelivery, useDevices, useEndpoints, useResetDevices, useUpdateUser } from '@/contours/users/hooks/useUsers'
import { withProtocol, type User, type UserEndpoint } from '@/contours/users/lib/users'
import { useNow } from '@/lib/clock'
import { nodeHealth } from '@/lib/domain/overview'
import type { NodeRow } from '@/lib/domain/nodes'
import { narrowingFact, type Squad } from '@/lib/domain/squads'
import { fmtDate, fmtDuration } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { Select } from '@/ui/Select/Select'
import { useToast } from '@/ui/Toast/useToast'

const SEARCH_FROM = 6

function useCopy() {
  const [done, setDone] = useState(false)
  return {
    done,
    copy: (text: string) => {
      void navigator.clipboard?.writeText(text).then(() => {
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      })
    },
  }
}

export function DevicesBlock({ user }: { user: User }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const toast = useToast()
  const devices = useDevices(user.id)
  const reset = useResetDevices(user.id)
  const [find, setFind] = useState('')
  const [asking, setAsking] = useState(false)
  const all = [...(devices.data ?? [])].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
  const needle = find.trim().toLowerCase()
  const shown = needle === '' ? all : all.filter((d) => d.hwid.toLowerCase().includes(needle) || (d.label ?? '').toLowerCase().includes(needle))
  const resetIds = (ids: readonly string[]) => {
    reset.mutate(ids, {
      onSuccess: ({ done, failed }) => {
        if (failed > 0) toast.show(words.devicesResetPartial(done, failed), 'partial')
        else toast.show(words.devicesResetDone(done))
        setAsking(false)
      },
    })
  }
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <h3 className={styles.blockTitle}>
          <Icon name="phone" size="lg" />
          {words.devices}
        </h3>
        <div className={styles.blockAside}>
          {devices.data && <span>{words.devicesUsed(all.length, user.hwidDeviceLimit)}</span>}
          {all.length > 0 && (
            <button type="button" className={styles.amberLink} onClick={() => setAsking(true)}>
              {words.devicesResetAll}
            </button>
          )}
        </div>
      </div>
      {devices.isPending && <QueryLoading label={words.loading} />}
      {devices.isError && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void devices.refetch()}>
          {words.devicesFailed}: {failureText(devices.error, locale)}
        </QueryFailedLine>
      )}
      {devices.data && all.length === 0 && <div className={styles.grayLine}>{words.devicesEmpty}</div>}
      {all.length > 0 && (
        <>
          {all.length >= SEARCH_FROM && <input className={styles.blockSearch} aria-label={words.devicesFind} placeholder={words.devicesFind} value={find} onChange={(e) => setFind(e.target.value)} />}
          <div className={styles.innerTable}>
            <table className={styles.devices}>
              <thead>
                <tr>
                  <th scope="col">{words.deviceColumn}</th>
                  <th scope="col">{words.deviceFirst}</th>
                  <th scope="col">{words.deviceLast}</th>
                  <th scope="col" aria-label={words.deviceReset} />
                </tr>
              </thead>
              <tbody>
                {shown.map((device) => (
                  <tr key={device.id}>
                    <td className={device.label ? '' : styles.mono}>{device.label ?? `${device.hwid.slice(0, 12)}...`}</td>
                    <td className={styles.muted}>{fmtDate(device.firstSeenAt, locale)}</td>
                    <td className={styles.muted}>{words.ago(fmtDuration((now() - Date.parse(device.lastSeenAt)) / 1000, locale))}</td>
                    <td>
                      <button type="button" className={styles.textButton} disabled={reset.isPending} onClick={() => resetIds([device.id])}>
                        {words.deviceReset}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <div className={styles.grayLine}>{words.devicesNotFound}</div>}
          </div>
        </>
      )}
      <p className={styles.fineNote}>{words.devicesNote(HWID_DEVICE_RETENTION_DAYS)}</p>
      {asking && (
        <Confirm title={words.devicesResetTitle(all.length)} labels={{ confirm: words.deviceReset, cancel: words.cancel }} tone="warn" state={{ busy: reset.isPending }} onConfirm={() => resetIds(all.map((d) => d.id))} onClose={() => setAsking(false)}>
          {words.devicesResetBody}
        </Confirm>
      )}
    </section>
  )
}

export function SubscriptionBlock({ user, url, onRevoke }: { user: User; url: string | null; onRevoke: () => void }) {
  const words = useDict(DICT)
  const endpoints = useEndpoints(user.id)
  const [protocol, setProtocol] = useState<string | null>(null)
  const { done, copy } = useCopy()
  const protocols = [...new Set((endpoints.data ?? []).map((e) => e.protocol))]
  const link = url === null ? null : withProtocol(url, protocol)
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <h3 className={styles.blockTitle}>{words.subscription}</h3>
      </div>
      {user.subRevokedAt && <Banner tone="danger">{words.linkRevokedNote}</Banner>}
      {link === null ? (
        <div className={styles.grayLine}>{words.linkUnknown}</div>
      ) : (
        <>
          <div className={styles.linkBox}>
            <code className={styles.link} aria-label={words.linkAddress}>
              {link}
            </code>
            <Button variant="primary" onClick={() => copy(link)}>
              {done ? words.copied : words.copyLink.split(' ')[0]}
            </Button>
          </div>
          <div className={styles.groupHead}>
            <span className={styles.groupLabel}>{words.linkGives}</span>
            <Select look="filter" aria-label={words.linkGives} value={protocol ?? ''} onChange={(e) => setProtocol(e.target.value === '' ? null : e.target.value)} options={[{ value: '', label: words.linkAll }, ...protocols.map((p) => ({ value: p, label: p }))]} />
          </div>
          <div className={styles.twoButtons}>
            <Button size="md" wide onClick={() => window.open(link, '_blank', 'noreferrer')}>
              {words.openAsClient}
            </Button>
            <Button size="md" wide variant="danger" icon={<Icon name="ban" size="md" />} onClick={onRevoke}>
              {words.revokeShort}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

function ConfigRow({ endpoint, node }: { endpoint: UserEndpoint; node: NodeRow | undefined }) {
  const words = useDict(DICT)
  const { done, copy } = useCopy()
  return (
    <tr>
      <td>
        <span className={styles.nodeCell}>
          <Flag code={node?.countryCode ?? null} />
          <span className={styles.nodeName} title={endpoint.label}>
            {node?.name ?? endpoint.label}
          </span>
        </span>
      </td>
      <td className={styles.mono}>{endpoint.protocol}</td>
      <td className={`${styles.mono} ${styles.muted}`}>{endpoint.port}</td>
      <td>
        <button type="button" className={styles.iconButton} aria-label={done ? words.copied : words.copyConfig(endpoint.label)} onClick={() => copy(endpoint.uri)}>
          <Icon name={done ? 'check' : 'copy'} size="md" />
        </button>
      </td>
    </tr>
  )
}

export function ClientBlock({ user, nodes, squads }: { user: User; nodes: ReadonlyMap<string, NodeRow>; squads: readonly Squad[] }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const endpoints = useEndpoints(user.id)
  const delivery = useDelivery(user.id)
  const update = useUpdateUser(user.id)
  const [find, setFind] = useState('')
  const [protocol, setProtocol] = useState('')
  const all = endpoints.data ?? []
  const protocols = [...new Set(all.map((e) => e.protocol))]
  const nodeIds = [...new Set(all.map((e) => e.nodeId))]
  const online = nodeIds.filter((id) => nodeHealth(nodes.get(id)?.status ?? 'unknown') === 'ok').length
  const needle = find.trim().toLowerCase()
  const shown = all.filter((e) => (protocol === '' || e.protocol === protocol) && (needle === '' || `${e.label} ${e.protocol} ${e.host} ${nodes.get(e.nodeId)?.name ?? ''}`.toLowerCase().includes(needle)))
  const routing = delivery.data
  const hasOldPreset = user.routingPreset != null || user.customRoutingPresetId != null
  const fact = narrowingFact(user.groupIds, squads)
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <h3 className={styles.blockTitle}>{words.clientGets}</h3>
        {endpoints.data && nodeIds.length > 0 && <span className={styles.blockAside}>{words.nodesOnline(online, nodeIds.length)}</span>}
      </div>
      {endpoints.isPending && <QueryLoading label={words.loading} />}
      {endpoints.isError && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void endpoints.refetch()}>
          {words.configsFailed}: {failureText(endpoints.error, locale)}
        </QueryFailedLine>
      )}
      {endpoints.data && all.length === 0 && <div className={styles.grayLine}>{words.configsEmpty}</div>}
      {all.length > 0 && (
        <>
          <div className={styles.configCount}>{words.configsCount(words.configsWord(all.length), words.nodesWord(nodeIds.length), words.protocolsWord(protocols.length))}</div>
          <div className={styles.configTools}>
            <input className={styles.blockSearch} aria-label={words.configFind} placeholder={words.configFind} value={find} onChange={(e) => setFind(e.target.value)} />
            <Select aria-label={words.allProtocols} value={protocol} onChange={(e) => setProtocol(e.target.value)} options={[{ value: '', label: words.allProtocols }, ...protocols.map((p) => ({ value: p, label: p }))]} />
          </div>
          <div className={`${styles.innerTable} ${styles.configScroll}`}>
            <table className={styles.devices}>
              <thead>
                <tr>
                  <th scope="col">{words.configNode}</th>
                  <th scope="col">{words.configProtocol}</th>
                  <th scope="col">{words.configPort}</th>
                  <th scope="col" aria-label={words.copyLink} />
                </tr>
              </thead>
              <tbody>
                {shown.map((endpoint) => (
                  <ConfigRow key={endpoint.uri} endpoint={endpoint} node={nodes.get(endpoint.nodeId)} />
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <div className={styles.grayLine}>{words.configsNotFound}</div>}
          </div>
        </>
      )}
      <div className={styles.routingRow}>
        <span className={styles.groupLabel}>{words.routing}</span>
        <span>
          {routing?.effectivePreset ? `${routing.effectivePreset.name}, ${routing.userPreset ? words.routingOwn : routing.squadPreset ? words.routingFromSquad : words.routingFromPanel}` : words.routingUnknown}
        </span>
      </div>
      {hasOldPreset && (
        <Banner
          title={words.oldPresetTitle}
          action={
            <Button
              loading={update.isPending}
              onClick={() =>
                update.mutate(
                  { routingPreset: null, customRoutingPresetId: null },
                  { onSuccess: () => toast.show(words.oldPresetDone), onError: (err) => toast.show(failureText(err, locale), 'failed') },
                )
              }
            >
              {words.oldPresetClear}
            </Button>
          }
        >
          {words.oldPresetBody}
        </Banner>
      )}
      {routing?.squadConflict && <Banner title={words.squadConflictTitle}>{words.squadConflictBody}</Banner>}
      {fact.narrowed.length > 0 && fact.lifting.length > 0 && <Banner>{words.narrowingLifted(fact.lifting.map((s) => s.name).join(', '))}</Banner>}
    </section>
  )
}
