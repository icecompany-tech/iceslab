import { UserRow } from '@/contours/users/components/UsersTable/UserRow';
import { ActionIcon, ThemeIcon } from '@mantine/core';
import { CARD, GROUND, HAIRLINE, MIST, SNOW } from '@/contours/users/lib/colors';
import { MONO } from '@/contours/users/lib/textStyles';
import { Box, Group, Select, Stack, Text } from '@mantine/core';
import { COL } from '@/contours/users/lib/usersTable';
import { HeadCell } from '@/contours/users/components/UsersTable/HeadCell';
import { IconChevronLeft, IconChevronRight, IconUserOff } from '@tabler/icons-react';
import { MONO_LABEL } from '@/contours/users/lib/textStyles';
import { useTranslation } from 'react-i18next';
import type { UsersPageState } from '@/contours/users/screens/useUsersPage';

/**
 * The table itself: the header lane, one row per user, and the pager under
 * it. Column widths are fixed so rows never dance as data changes.
 */
export function UsersTable({
  toggleSort,
  authStatusQuery,
  squadNameById,
  pagedUsers,
  totalUsers,
  stats,
  totalPages,
  safePage,
  rangeStart,
  rangeEnd,
  handleRevoke,
  handleRotate,
  handleResetTraffic,
  handleDelete,
  setEditing,
  setPage,
  rowsPerPage,
  setRowsPerPage,
  sort,
  order,
}: Pick<UsersPageState, 'toggleSort' | 'authStatusQuery' | 'squadNameById' | 'pagedUsers' | 'totalUsers' | 'stats' | 'totalPages' | 'safePage' | 'rangeStart' | 'rangeEnd' | 'handleRevoke' | 'handleRotate' | 'handleResetTraffic' | 'handleDelete' | 'setEditing' | 'setPage' | 'rowsPerPage' | 'setRowsPerPage' | 'sort' | 'order'>) {
  const { t } = useTranslation();

  return (
    <>
      {/* Table. Fixed column widths rather than auto-layout: every row must
          land in the same vertical lanes, otherwise one long username shifts
          the traffic bars for that row only and the column stops reading as a
          column. Username takes the slack. */}
      <Box
        style={{
          width: '100%',
          borderRadius: 8,
          overflow: 'clip',
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box style={{ overflowX: 'auto' }}>
          <Box style={{ minWidth: 1100 }}>
            <Box
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: `1px solid ${HAIRLINE}`,
              }}
            >
              <HeadCell
                grow
                label={t('users.table.username')}
                col="username"
                sort={sort}
                order={order}
                onSort={toggleSort}
              />
              <HeadCell width={COL.status} label={t('users.table.status')} />
              <HeadCell width={COL.lastOnline} label={t('users.table.lastOnline')} />
              <HeadCell
                width={COL.expires}
                label={t('users.table.expires')}
                col="expireAt"
                sort={sort}
                order={order}
                onSort={toggleSort}
              />
              <HeadCell
                width={COL.traffic}
                label={t('users.table.traffic')}
                col="traffic"
                sort={sort}
                order={order}
                onSort={toggleSort}
              />
              <HeadCell width={COL.squads} label={t('users.table.squads')} />
              <HeadCell width={COL.tag} label={t('users.table.tag')} />
              {/* Three dots, not the word "actions": the header of a column of
                  icon buttons should not shout louder than the buttons. */}
              <Box style={{ width: COL.actions, flexShrink: 0, textAlign: 'right' }}>
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
              <UserRow
                key={u.id}
                u={u}
                authStatusQuery={authStatusQuery}
                squadNameById={squadNameById}
                handleRevoke={handleRevoke}
                handleRotate={handleRotate}
                handleResetTraffic={handleResetTraffic}
                handleDelete={handleDelete}
                setEditing={setEditing}
              />
            ))}
          </Box>
        </Box>

        {totalUsers > 0 && (
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 20,
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
    </>
  );
}

