import { AMBER, CARD, CYAN, DISPLAY, FAINT, HAIRLINE, MIST, MONO, MOSS, WELL } from '@/contours/nodes/lib/colors';
import { BoltIcon, EyeIcon, InfoIcon } from '@/contours/nodes/components/NodeCreate/icons';
import { Box, Stack, Text } from '@mantine/core';
import { Chip } from '@/contours/nodes/components/NodeCreate/Chip';
import { DEFAULT_NODE_PORT } from '@/contours/nodes/lib/nodeProtocols';
import { HostGroup, HostRow } from '@/contours/nodes/components/NodeCreate/HostGroup';
import { SummaryRow } from '@/contours/nodes/components/NodeCreate/SummaryRow';
import { hardeningSummary, profileMeta } from '@/contours/nodes/lib/nodeInstall';
import { protocolLabel } from '@/lib/domain/protocols';
import { useTranslation } from 'react-i18next';
import type { useNodeCreateForm } from '@/contours/nodes/components/NodeCreate/useNodeCreateForm';

type Wizard = ReturnType<typeof useNodeCreateForm>;

/**
 * Step two: which profiles this node will serve, split into what it can and
 * cannot run, with the port each binding would take.
 */
export function StepHosts({
  form,
  selected,
  groupOpen,
  setGroupOpen,
  profilesQuery,
  groups,
  portByProfile,
  toggle,
  toggleAllCan,
}: Pick<Wizard, 'form' | 'selected' | 'groupOpen' | 'setGroupOpen' | 'profilesQuery' | 'groups' | 'portByProfile' | 'toggle' | 'toggleAllCan'>) {
  const { t } = useTranslation();

  return (
        <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0 }}>
            <Stack
              gap={14}
              style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
            >
              <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                <BoltIcon size={15} color={CYAN} />
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: MIST,
                  }}
                >
                  {t('nodeCreate.attachTitle')}
                </Text>
                <Chip color={CYAN}>{t('nodeCreate.selectedCount', { count: selected.length })}</Chip>
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT, flex: 1, minWidth: 0 }}>
                  {t('nodeCreate.attachHint')}
                </Text>
              </Box>

              {profilesQuery.isLoading && (
                <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: MIST }}>{t('common.loading')}</Text>
              )}

              {groups.can.length > 0 && (
                <HostGroup
                  accent={MOSS}
                  chip={t('nodeCreate.canAttach')}
                  chipColor={MOSS}
                  hint={t('nodeCreate.canAttachHint', { protocol: protocolLabel(form.values.protocol) })}
                  count={`${groups.can.filter((p) => selected.includes(p.id)).length}/${groups.can.length}`}
                  open={groupOpen.can}
                  onToggleOpen={() => setGroupOpen((s) => ({ ...s, can: !s.can }))}
                  allChecked={groups.can.length > 0 && groups.can.every((p) => selected.includes(p.id))}
                  onToggleAll={toggleAllCan}
                >
                  {groups.can.map((p) => {
                    const checked = selected.includes(p.id);
                    return (
                      <HostRow
                        key={p.id}
                        selectable
                        checked={checked}
                        onClick={() => toggle(p.id)}
                        name={p.name}
                        meta={profileMeta(p)}
                        trailing={
                          checked ? (
                            <Chip>{t('nodeCreate.portChip', { port: portByProfile.get(p.id) })}</Chip>
                          ) : null
                        }
                      />
                    );
                  })}
                </HostGroup>
              )}

              {groups.cannot.length > 0 && (
                <HostGroup
                  accent={AMBER}
                  chip={t('nodeCreate.cannotAttach')}
                  chipColor={AMBER}
                  hint={t('nodeCreate.cannotAttachHint')}
                  count={`0/${groups.cannot.length}`}
                  open={groupOpen.cannot}
                  onToggleOpen={() => setGroupOpen((s) => ({ ...s, cannot: !s.cannot }))}
                >
                  {groups.cannot.map(({ profile: p, reason }) => (
                    <HostRow
                      key={p.id}
                      checked={false}
                      name={p.name}
                      meta={profileMeta(p)}
                      trailing={<Chip color={AMBER}>{reason}</Chip>}
                    />
                  ))}
                </HostGroup>
              )}
            </Stack>
          </Box>

          {/* What the button will actually do, spelled out before it is
              pressed. Nothing here has touched the VPS yet. */}
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 520, flexShrink: 0 }}>
            <Stack
              gap={14}
              style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
            >
              <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <EyeIcon size={15} color={CYAN} />
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: MIST,
                  }}
                >
                  {t('nodeCreate.summaryTitle')}
                </Text>
              </Box>

              <Box
                style={{
                  borderRadius: 10,
                  backgroundColor: WELL,
                  border: `1px solid ${HAIRLINE}`,
                  overflow: 'hidden',
                }}
              >
                <SummaryRow
                  label={t('nodeCreate.sumNode')}
                  value={`${form.values.name.trim() || '-'} · ${form.values.protocol}`}
                />
                <SummaryRow
                  label={t('nodeCreate.sumEndpoint')}
                  value={`${form.values.host.trim() || '-'}:${
                    form.values.port === '' ? DEFAULT_NODE_PORT : form.values.port
                  }`}
                />
                <SummaryRow label={t('nodeCreate.sumHardening')} value={hardeningSummary(form.values, t)} />
                <SummaryRow
                  label={t('nodeCreate.sumHosts')}
                  value={
                    selected.length === 0
                      ? t('nodeCreate.sumHostsNone')
                      : t('nodeCreate.sumHostsValue', {
                          count: selected.length,
                          ports: selected.map((id) => portByProfile.get(id)).join(', '),
                        })
                  }
                />
              </Box>

              <Box
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '12px 14px',
                  borderRadius: 10,
                  backgroundColor: `${CYAN}0D`,
                  border: `1px solid ${CYAN}29`,
                }}
              >
                <InfoIcon size={14} color={CYAN} />
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: MIST, flex: 1 }}>
                  {t('nodeCreate.summaryNote')}
                </Text>
              </Box>
            </Stack>
          </Box>
        </Box>
  );
}
