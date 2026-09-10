import { ACTIONS_COL, SELECT_COL, USER_COLUMNS, USER_COLUMNS_TOTAL } from '@/contours/users/lib/usersTable';
import { UserRow } from '@/contours/users/components/UsersTable/UserRow';
import { ActionIcon, ThemeIcon } from '@mantine/core';
import { CARD, GROUND, HAIRLINE, MIST, SNOW, WELL } from '@/contours/users/lib/colors';
import { MONO } from '@/contours/users/lib/textStyles';
import { Box, Group, Select, Stack, Text } from '@mantine/core';
import { HeadCell } from '@/contours/users/components/UsersTable/HeadCell';
import { IconChevronLeft, IconChevronRight, IconUserOff } from '@tabler/icons-react';
import { MONO_LABEL } from '@/contours/users/lib/textStyles';
import { SelectBox } from '@/contours/users/components/UsersTable/SelectBox';
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
  | 'setStatusFilter' | 'selected' | 'setSelected' | 'toggleSelected' | 'activeFilters'>) {
  const { t } = useTranslation();
  const {
    pagedUsers, totalUsers, stats, totalPages, safePage, rangeStart, rangeEnd,
    setPage, rowsPerPage, setRowsPerPage, sort, activeFilters, selected, setSelected,
  } = props;

  const allOnPage = pagedUsers.length > 0 && pagedUsers.every((u) => selected.has(u.id));

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
          {t('usersTable.viewColumns', { shown: USER_COLUMNS.length, total: USER_COLUMNS_TOTAL })}
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
      </Box>

      <Box style={{ overflowX: 'auto' }}>
        <Box style={{ minWidth: 1300 }}>
          <Box
            style={{
              display: 'flex',
              width: '100%',
              padding: '10px 16px',
              backgroundColor: WELL,
              borderBottom: `1px solid ${HAIRLINE}`,
            }}
          >
            <Box style={{ width: SELECT_COL, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
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
            {USER_COLUMNS.map((column) => (
              <HeadCell key={column.id} column={column} {...props} />
            ))}
            {/* Three dots, not the word "actions": the heading of a column of
                icon buttons should not shout louder than the buttons. */}
            <Box style={{ width: ACTIONS_COL, flexShrink: 0, textAlign: 'right' }}>
              <Text style={{ ...MONO_LABEL }}>···</Text>
            </Box>
          </Box>

          {pagedUsers.length === 0 && (
            <Stack align="center" py={48} gap="xs">
              <ThemeIcon size={40} radius="md" variant="light" color="gray">
                <IconUserOff size={22} />
              </ThemeIcon>
              <Text c="dimmed" size="sm">
                {stats.total === 0 ? t('users.empty') : t('common.nothingFound')}
              </Text>
            </Stack>
          )}

          {pagedUsers.map((u) => (
            <UserRow key={u.id} u={u} {...props} />
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
