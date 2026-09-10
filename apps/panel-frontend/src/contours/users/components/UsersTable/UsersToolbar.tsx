import { ROUTING_PRESET_IDS } from '@/lib/domain/routingPresets';
import { Popover } from '@mantine/core';
import { Box, Select, Stack, UnstyledButton } from '@mantine/core';
import { CARD, CYAN, HAIRLINE, MIST } from '@/contours/users/lib/colors';
import { IconFilter, IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react';
import { MONO_LABEL } from '@/contours/users/lib/textStyles';
import { Toolbar, ToolbarButton, ToolbarIconButton, ToolbarSearch } from '@/ui/Toolbar';
import { presetKey } from '@/lib/domain/routingPresets';
import { useTranslation } from 'react-i18next';
import type { UsersPageState } from '@/contours/users/screens/useUsersPage';

/**
 * Search, the filter popover and the one button that makes a user. Status
 * is filtered by the stat chips above, not here.
 */
export function UsersToolbar({
  qc,
  activeFilters,
  usersQuery,
  squadsQuery,
  knownTags,
  search,
  setSearch,
  squadFilter,
  setSquadFilter,
  tagFilter,
  setTagFilter,
  routingFilter,
  setRoutingFilter,
  openCreate,
}: Pick<UsersPageState, 'qc' | 'activeFilters' | 'usersQuery' | 'squadsQuery' | 'knownTags' | 'search' | 'setSearch' | 'squadFilter' | 'setSquadFilter' | 'tagFilter' | 'setTagFilter' | 'routingFilter' | 'setRoutingFilter' | 'openCreate'>) {
  const { t } = useTranslation();

  return (
    <>
      {/* Search + actions (status filtering is driven by the stat chips above) */}
      <Toolbar>
        <ToolbarSearch
          value={search}
          onChange={setSearch}
          placeholder={t('users.searchPlaceholder')}
          leftSection={<IconSearch size={16} color={MIST} />}
        />
        <Popover position="bottom-end" withinPortal shadow="md" width={280}>
          <Popover.Target>
            <Box>
              <ToolbarButton
                icon={<IconFilter size={15} stroke={1.7} />}
                label={t('users.filters.button')}
                badge={activeFilters || undefined}
              />
            </Box>
          </Popover.Target>
          <Popover.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
            <Stack gap="sm">
              <Select
                label={t('users.filters.squad')}
                placeholder={t('users.filters.anySquad')}
                value={squadFilter}
                onChange={setSquadFilter}
                clearable
                data={(squadsQuery.data?.squads ?? []).map((s) => ({ value: s.id, label: s.name }))}
              />
              <Select
                label={t('users.filters.tag')}
                placeholder={t('users.filters.anyTag')}
                value={tagFilter}
                onChange={setTagFilter}
                clearable
                searchable
                data={knownTags}
              />
              {/* `any` and `none` are questions about the presence of an
                  override, which is what an operator actually asks before
                  asking which preset. A concrete id pins to that preset. */}
              <Select
                label={t('users.filters.routing')}
                placeholder={t('users.filters.anyRouting')}
                value={routingFilter}
                onChange={setRoutingFilter}
                clearable
                data={[
                  { value: 'any', label: t('users.filters.routingAny') },
                  { value: 'none', label: t('users.filters.routingNone') },
                  ...ROUTING_PRESET_IDS.map((id) => ({
                    value: id,
                    label: t(`metadata.preset${presetKey(id)}`),
                  })),
                ]}
              />
              {activeFilters > 0 && (
                <UnstyledButton
                  onClick={() => {
                    setSquadFilter(null);
                    setTagFilter(null);
                    setRoutingFilter(null);
                  }}
                  style={{ ...MONO_LABEL, color: CYAN, alignSelf: 'flex-start' }}
                >
                  {t('users.filters.clear')}
                </UnstyledButton>
              )}
            </Stack>
          </Popover.Dropdown>
        </Popover>
        <ToolbarIconButton
          icon={<IconRefresh size={16} />}
          title={t('common.refresh')}
          loading={usersQuery.isFetching}
          onClick={() => qc.invalidateQueries({ queryKey: ['users'] })}
        />
        <ToolbarButton
          icon={<IconPlus size={14} stroke={2.4} />}
          label={t('users.create')}
          onClick={openCreate}
          primary
        />
      </Toolbar>
    </>
  );
}
