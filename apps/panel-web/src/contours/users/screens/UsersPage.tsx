import { useMemo, useState } from 'react'
import { ActionDialog, type DialogKind, type UserDialog } from '@/contours/users/components/ActionDialogs'
import { ColumnsPanel } from '@/contours/users/components/ColumnsPanel'
import { FiltersPopover } from '@/contours/users/components/FiltersPopover'
import { NewUserWindow } from '@/contours/users/components/NewUserWindow'
import { UsersTable, type Density } from '@/contours/users/components/UsersTable'
import { UserWindow } from '@/contours/users/components/UserWindow'
import styles from '@/contours/users/components/users.module.css'
import { DICT } from '@/contours/users/dict'
import { PAGE_SIZES, useListState, type StatusFilter } from '@/contours/users/hooks/useListState'
import { useBulkAccess, usePanelAddress, useUpdateUser, useUsersList } from '@/contours/users/hooks/useUsers'
import { COLUMN_VIEW_KEY, COLUMNS, parseStoredView, viewFromStored, visibleColumns, type ColumnView } from '@/contours/users/lib/columns'
import type { BulkReport, User } from '@/contours/users/lib/users'
import { useAllNodes } from '@/lib/domain/nodes'
import { useOverview } from '@/lib/domain/overview'
import { useSquads } from '@/lib/domain/squads'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { readStored, writeStored } from '@/lib/storage'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Icon } from '@/ui/Icon/Icon'
import { Popover } from '@/ui/Popover/Popover'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { useToast } from '@/ui/Toast/useToast'

const DENSITY_ORDER: readonly Density[] = ['normal', 'compact', 'relaxed']

const STATUS_CHIPS: readonly { value: StatusFilter; dot?: 'danger' | 'amber' | 'unknown' }[] = [
  { value: 'all' },
  { value: 'active' },
  { value: 'expired', dot: 'danger' },
  { value: 'limited', dot: 'amber' },
  { value: 'disabled', dot: 'unknown' },
]

type BulkAction = 'enable' | 'disable'

function EnableRow({ user, onDone }: { user: User; onDone: () => void }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const update = useUpdateUser(user.id)
  const [started, setStarted] = useState(false)
  if (!started) {
    setStarted(true)
    update.mutate(
      { status: 'active' },
      {
        onSuccess: () => toast.show(words.enabled(user.username)),
        onError: (err) => toast.show(failureText(err, locale), 'failed'),
        onSettled: onDone,
      },
    )
  }
  return null
}

