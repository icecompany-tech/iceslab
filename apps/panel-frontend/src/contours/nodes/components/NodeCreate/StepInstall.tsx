import { AMBER, CARD, CYAN, DISPLAY, FAINT, GROUND, HAIRLINE, MIST, MONO, MOSS, SNOW, WELL } from '@/contours/nodes/lib/colors';
import { Box, Collapse, Stack, Text } from '@mantine/core';
import { CardCaption } from '@/contours/nodes/components/NodeCreate/CardCaption';
import { Chip } from '@/contours/nodes/components/NodeCreate/Chip';
import { ClockIcon, FileIcon, KeyIcon, TerminalIcon, WarnIcon } from '@/contours/nodes/components/NodeCreate/icons';
import { SmallButton } from '@/contours/nodes/components/NodeCreate/SmallButton';
import { TimelineStep } from '@/contours/nodes/components/NodeCreate/TimelineStep';
import { clock, expiryLabel, splitCommand } from '@/contours/nodes/lib/nodeInstall';
import { useTranslation } from 'react-i18next';
import type { useNodeCreateForm } from '@/contours/nodes/components/NodeCreate/useNodeCreateForm';

type Wizard = ReturnType<typeof useNodeCreateForm>;

/**
 * Step three: the install command and the one-time payload, then the wait for
 * the agent to call home.
 */
