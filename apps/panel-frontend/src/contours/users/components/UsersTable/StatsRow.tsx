import { SimpleGrid } from '@mantine/core';
import { AMBER, CYAN, MIST, MOSS, RED } from '@/contours/users/lib/colors';
import { IconCircleCheck, IconCircleMinus, IconCircleOff, IconClockHour4, IconUsers } from '@tabler/icons-react';
import { StatChip } from '@/contours/users/components/UsersTable/StatChip';
import { useTranslation } from 'react-i18next';
import type { UsersPageState } from '@/contours/users/screens/useUsersPage';

/**
 * Five counters that double as the status filter: clicking one narrows the
 * table to it, clicking it again clears the narrowing.
 */
export function StatsRow({
  stats,
  statusFilter,
  setStatusFilter,
}: Pick<UsersPageState, 'stats' | 'statusFilter' | 'setStatusFilter'>) {
  const { t } = useTranslation();

  return (
    <>
      {/* Stats row - clickable as filters */}
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
        <StatChip
          icon={<IconUsers size={20} />}
          label={t('common.all')}
          value={stats.total}
          accent={CYAN}
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <StatChip
          icon={<IconCircleCheck size={20} />}
          label={t('users.statChips.active')}
          value={stats.active}
          accent={MOSS}
          active={statusFilter === 'active'}
          onClick={() => setStatusFilter('active')}
        />
        <StatChip
          icon={<IconClockHour4 size={20} />}
          label={t('users.statChips.expired')}
          value={stats.expired}
          accent={RED}
          active={statusFilter === 'expired'}
          onClick={() => setStatusFilter('expired')}
        />
        <StatChip
          icon={<IconCircleMinus size={20} />}
          label={t('users.statChips.limited')}
          value={stats.limited}
          accent={AMBER}
          active={statusFilter === 'limited'}
          onClick={() => setStatusFilter('limited')}
        />
        <StatChip
          icon={<IconCircleOff size={20} />}
          label={t('users.statChips.disabled')}
          value={stats.disabled}
          accent={MIST}
          active={statusFilter === 'disabled'}
          onClick={() => setStatusFilter('disabled')}
        />
      </SimpleGrid>
    </>
  );
}
