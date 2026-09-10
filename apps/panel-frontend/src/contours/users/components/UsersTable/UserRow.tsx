import { isRoutingPresetId } from '@/lib/domain/routingPresets';
import { AMBER, CARD, HAIRLINE, MIST, MOSS, RED, SNOW, VIOLET } from '@/contours/users/lib/colors';
import { DISPLAY, MONO } from '@/contours/users/lib/textStyles';
import { ActionIcon, Box, Menu, Stack, Text, Tooltip } from '@mantine/core';
import { COL } from '@/contours/users/lib/usersTable';
import { COMPUTED_STATUS_ACCENT, computedStatus } from '@/contours/users/lib/userStatus';
import { IconBan, IconCopy, IconDotsVertical, IconEdit, IconExternalLink, IconRefresh, IconReload, IconRoute, IconTrash } from '@tabler/icons-react';
import { Pill } from '@/contours/users/components/UsersTable/Pill';
import { SquadPill } from '@/contours/users/components/UsersTable/SquadPill';
import { TrafficBar } from '@/contours/users/components/UsersTable/TrafficBar';
import { copyToClipboard } from '@/lib/ui/clipboard';
import { expireRelative, formatBytes, trafficPercent } from '@/contours/users/lib/userFormat';
import { presetKey } from '@/lib/domain/routingPresets';
import { relativeTime } from '@/lib/ui/relativeTime';
import { subscriptionUrl } from '@/lib/domain/users';
import { useTranslation } from 'react-i18next';
import type { User } from '@/lib/domain/users';
import type { UsersPageState } from '@/contours/users/screens/useUsersPage';

/**
 * One user as a table row: who they are, what they may reach, what they have
 * spent, and the actions that can be taken on them without leaving the list.
 */