export function StepInstall({
  registered,
  showPayload,
  setShowPayload,
  copied,
  isOnline,
  waited,
  copy,
  downloadPayload,
}: Pick<Wizard, 'registered' | 'showPayload' | 'setShowPayload' | 'copied' | 'isOnline' | 'waited' | 'copy' | 'downloadPayload'>) {
  const { t } = useTranslation();

  // The page only mounts this step once the node is registered; the guard is
  // here so the section owns its own precondition instead of trusting the caller.
  if (!registered) return null;

  return (
        <>
          {/* The one-shot nature of the token is the first thing on the page,
              above everything it is needed for. */}
          <Box
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '13px 16px',
              borderRadius: 10,
              backgroundColor: `${AMBER}0D`,
              border: `1px solid ${AMBER}29`,
            }}
          >
            <WarnIcon size={16} color={AMBER} />
            <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '17px', color: SNOW }}>
                {t('nodeCreate.onceTitle')}
              </Text>
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}>
                {t('nodeCreate.onceBody')}
              </Text>
            </Stack>
          </Box>

          <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
            <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0 }}>
              <Stack
                gap={12}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <KeyIcon size={15} color={CYAN} />
                  <CardCaption>{t('nodeCreate.tokenTitle')}</CardCaption>
                  <Box style={{ flex: 1, minWidth: 0 }} />
                  <Chip color={AMBER}>{expiryLabel(registered.expiresAt, t)}</Chip>
                </Box>
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 14px',
                    borderRadius: 8,
                    backgroundColor: GROUND,
                    border: `1px solid ${HAIRLINE}`,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      lineHeight: '16px',
                      color: SNOW,
                      flex: 1,
                      minWidth: 0,
                      wordBreak: 'break-all',
                    }}
                  >
                    {registered.token}
                  </Text>
                  <SmallButton
                    icon="copy"
                    accent
                    onClick={() => copy(registered.token, 'token')}
                    height={26}
                    radius={7}
                  >
                    {copied === 'token' ? t('nodeCreate.copied') : t('common.copy')}
                  </SmallButton>
                </Box>
              </Stack>

              <Stack
                gap={12}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <TerminalIcon size={15} color={CYAN} />
                  <CardCaption>{t('nodeCreate.runTitle')}</CardCaption>
                  <Box style={{ flex: 1, minWidth: 0 }} />
                  <SmallButton icon="copy" accent onClick={() => copy(registered.command, 'command')}>
                    {copied === 'command' ? t('nodeCreate.copied') : t('nodeCreate.copyCommand')}
                  </SmallButton>
                </Box>
                {/* The fetch line is moss, the flags stay snow: the eye lands
                    on the one line that reaches the network. */}
                <Box
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: 14,
                    borderRadius: 8,
                    backgroundColor: GROUND,
                    border: `1px solid ${HAIRLINE}`,
                  }}
                >
                  {splitCommand(registered.command).map((line, i) => (
                    <Text
                      key={i}
                      style={{
                        fontFamily: MONO,
                        fontSize: 12,
                        lineHeight: '19px',
                        color: i === 0 ? MOSS : SNOW,
                        wordBreak: 'break-all',
                      }}
                    >
                      {line}
                    </Text>
                  ))}
                </Box>
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
                  {t('nodeCreate.runHint')}
                </Text>
              </Stack>

              <Stack
                gap={12}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <FileIcon size={15} color={MIST} />
                  <CardCaption>{t('nodeCreate.manualTitle')}</CardCaption>
                  <Box
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      height: 18,
                      paddingInline: 7,
                      borderRadius: 5,
                      backgroundColor: WELL,
                      border: `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: MONO,
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        lineHeight: '11px',
                        textTransform: 'uppercase',
                        color: FAINT,
                      }}
                    >
                      {t('nodeCreate.advanced')}
                    </Text>
                  </Box>
                  <Box style={{ flex: 1, minWidth: 0 }} />
                  <SmallButton icon="chevron" open={showPayload} onClick={() => setShowPayload((v) => !v)}>
                    {t('nodeCreate.showPayload')}
                  </SmallButton>
                  <SmallButton icon="download" accent onClick={downloadPayload}>
                    {t('nodeCreate.downloadPayload')}
                  </SmallButton>
                </Box>
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
                  {t('nodeCreate.manualHint')}
                </Text>
                <Collapse in={showPayload}>
                  <Box
                    style={{
                      padding: 14,
                      borderRadius: 8,
                      backgroundColor: GROUND,
                      border: `1px solid ${HAIRLINE}`,
                      maxHeight: 220,
                      overflow: 'auto',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        lineHeight: '17px',
                        color: MIST,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {registered.payload}
                    </Text>
                  </Box>
                </Collapse>
              </Stack>
            </Box>

            <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 520, flexShrink: 0 }}>
              <Stack
                gap={14}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ClockIcon size={15} color={CYAN} />
                  <CardCaption>{t('nodeCreate.nextTitle')}</CardCaption>
                </Box>

                <TimelineStep
                  state="done"
                  title={t('nodeCreate.tl1')}
                  hint={t('nodeCreate.tl1Hint')}
                />
                <TimelineStep
                  state={isOnline ? 'done' : 'current'}
                  title={t('nodeCreate.tl2')}
                  hint={t('nodeCreate.tl2Hint')}
                />
                <TimelineStep
                  state={isOnline ? 'done' : 'pending'}
                  title={t('nodeCreate.tl3')}
                  hint={t('nodeCreate.tl3Hint')}
                />
                <TimelineStep
                  state={isOnline ? 'current' : 'pending'}
                  title={t('nodeCreate.tl4', { count: registered.hosts.length })}
                  hint={
                    registered.hosts.length > 0
                      ? registered.hosts.map((h) => `${h.name} on ${h.port}`).join(', ')
                      : t('nodeCreate.tl4None')
                  }
                />

                <Box style={{ height: 1, backgroundColor: HAIRLINE, width: '100%' }} />

                <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                  <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, flex: 1 }}>
                    {isOnline ? t('nodeCreate.heartbeatGot') : t('nodeCreate.heartbeatWait')}
                  </Text>
                  <Box
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      height: 24,
                      paddingInline: 9,
                      borderRadius: 6,
                      backgroundColor: WELL,
                      border: `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <Box
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: isOnline ? MOSS : AMBER,
                        flexShrink: 0,
                      }}
                    />
                    <Text
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        lineHeight: '12px',
                        color: isOnline ? MOSS : AMBER,
                      }}
                    >
                      {clock(waited)}
                    </Text>
                  </Box>
                </Box>
              </Stack>
            </Box>
          </Box>
        </>
  );
}
