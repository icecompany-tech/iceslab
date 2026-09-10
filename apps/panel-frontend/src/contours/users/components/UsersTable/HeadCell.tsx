import { IconArrowsSort, IconDotsVertical as IconMenu, IconSortAscending } from '@tabler/icons-react';
import { Box, Menu, Text, UnstyledButton } from '@mantine/core';
import { CYAN, HAIRLINE, MIST, SNOW, WELL } from '@/contours/users/lib/colors';
import { MONO_LABEL } from '@/contours/users/lib/textStyles';
import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import type { UserColumn } from '@/contours/users/lib/usersTable';
import type { UsersPageState } from '@/contours/users/screens/useUsersPage';

/**
 * One column heading: what it holds, how it is sorted, and the box that
 * narrows it. Two rows rather than one, because the filter belongs to the
 * column and not to a bar somewhere above the table.
 */
export function HeadCell({
  column,
  cellStyle,
  sort,
  order,
  toggleSort,
  colFilters,
  setColFilter,
  statusFilter,
  setStatusFilter,
}: { column: UserColumn; cellStyle: CSSProperties } & Pick<
  UsersPageState,
  'sort' | 'order' | 'toggleSort' | 'colFilters' | 'setColFilter' | 'statusFilter' | 'setStatusFilter'
>) {
  const { t } = useTranslation();
  const active = column.sort !== undefined && sort === column.sort;

  return (
    <Box
      style={{
        ...cellStyle,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        paddingInline: 10,
        borderLeft: `1px solid ${HAIRLINE}`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text
          style={{
            ...MONO_LABEL,
            flex: 1,
            minWidth: 0,
            color: active ? SNOW : MIST,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {t(`users.table.${column.label}`)}
        </Text>
        {column.sort && (
          <UnstyledButton
            onClick={() => toggleSort(column.sort!)}
            title={t('usersTable.sortBy')}
            style={{ display: 'flex', color: active ? CYAN : MIST, flexShrink: 0 }}
          >
            {active ? (
              <IconSortAscending
                size={11}
                stroke={2}
                style={{ transform: order === 'desc' ? 'scaleY(-1)' : undefined }}
              />
            ) : (
              <IconArrowsSort size={11} stroke={2} />
            )}
          </UnstyledButton>
        )}
        <ColumnMenu column={column} toggleSort={toggleSort} />
      </Box>

      <FilterBox
        column={column}
        colFilters={colFilters}
        setColFilter={setColFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
      />
    </Box>
  );
}

function ColumnMenu({
  column,
  toggleSort,
}: { column: UserColumn } & Pick<UsersPageState, 'toggleSort'>) {
  const { t } = useTranslation();
  return (
    <Menu position="bottom-end" width={190} shadow="md">
      <Menu.Target>
        <UnstyledButton style={{ display: 'flex', color: MIST, flexShrink: 0 }}>
          <IconMenu size={12} stroke={2} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown style={{ backgroundColor: WELL, borderColor: HAIRLINE }}>
        {column.sort ? (
          <>
            <Menu.Item onClick={() => toggleSort(column.sort!)}>{t('usersTable.sortAsc')}</Menu.Item>
            <Menu.Item onClick={() => toggleSort(column.sort!)}>
              {t('usersTable.sortDesc')}
            </Menu.Item>
          </>
        ) : (
          <Menu.Item disabled>{t('usersTable.sortUnavailable')}</Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * The filter under a heading, drawn only where the list endpoint can actually
 * narrow by that field.
 *
 * The first cut drew a greyed-out box under every column and explained itself
 * on hover. That was the wrong call: a box shaped like an input that refuses
 * text reads as broken, and nobody hovers a control they think is dead. A
 * column that cannot be filtered now shows nothing at all, and the slot is
 * held open so the headings above stay on one lane.
 */
function FilterBox({
  column,
  colFilters,
  setColFilter,
  statusFilter,
  setStatusFilter,
}: { column: UserColumn } & Pick<
  UsersPageState,
  'colFilters' | 'setColFilter' | 'statusFilter' | 'setStatusFilter'
>) {
  const { t } = useTranslation();

  const shell = {
    height: 28,
    display: 'flex',
    alignItems: 'center',
    paddingInline: 9,
    borderRadius: 6,
    backgroundColor: WELL,
    border: `1px solid ${HAIRLINE}`,
  };

  if (column.filter === 'status') {
    return (
      <Box
        component="select"
        value={statusFilter}
        onChange={(e: { currentTarget: { value: string } }) =>
          setStatusFilter(e.currentTarget.value as typeof statusFilter)
        }
        style={{
          ...shell,
          ...MONO_LABEL,
          color: statusFilter === 'all' ? MIST : SNOW,
          appearance: 'none',
          outline: 'none',
          width: '100%',
        }}
      >
        <option value="all">{t('usersTable.filterBy')}</option>
        <option value="active">{t('users.statChips.active')}</option>
        <option value="expired">{t('users.statChips.expired')}</option>
        <option value="limited">{t('users.statChips.limited')}</option>
        <option value="disabled">{t('users.statChips.disabled')}</option>
      </Box>
    );
  }

  if (column.filter === 'search') {
    return (
      <Box style={shell}>
        <input
          value={colFilters[column.id] ?? ''}
          onChange={(e) => setColFilter(column.id, e.currentTarget.value)}
          placeholder={t('usersTable.filterBy')}
          style={{
            ...MONO_LABEL,
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: SNOW,
          }}
        />
      </Box>
    );
  }

  return <Box style={{ height: 28, flexShrink: 0 }} />;
}
