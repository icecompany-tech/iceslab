import { modals } from '@mantine/modals';
import { countryFlag } from '@/lib/domain/countries';
import { deleteHost } from '@/lib/domain/hosts';
import { GlobeIcon, LinkIcon, TrashIcon } from '@/contours/nodes/components/NodeEdit/icons';
import { PROTOCOL_DOT, shapeOf } from '@/contours/nodes/lib/nodeFormat';
import { PlainButton } from '@/contours/nodes/components/NodeEdit/PlainButton';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { CARD, CYAN2, DIM, DISPLAY, EDGE, FAINT, HAIRLINE, MIST, MONO, MOSS, SNOW, WELL } from '@/contours/nodes/lib/colors';
import { useTranslation } from 'react-i18next';
import type { NodeEditor } from '@/contours/nodes/components/NodeEdit/useNodeEditForm';

/**
 * The listening ports the agent actually serves on this node, with the
 * profile behind each one and the probe-exposure check.
 */
export function HostsPanel({
  navigate,
  qc,
  node,
  hostsQuery,
  profileById,
  bindingById,
  id,
}: Pick<NodeEditor, 'navigate' | 'qc' | 'node' | 'hostsQuery' | 'profileById' | 'bindingById' | 'id'>) {
  const { t } = useTranslation();

  // The page only renders this panel for a node that exists.
  if (!node) return null;

  return (
    <>
          {/* Hosts: the listening ports the agent actually serves here. */}
          <Box
            style={{
              borderRadius: 10,
              backgroundColor: CARD,
              border: `1px solid ${HAIRLINE}`,
              overflow: 'hidden',
            }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 20, width: '100%' }}>
              <GlobeIcon size={14} color={MIST} />
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '0.14em',
                  lineHeight: '14px',
                  textTransform: 'uppercase',
                  color: MIST,
                }}
              >
                {t('nodeEdit.hostsTitle')}
              </Text>
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
                {t('nodeEdit.hostsHint')}
              </Text>
              <Box style={{ flex: 1 }} />
              <PlainButton icon="plus" strong height={34} edge onClick={() => navigate('/hosts/new')}>
                {t('nodeEdit.attachHost')}
              </PlainButton>
            </Box>

            {(hostsQuery.data?.hosts ?? []).length === 0 ? (
              <Box style={{ padding: '18px 20px', borderTop: `1px solid ${HAIRLINE}` }}>
                <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: FAINT }}>
                  {t('nodeEdit.hostsEmpty')}
                </Text>
              </Box>
            ) : (
              (hostsQuery.data?.hosts ?? []).map((h) => {
                const binding = bindingById.get(h.bindingId);
                const profile = binding ? profileById.get(binding.profileId) : undefined;
                return (
                  <Box
                    key={h.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '14px 20px',
                      borderTop: `1px solid ${HAIRLINE}`,
                      width: '100%',
                    }}
                  >
                    <Box
                      style={{
                        width: 22,
                        height: 16,
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        backgroundColor: h.addressOverride ? WELL : 'transparent',
                        border: h.addressOverride ? `1px solid ${EDGE}` : 'none',
                      }}
                    >
                      {h.addressOverride ? (
                        <LinkIcon size={10} color={FAINT} />
                      ) : (
                        <Text style={{ fontSize: 14, lineHeight: '14px' }}>
                          {countryFlag(node.countryCode ?? '')}
                        </Text>
                      )}
                    </Box>
                    <Text
                      style={{
                        fontFamily: DISPLAY,
                        fontSize: 14,
                        fontWeight: 500,
                        lineHeight: '18px',
                        color: SNOW,
                        width: 180,
                        flexShrink: 0,
                      }}
                    >
                      {h.remark}
                    </Text>
                    <Text
                      style={{
                        fontFamily: MONO,
                        fontSize: 13,
                        fontWeight: 500,
                        lineHeight: '16px',
                        color: CYAN2,
                        width: 70,
                        flexShrink: 0,
                      }}
                    >
                      {h.portOverride ?? binding?.port ?? '-'}
                    </Text>
                    {profile && (
                      <Box
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '5px 10px',
                          borderRadius: 6,
                          backgroundColor: WELL,
                          border: `1px solid ${EDGE}`,
                        }}
                      >
                        <Box
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: 999,
                            backgroundColor: PROTOCOL_DOT[profile.protocol] ?? MIST,
                            flexShrink: 0,
                          }}
                        />
                        <Text
                          style={{
                            fontFamily: DISPLAY,
                            fontSize: 12,
                            fontWeight: 500,
                            lineHeight: '16px',
                            color: SNOW,
                          }}
                        >
                          {profile.name}
                        </Text>
                        <Text
                          style={{
                            fontFamily: MONO,
                            fontSize: 10,
                            letterSpacing: '0.08em',
                            lineHeight: '12px',
                            textTransform: 'uppercase',
                            color: MIST,
                          }}
                        >
                          {shapeOf(profile.protocol, profile.config as Record<string, unknown>)}
                        </Text>
                      </Box>
                    )}
                    <Box style={{ flex: 1 }} />
                    <Box style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <Box
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          backgroundColor: h.enabled && node.status === 'online' ? MOSS : DIM,
                        }}
                      />
                      <Text
                        style={{
                          fontFamily: MONO,
                          fontSize: 11,
                          fontWeight: 500,
                          letterSpacing: '0.08em',
                          lineHeight: '14px',
                          textTransform: 'uppercase',
                          color: h.enabled && node.status === 'online' ? MOSS : DIM,
                        }}
                      >
                        {h.enabled ? t('nodeEdit.running') : t('nodeEdit.stopped')}
                      </Text>
                    </Box>
                    <UnstyledButton
                      type="button"
                      onClick={() =>
                        modals.openConfirmModal({
                          title: t('nodeEdit.detachTitle', { name: h.remark }),
                          children: <Text size="sm">{t('nodeEdit.detachBody')}</Text>,
                          labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
                          confirmProps: { color: 'red' },
                          onConfirm: async () => {
                            await deleteHost(h.id);
                            qc.invalidateQueries({ queryKey: ['hosts', id] });
                          },
                        })
                      }
                      style={{ display: 'flex', flexShrink: 0 }}
                    >
                      <TrashIcon size={15} color={FAINT} />
                    </UnstyledButton>
                  </Box>
                );
              })
            )}
          </Box>
    </>
  );
}
