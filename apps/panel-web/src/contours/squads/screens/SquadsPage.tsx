import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styles from '@/contours/squads/components/squads.module.css'
import { DICT } from '@/contours/squads/dict'
import { useBindingsAll, useCascadesAll, useFleet, useHostsAll, useOldSquads, useProfilesAll } from '@/contours/squads/hooks/useSquadsData'
import { squadExitsSummary } from '@/contours/squads/lib/squadCascades'
import { squadReach } from '@/lib/domain/squads'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import type { Squad } from '@/lib/old/squads'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'

type View = 'cards' | 'list'
type ChipValue = 'all' | 'noHosts' | 'empty'

export default function SquadsPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const navigate = useNavigate()
  const squads = useOldSquads()
  const hosts = useHostsAll()
  const bindings = useBindingsAll()
  const nodes = useFleet()
  const profiles = useProfilesAll()
  const cascades = useCascadesAll()
  const [view, setView] = useState<View>('cards')
  const [chip, setChip] = useState<ChipValue>('all')
  const [search, setSearch] = useState('')

  const profileOfBinding = useMemo(() => new Map((bindings.data?.bindings ?? []).map((b) => [b.id, b])), [bindings.data])
  const countryOfNode = useMemo(() => new Map((nodes.data?.nodes ?? []).map((n) => [n.id, n.countryCode])), [nodes.data])
  const profileName = useMemo(() => new Map((profiles.data?.profiles ?? []).map((p) => [p.id, p.name])), [profiles.data])
  const known = hosts.data !== undefined && bindings.data !== undefined
  const cascadeIds = useMemo(() => new Set((cascades.data?.cascades ?? []).map((c) => c.id)), [cascades.data])

  // Enabled hosts of the granted profiles, as the handoff counts them; unknown until both came.
  const reachOf = (squad: Squad) => {
    if (!known) return null
    const ofProfiles = (hosts.data?.hosts ?? []).filter((h) => h.enabled && squad.profileIds.includes(profileOfBinding.get(h.bindingId)?.profileId ?? ''))
    const handed = squad.hostIds.length > 0 ? ofProfiles.filter((h) => squad.hostIds.includes(h.id)) : ofProfiles
    return { handed, total: ofProfiles.length }
  }
  const countriesOf = (squad: Squad) => {
    const reach = reachOf(squad)
    if (!reach || !nodes.data) return null
    const codes = reach.handed.flatMap((h) => {
      const binding = profileOfBinding.get(h.bindingId)
      const code = binding ? countryOfNode.get(binding.nodeId) : null
      return code ? [code.toUpperCase()] : []
    })
    return [...new Set(codes)]
  }
  const hostsWord = (squad: Squad) => {
    const reach = reachOf(squad)
    if (!reach) return words.hostsUnknown
    return squad.hostIds.length > 0 ? words.hostsOf(reach.handed.length, reach.total) : words.hostsAll(reach.total)
  }
  const cascadeWord = (squad: Squad) => {
    if (!cascades.data) return words.hostsUnknown
    const summary = squadExitsSummary(squad.exitAcl, cascadeIds)
    if (summary === 'all') return words.cascadesAll
    return [summary.off > 0 ? words.cascadesOff(summary.off) : '', summary.narrowed > 0 ? words.cascadesNarrow(summary.narrowed) : ''].filter(Boolean).join(', ')
  }
  const markOf = (squad: Squad) => {
    switch (squadReach(squad)) {
      case 'all':
        return words.allMark
      case 'wide':
        return words.wideMark
      case 'empty':
        return words.emptyMark
      case 'narrowed':
        return null
    }
  }

  const all = squads.data?.squads ?? []
  const emptyCount = all.filter((s) => squadReach(s) === 'empty').length
  const noHosts = known ? all.filter((s) => reachOf(s)?.handed.length === 0).length : undefined
  const needle = search.trim().toLowerCase()
  const shown = all.filter((s) => (needle === '' || `${s.name} ${s.description ?? ''}`.toLowerCase().includes(needle)) && (chip === 'all' || (chip === 'empty' ? squadReach(s) === 'empty' : reachOf(s)?.handed.length === 0)))

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          <Chip label={words.all} count={squads.data ? all.length : undefined} active={chip === 'all'} onClick={() => setChip('all')} />
          <Chip label={words.noHosts} count={noHosts} dot="unknown" active={chip === 'noHosts'} onClick={() => setChip('noHosts')} />
          <Chip label={words.emptySquads} count={squads.data ? emptyCount : undefined} dot="amber" active={chip === 'empty'} onClick={() => setChip('empty')} />
        </div>
        <div className={styles.chips}>
          <Segmented<View> label={words.viewLabel} value={view} onChange={setView} options={[{ value: 'cards', label: words.views.cards }, { value: 'list', label: words.views.list }]} />
          <Link className={styles.linkPrimary} to="/squads/new">
            <Icon name="plus" size="md" />
            {words.create}
          </Link>
        </div>
      </div>
      <input className={styles.search} aria-label={words.search} placeholder={words.search} value={search} onChange={(e) => setSearch(e.target.value)} />
      {squads.isPending && <QueryLoading label={words.loading} />}
      {squads.isError && <QueryFailed title={words.failedTitle} body={failureText(squads.error, locale)} retryLabel={words.retry} onRetry={() => void squads.refetch()} />}
      {squads.data && all.length === 0 && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.emptyTitle}</h2>
          <p>{words.emptyBody}</p>
          <Button variant="primary" onClick={() => void navigate('/squads/new')}>
            {words.createSquad}
          </Button>
        </div>
      )}
      {squads.data && all.length > 0 && shown.length === 0 && <div className={styles.empty}>{words.emptyFiltered}</div>}
      {shown.length > 0 && view === 'cards' && (
        <div className={styles.cards}>
          {shown.map((squad) => (
            <button key={squad.id} type="button" className={styles.card} onClick={() => void navigate(`/squads/${squad.id}`)}>
              <b className={styles.cardName}>{squad.name}</b>
              {markOf(squad) && <span className={squadReach(squad) === 'empty' ? styles.amber : styles.muted}>{markOf(squad)}</span>}
              <span>{words.usersCount(fmtNumber(squad.memberCount, locale))}</span>
              <span className={styles.flags}>
                {countriesOf(squad)?.map((code) => <Flag key={code} code={code} />) ?? words.hostsUnknown}
              </span>
              <span className={styles.muted}>
                {words.col.profiles}: {squad.profileIds.map((id) => profileName.get(id) ?? '?').join(', ') || '-'}
              </span>
              <span className={styles.muted}>
                {words.col.hosts}: {hostsWord(squad)} · {words.col.cascades}: {cascadeWord(squad)}
              </span>
            </button>
          ))}
        </div>
      )}
      {shown.length > 0 && view === 'list' && (
        <div className={styles.tableBox}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{words.col.name}</th>
                <th scope="col">{words.col.users}</th>
                <th scope="col">{words.col.countries}</th>
                <th scope="col">{words.col.profiles}</th>
                <th scope="col">{words.col.hosts}</th>
                <th scope="col">{words.col.cascades}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((squad) => (
                <tr key={squad.id} className={styles.row} onClick={() => void navigate(`/squads/${squad.id}`)}>
                  <td>
                    <b>{squad.name}</b>
                    {markOf(squad) && <div className={squadReach(squad) === 'empty' ? styles.amber : styles.muted}>{markOf(squad)}</div>}
                  </td>
                  <td>{fmtNumber(squad.memberCount, locale)}</td>
                  <td>
                    <span className={styles.flags}>{countriesOf(squad)?.map((code) => <Flag key={code} code={code} />) ?? '?'}</span>
                  </td>
                  <td>{squad.profileIds.length}</td>
                  <td>{hostsWord(squad)}</td>
                  <td>{cascadeWord(squad)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
