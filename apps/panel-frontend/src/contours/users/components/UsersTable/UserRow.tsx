import { isRoutingPresetId } from '@/lib/domain/routingPresets';
import { ACTIONS_COL, SELECT_COL } from '@/contours/users/lib/usersTable';
import { AMBER, CARD, HAIRLINE, MIST, MOSS, RED, SNOW, VIOLET } from '@/contours/users/lib/colors';
import { DISPLAY, MONO } from '@/contours/users/lib/textStyles';
import { ActionIcon, Box, Menu, Text, Tooltip } from '@mantine/core';
import { COMPUTED_STATUS_ACCENT, computedStatus } from '@/contours/users/lib/userStatus';
import { IconBan, IconCopy, IconDotsVertical, IconEdit, IconExternalLink, IconRefresh, IconReload, IconRoute, IconTrash } from '@tabler/icons-react';
import { Pill } from '@/contours/users/components/UsersTable/Pill';
import { SelectBox } from '@/contours/users/components/UsersTable/SelectBox';
import { TrafficBar } from '@/contours/users/components/UsersTable/TrafficBar';
import { copyToClipboard } from '@/lib/ui/clipboard';
import { expireRelative, formatBytes, trafficPercent } from '@/contours/users/lib/userFormat';
import { presetKey } from '@/lib/domain/routingPresets';
import { subscriptionUrl } from '@/lib/domain/users';
import { useTranslation } from 'react-i18next';
import { SquadPill } from '@/contours/users/components/UsersTable/SquadPill';
import { relativeTime } from '@/lib/ui/relativeTime';
import type { CSSProperties, ReactNode } from 'react';
import type { User } from '@/lib/domain/users';
import type { UserColumnId } from '@/contours/users/lib/usersTable';
import type { UsersPageState } from '@/contours/users/screens/useUsersPage';

/**
 * One user as a table row: who they are, what they have spent, and the actions
 * that can be taken on them without leaving the list. Cells are emitted in the
 * order the column model declares, so the row can never drift out of step with
 * the heading above it.
 */
