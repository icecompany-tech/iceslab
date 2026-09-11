import { ACTIONS_COL, SELECT_COL, USER_COLUMNS } from '@/contours/users/lib/usersTable';
import { ColumnsPanel } from '@/contours/users/components/UsersTable/ColumnsPanel';
import { columnStyles } from '@/contours/users/lib/columnLayout';
import { UserRow } from '@/contours/users/components/UsersTable/UserRow';
import { ActionIcon, ThemeIcon } from '@mantine/core';
import { CARD, CYAN, GROUND, HAIRLINE, MIST, SNOW, WELL } from '@/contours/users/lib/colors';
import { UnstyledButton } from '@mantine/core';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MONO } from '@/contours/users/lib/textStyles';
import { Box, Group, Select, Stack, Text } from '@mantine/core';
import { HeadCell } from '@/contours/users/components/UsersTable/HeadCell';
import { IconChevronLeft, IconChevronRight, IconUserOff } from '@tabler/icons-react';
import { MONO_LABEL } from '@/contours/users/lib/textStyles';
import { SelectBox } from '@/contours/users/components/UsersTable/SelectBox';
import { UsersEmpty } from '@/contours/users/components/UsersTable/UsersEmpty';
import { IconArrowsMaximize, IconArrowsMinimize, IconBaselineDensityLarge, IconBaselineDensityMedium, IconBaselineDensitySmall } from '@tabler/icons-react';
import { DENSITY_PADDING } from '@/contours/users/lib/usersTable';
import { useTranslation } from 'react-i18next';
import type { UsersPageState } from '@/contours/users/screens/useUsersPage';

/**
 * The roster: what the current view is showing, one heading lane with a filter
 * per column, one row per user, and the pager under it.
 *
 * Column widths are fixed except the username, so every row lands in the same
 * vertical lanes and a long name cannot shift the traffic bars of its own row.
 */
