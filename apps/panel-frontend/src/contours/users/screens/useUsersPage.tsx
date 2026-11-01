import { apiErrorMessage } from '@/lib/net/client';
import { deleteRetentionText } from '@/contours/users/lib/retentionWords';
import { useDebouncedValue } from '@mantine/hooks';
import { Text } from '@mantine/core';
import type { StatusFilter } from '@/contours/users/lib/userStatus';
import { saveToastNeeded } from '@/contours/users/lib/userSaveRefusal';
import type { UpdateUserInput, User, UserFilters, UserSort } from '@/lib/domain/users';
import type { ColumnPin, ColumnView, UserColumnId } from '@/contours/users/lib/usersTable';
import type { RowDensity } from '@/contours/users/lib/usersTable';
import { DENSITY_ORDER, DENSITY_STORAGE_KEY, USER_COLUMN_BY_ID, loadColumnView, loadDensity, saveColumnView } from '@/contours/users/lib/usersTable';
import { bulkUsers, createUser, deleteUser, listUserTags, listUsers, resetUserTraffic, revokeUserSubscription, rotateUserSubscription, updateUser } from '@/lib/domain/users';
import { bulkReport, type BulkAccessAction } from '@/contours/users/lib/userAccess';
import { fetchAuthStatus } from '@/lib/auth/api';
import { listSquads } from '@/lib/domain/squads';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOverview } from '@/lib/domain/dashboard';
import { loadFailure } from '@/lib/ui/loadView';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { useTranslation } from 'react-i18next';

/**
 * Everything the users screen owns that is not markup: the query behind the
 * table with its paging, sorting and filters, the counters, and the mutations
 * a row can fire. The screen keeps layout only.
 */