export function UserRow({
  u,
  authStatusQuery,
  squadNameById,
  handleRevoke,
  handleRotate,
  handleResetTraffic,
  handleDelete,
  setEditing,
}: { u: User } & Pick<UsersPageState, 'authStatusQuery' | 'squadNameById' | 'handleRevoke' | 'handleRotate' | 'handleResetTraffic' | 'handleDelete' | 'setEditing'>) {
  const { t } = useTranslation();

                const last = relativeTime(u.lastOnlineAt, t);
                const exp = expireRelative(u.expireAt, t);
                const trafficPct = trafficPercent(u.trafficUsedBytes, u.trafficLimitBytes);
                const trafficColor =
                  trafficPct === null
                    ? MOSS
                    : trafficPct >= 90
                      ? RED
                      : trafficPct >= 70
                        ? AMBER
                        : MOSS;
                const compStatus = computedStatus(u);
                const statusAccent = COMPUTED_STATUS_ACCENT[compStatus];
                // A tint, not a fill: it should be readable as "this row needs
                // you" out of the corner of your eye and disappear otherwise.
                const rowTint =
                  compStatus === 'expired'
                    ? `${RED}0A`
                    : compStatus === 'limited'
                      ? `${AMBER}0A`
                      : undefined;
                const isPaused = compStatus === 'limited' || compStatus === 'expired';
                const otherSquads = u.groupIds.filter(
                  (id) => id !== '00000000-0000-0000-0000-000000000001',
                );
                const subUrl = subscriptionUrl(u.subscriptionToken, authStatusQuery.data?.panel);

                return (
                  <Box
                    key={u.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '14px 16px',
                      backgroundColor: rowTint,
                      borderBottom: `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <Box
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <Stack gap={2}>
                        <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Text
                            style={{ ...DISPLAY, fontSize: 14, fontWeight: 500, lineHeight: '18px', color: SNOW }}
                          >
                            {u.username}
                          </Text>
                          {/* An override changes what this user gets without
                              changing anything else in the row, so without a
                              mark it is invisible until you open the drawer. */}
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
                        </Box>
                        <Text style={{ ...MONO, fontSize: 12, lineHeight: '16px', color: MIST }}>
                          {u.shortId}
                          {u.telegramId ? ` · ${u.telegramId.startsWith('@') ? u.telegramId : '@' + u.telegramId}` : ''}
                        </Text>
                      </Stack>
                    </Box>

                    <Box style={{ width: COL.status, flexShrink: 0, display: 'flex', gap: 4 }}>
                      <Pill accent={statusAccent}>{t(`userStatus.${compStatus}`)}</Pill>
                      {u.subRevokedAt && <Pill accent={RED}>{t('usersTable.revokedBadge')}</Pill>}
                    </Box>

                    <Box style={{ width: COL.lastOnline, flexShrink: 0 }}>
                      <Tooltip
                        label={u.lastOnlineAt ? new Date(u.lastOnlineAt).toLocaleString() : '-'}
                      >
                        <Text
                          style={{
                            ...DISPLAY,
                            fontSize: 13,
                            lineHeight: '16px',
                            color:
                              last.tone === 'fresh' ? MOSS : last.tone === 'never' ? MIST : SNOW,
                          }}
                        >
                          {last.text}
                        </Text>
                      </Tooltip>
                    </Box>

                    <Box style={{ width: COL.expires, flexShrink: 0 }}>
                      <Tooltip label={u.expireAt ? new Date(u.expireAt).toLocaleString() : '-'}>
                        <Text
                          style={{
                            ...DISPLAY,
                            fontSize: 13,
                            lineHeight: '16px',
                            color:
                              exp.tone === 'bad'
                                ? RED
                                : exp.tone === 'warn'
                                  ? AMBER
                                  : exp.tone === 'never'
                                    ? MIST
                                    : SNOW,
                          }}
                        >
                          {exp.text}
                        </Text>
                      </Tooltip>
                    </Box>

                    <Box
                      style={{
                        width: COL.traffic,
                        flexShrink: 0,
                        paddingRight: 28,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                      }}
                    >
                      <Box
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        {isPaused ? (
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
                        ) : (
                          <Box style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Text style={{ ...MONO, fontSize: 12, lineHeight: '16px', color: SNOW }}>
                              {formatBytes(u.trafficUsedBytes)}
                            </Text>
                            <Text style={{ ...MONO, fontSize: 12, lineHeight: '16px', color: MIST }}>
                              /{' '}
                              {u.trafficLimitBytes === null ? '∞' : formatBytes(u.trafficLimitBytes)}
                            </Text>
                          </Box>
                        )}
                        {isPaused ? (
                          <Text style={{ ...MONO, fontSize: 12, lineHeight: '16px', color: MIST }}>
                            {compStatus === 'expired'
                              ? t('usersTable.pausedHintExpired')
                              : t('usersTable.pausedHintQuota')}
                          </Text>
                        ) : trafficPct !== null ? (
                          <Text
                            style={{
                              ...MONO,
                              fontSize: 12,
                              lineHeight: '16px',
                              fontWeight: 600,
                              color: trafficColor,
                            }}
                          >
                            {trafficPct.toFixed(0)}%
                          </Text>
                        ) : null}
                      </Box>
                      <TrafficBar
                        percent={isPaused ? 100 : (trafficPct ?? 0)}
                        color={isPaused ? (compStatus === 'expired' ? RED : AMBER) : trafficColor}
                      />
                    </Box>

                    <Box
                      style={{ width: COL.squads, flexShrink: 0, display: 'flex', gap: 4, alignItems: 'center' }}
                    >
                      {otherSquads.length === 0 ? (
                        <SquadPill muted>All</SquadPill>
                      ) : (
                        <>
                          {otherSquads.slice(0, 2).map((id) => (
                            <SquadPill key={id}>{squadNameById.get(id) ?? id.slice(0, 6)}</SquadPill>
                          ))}
                          {otherSquads.length > 2 && (
                            <SquadPill muted>+{otherSquads.length - 2}</SquadPill>
                          )}
                        </>
                      )}
                    </Box>

                    <Box style={{ width: COL.tag, flexShrink: 0 }}>
                      <Text style={{ ...MONO, fontSize: 12, lineHeight: '16px', color: MIST }}>
                        {u.tag ?? '-'}
                      </Text>
                    </Box>

                    <Box
                      style={{
                        width: COL.actions,
                        flexShrink: 0,
                        display: 'flex',
                        justifyContent: 'flex-end',
                      }}
                    >
                      <Menu shadow="md" position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" size="sm" style={{ color: MIST }}>
                            <IconDotsVertical size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
                          <Menu.Item
                            leftSection={<IconCopy size={14} />}
                            onClick={() => copyToClipboard(subUrl)}
                          >
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
                          <Menu.Item
                            leftSection={<IconRefresh size={14} />}
                            onClick={() => handleRotate(u)}
                          >
                            {t('usersTable.actionRotate')}
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconReload size={14} />}
                            onClick={() => handleResetTraffic(u)}
                          >
                            {t('usersTable.actionResetTraffic')}
                          </Menu.Item>
                          <Menu.Item
                            color="red"
                            leftSection={<IconBan size={14} />}
                            onClick={() => handleRevoke(u)}
                          >
                            {t('usersTable.actionRevoke')}
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={() => handleDelete(u)}
                          >
                            {t('usersTable.actionDelete')}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Box>
                  </Box>
                );
}