export default function UsersPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const list = useListState()
  const users = useUsersList(list.params)
  const overview = useOverview()
  const squads = useSquads()
  const nodes = useAllNodes()
  const panel = usePanelAddress()
  const bulk = useBulkAccess()

  const [view, setViewState] = useState<ColumnView>(() => viewFromStored(readStored(COLUMN_VIEW_KEY, parseStoredView)))
  const [density, setDensity] = useState<Density>('normal')
  const [fullscreen, setFullscreen] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [openUser, setOpenUser] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)
  const [dialog, setDialog] = useState<UserDialog | null>(null)
  const [enabling, setEnabling] = useState<User | null>(null)
  const [bulkAsk, setBulkAsk] = useState<BulkAction | null>(null)
  const [bulkResult, setBulkResult] = useState<{ action: BulkAction; report: BulkReport } | null>(null)

  const setView = (next: ColumnView) => {
    setViewState(next)
    writeStored(COLUMN_VIEW_KEY, next)
  }

  const columns = useMemo(() => visibleColumns(view), [view])
  const nodeMap = useMemo(() => new Map((nodes.data ?? []).map((n) => [n.id, n])), [nodes.data])
  const squadMap = useMemo(() => new Map((squads.data ?? []).map((s) => [s.id, s])), [squads.data])
  const context = useMemo(() => ({ nodes: nodeMap, squads: squadMap, panel: panel.data, allNodes: nodes.data ?? [] }), [nodeMap, squadMap, panel.data, nodes.data])

  const select = (ids: readonly string[], on: boolean) => {
    setSelected((all) => {
      const next = new Set(all)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const runBulk = (action: BulkAction) => {
    const userIds = [...selected]
    bulk.mutate(
      { userIds, action },
      {
        onSuccess: (report) => {
          setBulkAsk(null)
          setBulkResult({ action, report })
          // The selection stays on those it did not reach: they can be retried.
          setSelected(new Set(report.failed.map((f) => f.userId)))
          if (report.failed.length === 0) toast.show(words.bulkDone(words.bulkVerb[action], report.succeeded, report.requested))
        },
        onError: (err) => {
          setBulkAsk(null)
          toast.show(failureText(err, locale), 'failed')
        },
      },
    )
  }

  const byStatus = overview.data?.users.byStatus
  // Owner 10.11: a status the answer leaves out is a grey 0; with no answer yet no number at all (F-K1).
  const countOf = (value: StatusFilter) => (value === 'all' ? overview.data?.users.total : byStatus && (byStatus[value] ?? 0))
  const data = users.data
  const total = data?.total ?? 0
  const first = total === 0 ? 0 : (list.page - 1) * list.limit + 1
  const last = Math.min(list.page * list.limit, total)
  const sortColumn = COLUMNS.find((c) => c.sort === list.sort.by)
  const nameOf = (id: string) => data?.users.find((u) => u.id === id)?.username ?? id.slice(0, 8)

  return (
    <div className={`${styles.page} ${fullscreen ? styles.fullscreen : ''}`}>
      <div className={styles.topRow}>
        <div className={styles.chips}>
          {STATUS_CHIPS.map(({ value, dot }) => (
            <Chip key={value} label={words.statuses[value]} count={countOf(value)} dot={dot} active={list.status === value} onClick={() => list.setStatus(value)} />
          ))}
        </div>
        <div className={styles.topActions}>
          <FiltersPopover list={list} squads={squads.data ?? []} />
          <Button variant="primary" icon={<Icon name="plus" size="md" />} onClick={() => setCreating(true)}>
            {words.create}
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <b>{words.selected(selected.size)}</b>
          <span className={styles.bulkActions}>
            <Button variant="warn" icon={<Icon name="power" size="md" />} onClick={() => setBulkAsk('disable')}>
              {words.bulkDisable}
            </Button>
            <Button icon={<Icon name="power" size="md" />} onClick={() => setBulkAsk('enable')}>
              {words.bulkEnable}
            </Button>
            <Button onClick={() => setSelected(new Set())}>{words.unselect}</Button>
          </span>
        </div>
      )}

      {bulkResult && bulkResult.report.failed.length > 0 && (
        <Banner
          action={
            <Button
              onClick={() => {
                setBulkResult(null)
                setSelected(new Set())
              }}
            >
              {words.unselect}
            </Button>
          }
        >
          <b>{words.bulkDone(words.bulkVerb[bulkResult.action], bulkResult.report.succeeded, bulkResult.report.requested)}</b>{' '}
          {words.bulkFailed(bulkResult.report.failed.length, bulkResult.report.failed.map((f) => `${nameOf(f.userId)}${f.error ? `: ${f.error}` : ''}`).join('; '))}
        </Banner>
      )}

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.viewLine}>
            <b>{words.columnsCount(columns.length, COLUMNS.length)}</b>
            {' · '}
            {list.narrowed ? (
              <>
                {words.filtersCount(list.filterCount)}{' '}
                <button type="button" className={styles.textButton} onClick={list.resetAll}>
                  {words.resetFilters}
                </button>
              </>
            ) : (
              words.noFilters
            )}
            {sortColumn && ` · ${words.sortedBy(words.column[sortColumn.id])}`}
          </span>
          <span className={styles.viewTools}>
            <button type="button" className={styles.viewButton} aria-label={words.density} onClick={() => setDensity(DENSITY_ORDER[(DENSITY_ORDER.indexOf(density) + 1) % DENSITY_ORDER.length] ?? 'normal')}>
              <Icon name="density" size="lg" />
            </button>
            <button type="button" className={styles.viewButton} aria-label={words.fullscreen} aria-pressed={fullscreen} onClick={() => setFullscreen(!fullscreen)}>
              <Icon name="fullscreen" size="lg" />
            </button>
            <Popover
              align="end"
              look="sheet"
              trigger={(props) => (
                <button type="button" className={styles.viewButton} aria-label={words.columnsPanel} {...props}>
                  <Icon name="columns" size="lg" />
                </button>
              )}
            >
              <ColumnsPanel view={view} onChange={setView} />
            </Popover>
          </span>
        </div>
        {users.isError && !data ? (
          <QueryFailed title={words.failedTitle} body={failureText(users.error, locale)} retryLabel={words.retry} onRetry={() => void users.refetch()} />
        ) : users.isPending ? (
          <QueryLoading label={words.loading} />
        ) : (
          <UsersTable
            layout={{ columns, view, onView: setView, density }}
            list={list}
            users={data?.users ?? []}
            context={context}
            selection={{ selected, onSelect: select }}
            actions={{ onOpen: setOpenUser, onDialog: (kind: DialogKind, user) => setDialog({ kind, user }), onEnable: setEnabling }}
            empty={
              <div className={styles.empty}>
                <div className={styles.emptyTitle}>{list.narrowed ? words.emptyFilteredTitle : words.emptyTitle}</div>
                <div className={styles.emptyBody}>{list.narrowed ? words.emptyFilteredBody : words.emptyBody}</div>
                {list.narrowed ? <Button onClick={list.resetAll}>{words.resetFilters}</Button> : <Button variant="primary" onClick={() => setCreating(true)}>{words.emptyCreate}</Button>}
              </div>
            }
          />
        )}
        <div className={styles.cardFoot}>
          <span>{words.range(fmtNumber(first, locale), fmtNumber(last, locale), fmtNumber(total, locale))}</span>
          <span className={styles.pager}>
            {/* Paper Footer: the page size is words with a chevron, chosen in ui/Popover; the arrows carry the frames. */}
            <Popover
              align="end"
              trigger={(props) => (
                <button type="button" className={styles.perPage} aria-label={words.perPage} {...props}>
                  {words.perPageOption(list.limit)}
                  <Icon name="chevronDown" size="md" />
                </button>
              )}
            >
              {(close) => (
                <div role="menu" aria-label={words.perPage} className={styles.choiceList}>
                  {PAGE_SIZES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="menuitemradio"
                      aria-checked={n === list.limit}
                      className={styles.choiceItem}
                      onClick={() => {
                        close()
                        list.setLimit(n)
                      }}
                    >
                      {words.perPageOption(n)}
                      {n === list.limit && <Icon name="check" size="md" />}
                    </button>
                  ))}
                </div>
              )}
            </Popover>
            <span className={styles.pageArrows}>
              <button type="button" className={styles.pageArrow} aria-label={words.prevPage} disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)}>
                <Icon name="chevronLeft" size="md" />
              </button>
              <button type="button" className={styles.pageArrow} aria-label={words.nextPage} disabled={last >= total} onClick={() => list.setPage(list.page + 1)}>
                <Icon name="chevronRight" size="md" />
              </button>
            </span>
          </span>
        </div>
      </div>

      {openUser && <UserWindow key={openUser.id} user={data?.users.find((u) => u.id === openUser.id) ?? openUser} squads={squads.data ?? []} squadsFailed={squads.isError} nodes={nodeMap} panel={panel.data} onClose={() => setOpenUser(null)} />}
      {creating && <NewUserWindow squads={squads.data ?? []} squadsFailed={squads.isError} nodes={nodeMap} onClose={() => setCreating(false)} />}
      {dialog && <ActionDialog dialog={dialog} onClose={() => setDialog(null)} />}
      {enabling && <EnableRow key={enabling.id} user={enabling} onDone={() => setEnabling(null)} />}
      {bulkAsk && (
        <Confirm
          title={bulkAsk === 'disable' ? words.bulkDisableTitle(selected.size) : words.bulkEnableTitle(selected.size)}
          labels={{ confirm: bulkAsk === 'disable' ? words.bulkDisable : words.bulkEnable, cancel: words.cancel }}
          tone="warn"
          state={{ busy: bulk.isPending }}
          onConfirm={() => runBulk(bulkAsk)}
          onClose={() => setBulkAsk(null)}
        >
          {bulkAsk === 'disable' ? words.bulkDisableBody : words.bulkEnableBody}
        </Confirm>
      )}
    </div>
  )
}