export function useUsersPage() {
  const { t } = useTranslation();

  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  // Sorting is a server concern here: the table shows one page of N, so
  // reordering the client slice would shuffle 25 rows and call it sorted.
  const [sort, setSort] = useState<UserSort>('username');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  // Filters live next to the search box rather than as more chips: squad and
  // tag are "narrow the roster" questions, while the status chips above are
  // the primary split and stay one click away.
  const [squadFilter, setSquadFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  // Routing is the third "narrow the roster" question, and the only one whose
  // answer is invisible in the row otherwise: an override changes what a user
  // gets without changing anything the table already shows.
  const [routingFilter, setRoutingFilter] = useState<string | null>(null);
  const activeFilters = (squadFilter ? 1 : 0) + (tagFilter ? 1 : 0) + (routingFilter ? 1 : 0);

  /**
   * The boxes under the column headings. Only the columns the list endpoint
   * can narrow by are wired: the username box feeds the same `search` the
   * toolbar uses, so typing in either place asks the server one question
   * rather than two that disagree.
   */
  const [colFilters, setColFilters] = useState<Partial<Record<UserColumnId, string>>>({});
  function setColFilter(id: UserColumnId, value: string) {
    setColFilters((f) => ({ ...f, [id]: value }));
    if (id === 'username') setSearch(value);
    setPage(1);
  }

  /**
   * The per-column filters the list endpoint answers to, as one object.
   *
   * Held flat rather than per column because that is the shape the request
   * takes, and because two columns can feed the same question: the node
   * column sends both `nodeId` and `online`. Clearing a key removes it
   * entirely; sending an empty string would be a filter for the empty string.
   */
  const [colParams, setColParams] = useState<UserFilters>({});
  function setFilterParam(patch: UserFilters) {
    setColParams((cur) => {
      const next: Record<string, unknown> = { ...cur, ...patch };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '' || v === null) delete next[k];
      }
      return next as UserFilters;
    });
    setPage(1);
  }
  function clearFilterParams(keys: (keyof UserFilters)[]) {
    setColParams((cur) => {
      const next = { ...cur };
      for (const k of keys) delete next[k];
      return next;
    });
    setPage(1);
  }

  /**
   * Which columns are on, in which order, and which are nailed to an edge.
   * Loaded once from this browser and written back on every change, so the
   * view an operator built survives a reload.
   */
  const [columnView, setColumnViewState] = useState<ColumnView>(() => loadColumnView());
  function setColumnView(next: ColumnView) {
    setColumnViewState(next);
    saveColumnView(next);
  }
  function toggleColumn(id: UserColumnId) {
    const hidden = columnView.hidden.includes(id)
      ? columnView.hidden.filter((c) => c !== id)
      : [...columnView.hidden, id];
    setColumnView({ ...columnView, hidden });
  }
  function pinColumn(id: UserColumnId, pin: ColumnPin) {
    const current = columnView.pins[id] ?? null;
    setColumnView({ ...columnView, pins: { ...columnView.pins, [id]: current === pin ? null : pin } });
  }
  function moveColumn(from: number, to: number) {
    const order = [...columnView.order];
    const [moved] = order.splice(from, 1);
    if (moved === undefined) return;
    order.splice(to, 0, moved);
    setColumnView({ ...columnView, order });
  }

  /**
   * The columns actually drawn: pinned left first, then the free ones in the
   * operator's order, then pinned right. Hidden ones drop out entirely rather
   * than rendering at zero width, which would still cost a border.
   */
  const visibleColumns = useMemo(() => {
    const shown = columnView.order
      .map((id) => USER_COLUMN_BY_ID.get(id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined && !columnView.hidden.includes(c.id));
    const at = (p: ColumnPin) => shown.filter((c) => (columnView.pins[c.id] ?? null) === p);
    return [...at('left'), ...at(null), ...at('right')];
  }, [columnView]);

  /** Row height, cycled by one button; and the table alone on the screen. */
  const [density, setDensityState] = useState<RowDensity>(() => loadDensity());
  function cycleDensity() {
    const next = DENSITY_ORDER[(DENSITY_ORDER.indexOf(density) + 1) % DENSITY_ORDER.length]!;
    setDensityState(next);
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      // A browser with storage off still gets the change for this session.
    }
  }
  const [fullscreen, setFullscreen] = useState(false);

  /**
   * Rows ticked in the gutter. Kept as ids rather than users so a refetch
   * cannot resurrect a stale copy of a row that has since changed.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  function toggleSelected(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSort(next: UserSort) {
    if (next === sort) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(next);
      setOrder(next === 'username' ? 'asc' : 'desc');
    }
    setPage(1);
  }

  // Wave-14 #17: server-side pagination + filter + search. Pre-wave we
  // fetched limit:500 once and paged/filtered/searched in JS; this silently
  // truncated installs >500 users and re-rendered the full table on every
  // keystroke. Backend already supported `page/limit/status/search`; UI just
  // wasn't passing them.
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const serverStatus = statusFilter === 'all' ? undefined : statusFilter;
  const serverSearch = debouncedSearch.trim() || undefined;
  const usersQuery = useQuery({
    queryKey: [
      'users',
      {
        page,
        limit: rowsPerPage,
        status: serverStatus,
        search: serverSearch,
        groupId: squadFilter,
        tag: tagFilter,
        routingPreset: routingFilter,
        sort,
        order,
        // Part of the cache address, not just of the request: two different
        // filter sets are two different lists and must not share a page.
        ...colParams,
      },
    ],
    queryFn: () =>
      listUsers({
        page,
        limit: rowsPerPage,
        status: serverStatus,
        search: serverSearch,
        groupId: squadFilter ?? undefined,
        tag: tagFilter ?? undefined,
        routingPreset: (routingFilter as 'any' | 'none' | undefined) ?? undefined,
        sort,
        order,
        ...colParams,
      }),
    placeholderData: (prev) => prev,
  });
  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads });
  const tagsQuery = useQuery({
    queryKey: ['user-tags'],
    queryFn: listUserTags,
    staleTime: 5 * 60 * 1000,
  });
  const knownTags = tagsQuery.data?.tags ?? [];
  // The subscription address comes from /auth/status only (A-207): a link
  // built on the API base copied a localhost host on a prod build (Wave-14
  // #16). The row's copy-link action and the drawer both read it from here.
  const authStatusQuery = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: fetchAuthStatus,
    staleTime: 5 * 60 * 1000,
  });
  // Wave-14 #17: full-install counters come from dashboard.users (cached
  // server-side, ~ N/A cost) instead of computed from the current page slice
  // - the slice doesn't reflect total install state under server pagination.
  const dashQuery = useOverview();
  const squadNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of squadsQuery.data?.squads ?? []) m.set(s.id, s.name);
    return m;
  }, [squadsQuery.data]);

  // The page did not arrive (spec frontend-users): said with a retry, not as
  // «nobody yet» or «nothing matched». A failure under a placeholder counts
  // too: the rows on screen would be the previous filter's.
  const usersFailure =
    usersQuery.isError && (usersQuery.data === undefined || usersQuery.isPlaceholderData)
      ? { message: apiErrorMessage(usersQuery.error), onRetry: () => void usersQuery.refetch() }
      : null;
  const pagedUsers = usersFailure ? [] : (usersQuery.data?.users ?? []);
  const totalUsers = usersQuery.data?.total ?? 0;
  // Side lists the toolbar and the rows read; a failed one is said once.
  const sideFailure =
    [squadsQuery, tagsQuery].map((q) => loadFailure(q, apiErrorMessage)).find((f) => f !== null) ?? null;

  // Counts come from the dashboard; without it they are unknown, not zero
  // (spec frontend-users). `total` falls back to the list's own total.
  const stats = useMemo(() => {
    const users = dashQuery.data?.users;
    const byStatus = users?.byStatus;
    return {
      total: users?.total ?? (usersQuery.data ? totalUsers : null),
      active: byStatus ? (byStatus.active ?? 0) : null,
      expired: byStatus ? (byStatus.expired ?? 0) : null,
      limited: byStatus ? (byStatus.limited ?? 0) : null,
      disabled: byStatus ? (byStatus.disabled ?? 0) : null,
    };
  }, [dashQuery.data, usersQuery.data, totalUsers]);

  // Topbar line: "/ USERS · 36 ACCOUNTS · 21 ACTIVE". `count` drives i18next
  // pluralization (one/few/many/other for RU), otherwise a single user reads
  // as "1 аккаунтов".
  usePageMeta(
    stats.total === null || stats.active === null
      ? [t('pageMeta.noData')]
      : [t('pageMeta.users', { count: stats.total }), t('pageMeta.usersActive', { count: stats.active })],
  );

  /**
   * Сменился любой серверный фильтр: возвращаемся на первую страницу, иначе
   * суженный список роняет нас в пустую (пятая страница из одной).
   *
   * Сравнением в рендере, а не эффектом. Эффект срабатывал ПОСЛЕ отрисовки, то
   * есть один кадр запрос уходил со старым номером страницы и новым фильтром, и
   * при узком фильтре этот кадр был пустым экраном.
   */
  const filterKey = JSON.stringify([
    statusFilter,
    debouncedSearch,
    rowsPerPage,
    squadFilter,
    tagFilter,
    routingFilter,
  ]);
  const [pagedFor, setPagedFor] = useState(filterKey);
  if (pagedFor !== filterKey) {
    setPagedFor(filterKey);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(totalUsers / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const rangeStart = totalUsers === 0 ? 0 : (safePage - 1) * rowsPerPage + 1;
  const rangeEnd = Math.min(safePage * rowsPerPage, totalUsers);

  // Bug #4: the query fetches the raw `page`, but display clamps to `safePage`.
  // If the result set shrinks for a non-filter reason (users deleted, larger
  // rowsPerPage), `page` can exceed totalPages, so the query requests an empty
  // out-of-range page while the footer shows a clamped range. Reconcile `page`
  // back into range (single source of truth) so the fetch + Prev/Next stay
  // correct. Filter-driven shrink is already handled by the reset-to-1 effect.
  if (page > totalPages) setPage(totalPages);

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: t('users.notify.created') });
    },
    // A refusal the drawer puts at a field is said there only (saveToastNeeded).
    onError: (err) => {
      if (!saveToastNeeded(err)) return;
      notifications.show({ color: 'red', title: t('common.createError'), message: apiErrorMessage(err) });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) => updateUser(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: t('users.notify.updated') });
    },
    onError: (err) => {
      if (!saveToastNeeded(err)) return;
      notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: t('users.notify.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: apiErrorMessage(err),
      }),
  });

  const revokeMutation = useMutation({
    mutationFn: revokeUserSubscription,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: t('users.notify.revoked') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        message: apiErrorMessage(err),
      }),
  });

  const rotateMutation = useMutation({
    mutationFn: rotateUserSubscription,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: t('users.notify.rotated') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        message: apiErrorMessage(err),
      }),
  });

  const resetTrafficMutation = useMutation({
    mutationFn: resetUserTraffic,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: t('users.notify.trafficReset') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        message: apiErrorMessage(err),
      }),
  });

  function handleRevoke(user: User) {
    modals.openConfirmModal({
      title: t('users.revokeTitle', { name: user.username }),
      children: <Text size="sm">{t('users.revokeBody')}</Text>,
      labels: { confirm: t('usersTable.actionRevoke'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => revokeMutation.mutate(user.id),
    });
  }

  function handleRotate(user: User) {
    modals.openConfirmModal({
      title: t('users.rotateTitle', { name: user.username }),
      children: <Text size="sm">{t('users.rotateBody')}</Text>,
      labels: { confirm: t('usersTable.actionRotate'), cancel: t('common.cancel') },
      onConfirm: () => rotateMutation.mutate(user.id),
    });
  }

  function handleResetTraffic(user: User) {
    modals.openConfirmModal({
      title: t('users.resetTrafficTitle', { name: user.username }),
      children: <Text size="sm">{t('users.resetTrafficBody')}</Text>,
      labels: { confirm: t('usersTable.actionResetTraffic'), cancel: t('common.cancel') },
      onConfirm: () => resetTrafficMutation.mutate(user.id),
    });
  }

  /**
   * Bulk enable / disable of the ticked rows (A-294), the only bulk actions the
   * screen offers. The server answers 200 with a report per user; the ids it
   * reached leave the selection, the ones it did not stay ticked, so the
   * operator sees which to look at.
   */
  const bulkMutation = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: BulkAccessAction }) => bulkUsers(ids, action),
    onSuccess: (data, { action }) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'overview'] });
      const report = bulkReport(data);
      if (!report) {
        notifications.show({ color: 'red', message: t('usersTable.bulkUnreadable') });
        return;
      }
      setSelected((s) => {
        const next = new Set(s);
        for (const id of report.ok) next.delete(id);
        return next;
      });
      const done = t(`usersTable.bulkDone.${action}`, { succeeded: report.succeeded, requested: report.requested });
      const first = report.failed[0];
      notifications.show(
        first
          ? {
              color: 'yellow',
              message: `${done}. ${t('usersTable.bulkFailed', { count: report.failed.length, error: first.error })}`,
            }
          : { color: 'green', message: done },
      );
    },
    onError: (err) => notifications.show({ color: 'red', message: apiErrorMessage(err) }),
  });

  function handleBulk(action: BulkAccessAction) {
    const ids = [...selected];
    if (ids.length === 0) return;
    modals.openConfirmModal({
      title: t(`usersTable.bulkTitle.${action}`, { count: ids.length }),
      children: <Text size="sm">{t(`usersTable.bulkBody.${action}`)}</Text>,
      labels: { confirm: t(`usersTable.bulkConfirm.${action}`), cancel: t('common.cancel') },
      confirmProps: action === 'disable' ? { color: 'red' } : {},
      onConfirm: () => bulkMutation.mutate({ ids, action }),
    });
  }

  function handleDelete(user: User) {
    modals.openConfirmModal({
      title: t('users.deleteTitle', { name: user.username }),
      children: (
        <Text size="sm">
          {t('users.deleteBody')} {deleteRetentionText(t)}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(user.id),
    });
  }

  return {
    qc,
    activeFilters,
    colFilters,
    setColFilter,
    colParams,
    setFilterParam,
    clearFilterParams,
    columnView,
    setColumnView,
    visibleColumns,
    toggleColumn,
    pinColumn,
    moveColumn,
    density,
    cycleDensity,
    fullscreen,
    setFullscreen,
    selected,
    setSelected,
    toggleSelected,
    toggleSort,
    serverStatus,
    serverSearch,
    usersQuery,
    usersFailure,
    sideFailure,
    squadsQuery,
    tagsQuery,
    knownTags,
    authStatusQuery,
    dashQuery,
    squadNameById,
    pagedUsers,
    totalUsers,
    stats,
    totalPages,
    safePage,
    rangeStart,
    rangeEnd,
    createMutation,
    updateMutation,
    deleteMutation,
    revokeMutation,
    rotateMutation,
    resetTrafficMutation,
    handleRevoke,
    handleRotate,
    handleResetTraffic,
    handleDelete,
    handleBulk,
    bulkMutation,
    editing,
    setEditing,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    sort,
    setSort,
    order,
    setOrder,
    squadFilter,
    setSquadFilter,
    tagFilter,
    setTagFilter,
    routingFilter,
    setRoutingFilter,
    createOpen,
    openCreate,
    closeCreate,
  };
}

/** Everything the screen hands to its sections. */
export type UsersPageState = ReturnType<typeof useUsersPage>;