export function UserRow({
  u,
  cellStyles,
  pad,
  authStatusQuery,
  squadNameById,
  visibleColumns,
  handleRevoke,
  handleRotate,
  handleResetTraffic,
  handleDelete,
  setEditing,
  selected,
  toggleSelected,
}: { u: User; cellStyles: CSSProperties[]; pad: number } & Pick<UsersPageState, 'authStatusQuery' | 'squadNameById' | 'visibleColumns' | 'handleRevoke' | 'handleRotate' | 'handleResetTraffic' | 'handleDelete' | 'setEditing' | 'selected' | 'toggleSelected'>) {
  const { t } = useTranslation();

  const exp = expireRelative(u.expireAt, t);
  const trafficPct = trafficPercent(u.trafficUsedBytes, u.trafficLimitBytes);
  const trafficColor =
    trafficPct === null ? MOSS : trafficPct >= 90 ? RED : trafficPct >= 70 ? AMBER : MOSS;
  const compStatus = computedStatus(u);
  const statusAccent = COMPUTED_STATUS_ACCENT[compStatus];
  // A tint, not a fill: it should read as "this row needs you" out of the
  // corner of your eye and disappear otherwise.
  const rowTint =
    compStatus === 'expired' ? `${RED}0A` : compStatus === 'limited' ? `${AMBER}0A` : undefined;
  const isPaused = compStatus === 'limited' || compStatus === 'expired';
  const subUrl = subscriptionUrl(u.subscriptionToken, authStatusQuery.data?.panel);
  const otherSquads = u.groupIds.filter((id) => id !== '00000000-0000-0000-0000-000000000001');

  const cells: Record<UserColumnId, ReactNode> = {
    username: (
      <>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Box
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              flexShrink: 0,
              backgroundColor: statusAccent,
            }}
          />
          <Text style={{ ...DISPLAY, fontSize: 14, fontWeight: 500, lineHeight: '18px', color: SNOW }}>
            {u.username}
          </Text>
          {/* An override changes what this user gets without changing anything
              else in the row, so without a mark it is invisible until you open
              the form. */}
          {u.routingPreset && (
            <Box
              title={t('users.routingOverrideHint')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 18,
                paddingInline: 6,
                borderRadius: 5,
                backgroundColor: `${VIOLET}14`,
                border: `1px solid ${VIOLET}2E`,
              }}
            >
              <IconRoute size={10} stroke={2} color={VIOLET} />
              <Text style={{ ...MONO, fontSize: 10, lineHeight: '13px', color: VIOLET }}>
                {isRoutingPresetId(u.routingPreset)
                  ? t(`metadata.preset${presetKey(u.routingPreset)}`)
                  : u.routingPreset}
              </Text>
            </Box>
          )}
          {u.telegramId && (
            <Text style={{ ...MONO, fontSize: 12, lineHeight: '16px', color: MIST }}>
              {u.telegramId.startsWith('@') ? u.telegramId : `@${u.telegramId}`}
            </Text>
          )}
          {u.subRevokedAt && <Pill accent={RED}>{t('usersTable.revokedBadge')}</Pill>}
        </Box>
      </>
    ),
    // One line, always: the short id is 12 characters of base62 and wrapping it
    // made every second row taller than its neighbours.
    shortId: (
      <Text
        title={u.shortId}
        style={{
          ...MONO,
          fontSize: 12,
          lineHeight: '16px',
          color: MIST,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {u.shortId}
      </Text>
    ),
    status: <Pill accent={statusAccent}>{t(`userStatus.${compStatus}`)}</Pill>,
    // The node this user last connected through. The panel stores it
    // (UserTraffic.lastConnectedNodeId) but the list endpoint does not return
    // it, so the column stands empty rather than guessing.
    lastNode: (
      <Text
        title={t('usersTable.lastNodePending')}
        style={{ ...MONO, fontSize: 12, lineHeight: '16px', color: MIST }}
      >
        -
      </Text>
    ),
    expires: (
      <Tooltip label={u.expireAt ? new Date(u.expireAt).toLocaleString() : '-'}>
        <Text
          style={{
            ...DISPLAY,
            fontSize: 13,
            lineHeight: '16px',
            color:
              exp.tone === 'bad' ? RED : exp.tone === 'warn' ? AMBER : exp.tone === 'never' ? MIST : SNOW,
          }}
        >
          {exp.text}
        </Text>
      </Tooltip>
    ),
    used: (
      <>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isPaused ? (
            <>
              <Text
                style={{
                  ...MONO,
                  fontSize: 12,
                  lineHeight: '16px',
                  fontWeight: 600,
                  color: compStatus === 'expired' ? RED : AMBER,
                }}
              >
                {t('usersTable.paused')}
              </Text>
              <Box style={{ flex: 1 }} />
              <Text style={{ ...MONO, fontSize: 12, lineHeight: '16px', color: MIST }}>
                {compStatus === 'expired'
                  ? t('usersTable.pausedHintExpired')
                  : t('usersTable.pausedHintQuota')}
              </Text>
            </>
          ) : (
            <>
              <Text style={{ ...MONO, fontSize: 12, lineHeight: '16px', color: SNOW }}>
                {formatBytes(u.trafficUsedBytes)}
              </Text>
              <Text style={{ ...MONO, fontSize: 12, lineHeight: '16px', color: MIST }}>
                / {u.trafficLimitBytes === null ? '∞' : formatBytes(u.trafficLimitBytes)}
              </Text>
            </>
          )}
        </Box>
        <TrafficBar
          percent={isPaused ? 100 : (trafficPct ?? 0)}
          color={isPaused ? (compStatus === 'expired' ? RED : AMBER) : trafficColor}
        />
      </>
    ),
    usedPct: (
      <Text
        style={{
          ...MONO,
          fontSize: 12,
          lineHeight: '16px',
          fontWeight: trafficPct === null ? 400 : 600,
          color: trafficPct === null ? MIST : trafficColor,
        }}
      >
        {trafficPct === null ? '-' : `${trafficPct.toFixed(1)}%`}
      </Text>
    ),
    limit: (
      <Text style={{ ...MONO, fontSize: 12, lineHeight: '16px', color: MIST }}>
        {u.trafficLimitBytes === null ? '∞' : formatBytes(u.trafficLimitBytes)}
      </Text>
    ),
    squads: (
      <Box style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {otherSquads.length === 0 ? (
          <SquadPill muted>All</SquadPill>
        ) : (
          <>
            {otherSquads.slice(0, 2).map((id) => (
              <SquadPill key={id}>{squadNameById.get(id) ?? id.slice(0, 6)}</SquadPill>
            ))}
            {otherSquads.length > 2 && <SquadPill muted>+{otherSquads.length - 2}</SquadPill>}
          </>
        )}
      </Box>
    ),
    tag: <Plain>{u.tag ?? '-'}</Plain>,
    description: <Plain title={u.description ?? undefined}>{u.description ?? '-'}</Plain>,
    telegramId: <Plain>{u.telegramId ?? '-'}</Plain>,
    email: <Plain title={u.email ?? undefined}>{u.email ?? '-'}</Plain>,
    subLink: <Plain title={subUrl}>{subUrl}</Plain>,
    routing: (
      <Plain>
        {u.routingPreset
          ? isRoutingPresetId(u.routingPreset)
            ? t(`metadata.preset${presetKey(u.routingPreset)}`)
            : u.routingPreset
          : t('userDrawer.inheritsSquad')}
      </Plain>
    ),
    deviceLimit: <Plain>{u.hwidDeviceLimit ?? '∞'}</Plain>,
    // The panel stores when this user first connected (UserTraffic
    // .firstConnectedAt) but the list endpoint does not return it.
    firstConnected: <Plain title={t('usersTable.firstConnectedPending')}>-</Plain>,
    lastOnline: <Plain>{relativeTime(u.lastOnlineAt, t).text}</Plain>,
    trafficReset: <Plain>{u.lastTrafficResetAt ? shortDate(u.lastTrafficResetAt) : '-'}</Plain>,
    lifetimeUsed: <Plain>{formatBytes(u.lifetimeTrafficBytes)}</Plain>,
    linkRevoked: (
      <Plain color={u.subRevokedAt ? RED : undefined}>
        {u.subRevokedAt ? shortDate(u.subRevokedAt) : '-'}
      </Plain>
    ),
    created: <Plain>{shortDate(u.createdAt)}</Plain>,
    uuid: <Plain title={u.id}>{u.id}</Plain>,
  };

  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        padding: `${pad}px 16px`,
        backgroundColor: rowTint,
        borderBottom: `1px solid ${HAIRLINE}`,
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
          backgroundColor: rowTint ?? CARD,
        }}
      >
        <SelectBox checked={selected.has(u.id)} onChange={() => toggleSelected(u.id)} />
      </Box>

      {visibleColumns.map((column, i) => (
        <Box
          key={column.id}
          style={{
            ...cellStyles[i],
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            paddingInline: 10,
          }}
        >
          {cells[column.id]}
        </Box>
      ))}

      <Box
        style={{
          width: ACTIONS_COL,
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'flex-end',
          position: 'sticky',
          right: 0,
          zIndex: 3,
          backgroundColor: rowTint ?? CARD,
        }}
      >
        <Menu shadow="md" position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" size="sm" style={{ color: MIST }}>
              <IconDotsVertical size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
            <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => copyToClipboard(subUrl)}>
              {t('usersTable.actionCopySubUrl')}
            </Menu.Item>
            <Menu.Item
              leftSection={<IconExternalLink size={14} />}
              component="a"
              href={subUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('usersTable.actionOpenSub')}
            </Menu.Item>
            <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEditing(u)}>
              {t('usersTable.actionEdit')}
            </Menu.Item>
            <Menu.Item leftSection={<IconRefresh size={14} />} onClick={() => handleRotate(u)}>
              {t('usersTable.actionRotate')}
            </Menu.Item>
            <Menu.Item leftSection={<IconReload size={14} />} onClick={() => handleResetTraffic(u)}>
              {t('usersTable.actionResetTraffic')}
            </Menu.Item>
            <Menu.Item color="red" leftSection={<IconBan size={14} />} onClick={() => handleRevoke(u)}>
              {t('usersTable.actionRevoke')}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => handleDelete(u)}>
              {t('usersTable.actionDelete')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Box>
    </Box>
  );
}

/** The default shape of a cell: one muted mono line that never wraps. */
function Plain({
  children,
  title,
  color,
}: {
  children: ReactNode;
  title?: string;
  color?: string;
}) {
  return (
    <Text
      title={title}
      style={{
        ...MONO,
        fontSize: 12,
        lineHeight: '16px',
        color: color ?? MIST,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Text>
  );
}

/** "10 Sept 2026", the same shape the expiry picker prints. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
