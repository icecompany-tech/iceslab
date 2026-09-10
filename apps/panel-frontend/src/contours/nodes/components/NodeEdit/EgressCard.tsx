import { ChainIcon, GlobeIcon } from '@/contours/nodes/components/NodeEdit/icons';
import { EgressRow } from '@/contours/nodes/components/NodeEdit/EgressRow';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { CARD, CYAN, DISPLAY, EDGE, FAINT, HAIRLINE, MIST, MONO, SNOW, WELL } from '@/contours/nodes/lib/colors';
import { useTranslation } from 'react-i18next';
import type { NodeEditor } from '@/contours/nodes/components/NodeEdit/useNodeEditForm';

/**
 * How traffic leaves this node: straight out, through WARP, or on into a
 * cascade. Exactly one of the three is true at a time.
 */
export function EgressCard({
  navigate,
  cascade,
  warpMutation,
  egress,
}: Pick<NodeEditor, 'navigate' | 'cascade' | 'warpMutation' | 'egress'>) {
  const { t } = useTranslation();

  return (
    <>
              {/* Egress: three ways out, exactly one of them true at a time. */}
              <Box
                style={{
                  borderRadius: 10,
                  backgroundColor: CARD,
                  border: `1px solid ${HAIRLINE}`,
                  overflow: 'hidden',
                }}
              >
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '20px 20px 16px',
                    width: '100%',
                  }}
                >
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
                    {t('nodeEdit.egressTitle')}
                  </Text>
                  <Box style={{ flex: 1 }} />
                  <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
                    {t('nodeEdit.egressHint')}
                  </Text>
                </Box>

                <EgressRow
                  selected={egress === 'direct'}
                  disabled={egress === 'cascade' || warpMutation.isPending}
                  title={t('nodeEdit.egressDirect')}
                  hint={t('nodeEdit.egressDirectHint')}
                  onClick={() => warpMutation.mutate(false)}
                />
                <EgressRow
                  selected={egress === 'warp'}
                  disabled={egress === 'cascade' || warpMutation.isPending}
                  title={t('nodeEdit.egressWarp')}
                  hint={t('nodeEdit.egressWarpHint')}
                  onClick={() => warpMutation.mutate(true)}
                />
                <EgressRow
                  selected={egress === 'cascade'}
                  disabled
                  title={t('nodeEdit.egressCascade')}
                  hint={cascade ? '' : t('nodeEdit.egressCascadeNone')}
                  trailing={
                    cascade ? (
                      <>
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
                          <ChainIcon size={12} color={CYAN} />
                          <Text
                            style={{
                              fontFamily: DISPLAY,
                              fontSize: 12,
                              fontWeight: 500,
                              lineHeight: '16px',
                              color: SNOW,
                            }}
                          >
                            {cascade.cascade.name}
                          </Text>
                          <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>
                            {t(`nodeEdit.role.${cascade.role}`)}
                            {cascade.directions.length > 0
                              ? t('nodeEdit.exitsTo', { where: cascade.directions.join(' · ') })
                              : ''}
                          </Text>
                        </Box>
                        <Box style={{ flex: 1 }} />
                        <UnstyledButton type="button" onClick={() => navigate('/nodes')}>
                          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: CYAN }}>
                            {t('nodeEdit.openCascade')}
                          </Text>
                        </UnstyledButton>
                      </>
                    ) : null
                  }
                />
              </Box>
    </>
  );
}