export function UsersTable(props: Pick<UsersPageState,
  'toggleSort' | 'authStatusQuery' | 'squadNameById' | 'pagedUsers' | 'totalUsers' | 'stats'
  | 'totalPages' | 'safePage' | 'rangeStart' | 'rangeEnd' | 'handleRevoke' | 'handleRotate'
  | 'handleResetTraffic' | 'handleDelete' | 'setEditing' | 'setPage' | 'rowsPerPage'
  | 'setRowsPerPage' | 'sort' | 'order' | 'colFilters' | 'setColFilter' | 'statusFilter'
  | 'setStatusFilter' | 'selected' | 'setSelected' | 'toggleSelected' | 'activeFilters'
  | 'columnView' | 'setColumnView' | 'visibleColumns' | 'toggleColumn' | 'pinColumn'
  | 'moveColumn' | 'density' | 'cycleDensity' | 'fullscreen' | 'setFullscreen' | 'openCreate'
  | 'colParams' | 'setFilterParam' | 'clearFilterParams'>) {
  const { t } = useTranslation();
  const {
    pagedUsers, totalUsers, stats, totalPages, safePage, rangeStart, rangeEnd,
    setPage, rowsPerPage, setRowsPerPage, sort, activeFilters, selected, setSelected,
    columnView, visibleColumns, density, cycleDensity, fullscreen, setFullscreen,
  } = props;
  const pad = DENSITY_PADDING[density];

  const allOnPage = pagedUsers.length > 0 && pagedUsers.every((u) => selected.has(u.id));
  // Recomputed only when the columns or their pins change, not on every row
  // render: the same two arrays are handed to every row on the page.
  const headStyles = useMemo(
    () => columnStyles(visibleColumns, columnView.pins, WELL),
    [visibleColumns, columnView.pins],
  );
  const rowStyles = useMemo(
    () => columnStyles(visibleColumns, columnView.pins, CARD),
    [visibleColumns, columnView.pins],
  );
  /**
   * Enough room for every fixed column at its own width, so nothing squeezes
   * when the operator turns more of them on.
   *
   * The username column is the elastic one and is counted at the least it may
   * shrink to, not at the width it usually takes: counting its nominal 384
   * made the default eight columns overflow the card by twelve pixels and
   * raised a scroll rail over a table that fits.
   */
  const minWidth =
    SELECT_COL + ACTIONS_COL + visibleColumns.reduce((sum, c) => sum + (c.width ?? 240), 0);

  /**
   * A second horizontal rail above the heading, tied to the one under the
   * table.
   *
   * With a hundred rows on the page the only rail was at the far bottom, so
   * moving sideways meant scrolling down, dragging, and scrolling back. The
   * top one carries no content of its own: it is an empty strip as wide as the
   * table, and the two scroll positions are kept in step.
   */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [minWidth]);

  /** Guarded, or each nudge would bounce back off the other rail forever. */
  function mirror(from: HTMLDivElement | null, to: HTMLDivElement | null) {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }

  return (
    <Box
      style={{
        width: '100%',
        borderRadius: 10,
        overflow: 'clip',
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      {/* What this view is, in words: how much of the user is on screen, how
          narrowed it is, and what it is ordered by. Three facts an operator
          otherwise has to reconstruct from the header row. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderBottom: `1px solid ${HAIRLINE}`,
        }}
      >
        <Text style={{ ...MONO_LABEL, color: SNOW }}>
          {t('usersTable.viewColumns', {
            shown: visibleColumns.length,
            total: USER_COLUMNS.length,
          })}
        </Text>
        <Text style={{ ...MONO_LABEL }}>·</Text>
        <Text style={{ ...MONO_LABEL }}>
          {activeFilters === 0
            ? t('usersTable.viewNoFilters')
            : t('usersTable.viewFilters', { count: activeFilters })}
        </Text>
        <Text style={{ ...MONO_LABEL }}>·</Text>
        <Text style={{ ...MONO_LABEL }}>
          {t('usersTable.viewSortedBy', { column: t(`users.table.${sort === 'expireAt' ? 'expires' : sort === 'traffic' ? 'used' : 'username'}`) })}
        </Text>
        <Box style={{ flex: 1 }} />
        {selected.size > 0 && (
          <Text style={{ ...MONO_LABEL, color: SNOW }}>
            {t('usersTable.selectedCount', { count: selected.size })}
          </Text>
        )}
        {/* One button, three stages: it carries its own state in its icon so
            the row height is adjusted by looking rather than by remembering. */}
        <ToolButton
          title={t(`usersTable.density.${density}`)}
          onClick={cycleDensity}
          icon={
            density === 'compact' ? (
              <IconBaselineDensitySmall size={14} stroke={1.8} />
            ) : density === 'normal' ? (
              <IconBaselineDensityMedium size={14} stroke={1.8} />
            ) : (
              <IconBaselineDensityLarge size={14} stroke={1.8} />
            )
          }
        />
        <ToolButton
          title={t(fullscreen ? 'usersTable.exitFullscreen' : 'usersTable.fullscreen')}
          active={fullscreen}
          onClick={() => setFullscreen(!fullscreen)}
          icon={
            fullscreen ? (
              <IconArrowsMinimize size={14} stroke={1.8} />
            ) : (
              <IconArrowsMaximize size={14} stroke={1.8} />
            )
          }
        />
        <ColumnsPanel {...props} />
      </Box>

      {/* The only scroller in the panel that keeps a visible rail: sideways
          movement has no wheel axis, and with every column on there are three
          thousand pixels of table to the right of the fold. In full screen it
          takes the vertical axis too, so the heading can stay put above the
          rows instead of scrolling away with the page. */}
      {overflows && (
        <Box
          ref={railRef}
          className="table-scroll table-rail"
          onScroll={() => mirror(railRef.current, scrollerRef.current)}
          style={{ overflowX: 'auto', overflowY: 'hidden' }}
        >
          <Box style={{ width: minWidth, height: 1 }} />
        </Box>
      )}

      <Box
        ref={scrollerRef}
        className="table-scroll"
        onScroll={() => mirror(scrollerRef.current, railRef.current)}
        style={{
          overflowX: 'auto',
          ...(fullscreen ? { overflowY: 'auto', maxHeight: 'calc(100vh - 148px)' } : {}),
        }}
      >
        <Box style={{ minWidth }}>
          <Box
            style={{
              display: 'flex',
              width: '100%',
              padding: '10px 16px',
              backgroundColor: WELL,
              borderBottom: `1px solid ${HAIRLINE}`,
              ...(fullscreen ? { position: 'sticky', top: 0, zIndex: 4 } : {}),
            }}
          >
            <Box
              style={{
                width: SELECT_COL,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                position: 'sticky',
                left: 0,
                zIndex: 3,
                backgroundColor: WELL,
              }}
            >
              <SelectBox
                checked={allOnPage}
                onChange={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    for (const u of pagedUsers) {
                      if (allOnPage) next.delete(u.id);
                      else next.add(u.id);
                    }
                    return next;
                  })
                }
              />
            </Box>
            {visibleColumns.map((column, i) => (
              <HeadCell key={column.id} column={column} cellStyle={headStyles[i]!} {...props} />
            ))}
            {/* Three dots, not the word "actions": the heading of a column of
                icon buttons should not shout louder than the buttons. */}
            <Box
              style={{
                width: ACTIONS_COL,
                flexShrink: 0,
                textAlign: 'right',
                position: 'sticky',
                right: 0,
                zIndex: 3,
                backgroundColor: WELL,
              }}
            >
              <Text style={{ ...MONO_LABEL }}>···</Text>
            </Box>
          </Box>

          {/* Nothing at all and nothing that matched are different answers, so
              they get different screens: the first explains the list, the
              second only says the filter is too narrow. */}
          {pagedUsers.length === 0 &&
            (stats.total === 0 ? (
              <UsersEmpty openCreate={props.openCreate} />
            ) : (
              <Stack align="center" py={48} gap="xs">
                <ThemeIcon size={40} radius="md" variant="light" color="gray">
                  <IconUserOff size={22} />
                </ThemeIcon>
                <Text c="dimmed" size="sm">
                  {t('common.nothingFound')}
                </Text>
              </Stack>
            ))}

          {pagedUsers.map((u) => (
            <UserRow key={u.id} u={u} cellStyles={rowStyles} pad={pad} {...props} />
          ))}
        </Box>
      </Box>

      {totalUsers > 0 && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 14,
            padding: '12px 16px',
            backgroundColor: GROUND,
            borderTop: `1px solid ${HAIRLINE}`,
          }}
        >
          <Group gap={8}>
            <Text style={MONO_LABEL}>{t('usersTable.rowsPerPage')}</Text>
            <Select
              size="xs"
              value={String(rowsPerPage)}
              onChange={(v) => setRowsPerPage(Number(v) || 25)}
              data={['10', '25', '50', '100']}
              allowDeselect={false}
              w={72}
              styles={{
                input: {
                  backgroundColor: GROUND,
                  borderColor: HAIRLINE,
                  color: SNOW,
                  ...MONO,
                },
              }}
            />
          </Group>
          <Text style={{ ...MONO_LABEL, color: SNOW }}>
            {rangeStart}-{rangeEnd} {t('usersTable.of')} {totalUsers}
          </Text>
          <Group gap={4}>
            <ActionIcon
              variant="subtle"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{ color: safePage <= 1 ? MIST : SNOW }}
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{ color: safePage >= totalPages ? MIST : SNOW }}
            >
              <IconChevronRight size={16} />
            </ActionIcon>
          </Group>
        </Box>
      )}
    </Box>
  );
}

function ToolButton({
  title,
  icon,
  onClick,
  active,
}: {
  title: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <UnstyledButton
      title={title}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: active ? CYAN : MIST,
        backgroundColor: WELL,
        border: `1px solid ${active ? `${CYAN}55` : HAIRLINE}`,
      }}
    >
      {icon}
    </UnstyledButton>
  );
}
