import { AMBER, CARD, CYAN, DIM, DISPLAY, EDGE, FAINT, HAIRLINE, MIST, MONO, MOSS, SNOW, VIOLET, WELL } from '@/contours/nodes/lib/colors';
import { BarButton } from '@/contours/nodes/components/NodeCreate/BarButton';
import { DEFAULT_NODE_PORT } from '@/contours/nodes/lib/nodeProtocols';
import { STEPS } from '@/contours/nodes/lib/nodeInstall';
import { ServerIcon, TickIcon } from '@/contours/nodes/components/NodeCreate/icons';
import { StepHosts } from '@/contours/nodes/components/NodeCreate/StepHosts';
import { StepInstall } from '@/contours/nodes/components/NodeCreate/StepInstall';
import { StepParams } from '@/contours/nodes/components/NodeCreate/StepParams';
import { useNodeCreateForm } from '@/contours/nodes/components/NodeCreate/useNodeCreateForm';
import { useTranslation } from 'react-i18next';
import { installIntentLabel } from '@/lib/domain/engines';
import {
  Box,
  Stack,
  Text,
} from '@mantine/core';

/**
 * Register a node, as a page in three steps: parameters, hosts, install. A node
 * is a machine an operator is about to hand credentials to, so the decisions
 * get the width of the page and a visible position in the sequence rather than
 * a dialog that scrolls inside itself.
 *
 * This file currently owns step 1. Steps 2 and 3 are drawn against their own
 * artboards next; until then the bar's forward action stops at the end of the
 * parameters step.
 */

export function NodeCreatePage() {
  const { t } = useTranslation();
  const {
    navigate,
    form,
    step,
    setStep,
    selected,
    groupOpen,
    setGroupOpen,
    registered,
    creating,
    showPayload,
    setShowPayload,
    copied,
    isOnline,
    waited,
    profilesQuery,
    groups,
    portByProfile,
    toggle,
    toggleAllCan,
    goNext,
    register,
    copy,
    downloadPayload,
  } = useNodeCreateForm();

  return (
    <Stack gap={20}>
      {/* Page bar */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 64,
          padding: '8px 8px 8px 14px',
          borderRadius: 10,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 16, flexShrink: 0 }}>
          <Box
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: `${MOSS}1A`,
              border: `1px solid ${MOSS}33`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {step === 2 ? <TickIcon size={18} color={MOSS} /> : <ServerIcon size={18} color={MOSS} />}
          </Box>
          {/* Once the machine has a name, the bar wears it: from here on the
              page is about that node, not about "a new node". */}
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {step === 2
              ? t('nodeCreate.registered', { name: registered?.name ?? form.values.name.trim() })
              : step === 0 || !form.values.name.trim()
                ? t('nodeCreate.title')
                : form.values.name.trim()}
          </Text>
        </Box>
        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, paddingLeft: 16 }}>
          {step === 0 ? (
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: '0.12em',
                lineHeight: '12px',
                textTransform: 'uppercase',
                color: MIST,
              }}
            >
              {t('nodeCreate.subtitle')}
            </Text>
          ) : step === 2 ? (
            <>
              {/* The node exists but has not phoned home yet: that gap is the
                  whole point of this step, so it leads the line. */}
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 22,
                  paddingInline: 8,
                  borderRadius: 6,
                  backgroundColor: isOnline ? `${MOSS}14` : `${AMBER}14`,
                  border: `1px solid ${isOnline ? `${MOSS}2E` : `${AMBER}2E`}`,
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
                    letterSpacing: '0.1em',
                    lineHeight: '12px',
                    textTransform: 'uppercase',
                    color: isOnline ? MOSS : AMBER,
                  }}
                >
                  {isOnline ? t('nodeCreate.agentOnline') : t('nodeCreate.waitingAgent')}
                </Text>
              </Box>
              <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>
                {registered?.address}
              </Text>
            </>
          ) : (
            <>
              <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>
                {form.values.host.trim()}:{form.values.port === '' ? DEFAULT_NODE_PORT : form.values.port}
              </Text>
              <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM }}>·</Text>
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 20,
                  paddingInline: 8,
                  borderRadius: 5,
                  backgroundColor: `${VIOLET}1A`,
                  border: `1px solid ${VIOLET}33`,
                }}
              >
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    lineHeight: '12px',
                    textTransform: 'uppercase',
                    color: VIOLET,
                  }}
                >
                  {/* The pair being installed, not the protocol alone. */}
                  {installIntentLabel(form.values, t)}
                </Text>
              </Box>
            </>
          )}
          <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM }}>·</Text>
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 22,
              paddingInline: 9,
              borderRadius: 6,
              backgroundColor: WELL,
              border: `1px solid ${EDGE}`,
            }}
          >
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: '0.12em',
                lineHeight: '12px',
                textTransform: 'uppercase',
                color: MIST,
              }}
            >
              {t('nodeCreate.stepOf', { step: step + 1, total: STEPS.length })}
            </Text>
          </Box>
        </Box>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, flexShrink: 0 }}>
          {step === 0 ? (
            <>
              <BarButton onClick={() => navigate('/nodes')}>{t('common.cancel')}</BarButton>
              <BarButton primary icon="arrow" onClick={goNext}>
                {t('nodeCreate.nextHosts')}
              </BarButton>
            </>
          ) : step === 1 ? (
            <>
              <BarButton icon="back" onClick={() => setStep(0)}>
                {t('common.back')}
              </BarButton>
              <BarButton primary icon="server" onClick={register} disabled={creating}>
                {creating
                  ? t('nodeCreate.creating')
                  : selected.length > 0
                    ? t('nodeCreate.createWithHosts', { count: selected.length })
                    : t('nodeCreate.createOnly')}
              </BarButton>
            </>
          ) : (
            // No way back from here: the token is shown once, so the only
            // action is to confirm it has been taken somewhere safe.
            <BarButton primary icon="tick" onClick={() => navigate('/nodes')}>
              {t('nodeCreate.savedIt')}
            </BarButton>
          )}
        </Box>
      </Box>

      {/* Where in the sequence we are. The line between two markers is the
          sequence itself, so it stretches instead of the labels. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '14px 20px',
          borderRadius: 10,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        {STEPS.map((s, i) => {
          const active = i === step;
          return (
            <Box key={s.key} style={{ display: 'contents' }}>
              {i > 0 && <Box style={{ flex: 1, minWidth: 0, height: 1, backgroundColor: HAIRLINE }} />}
              <Box style={{ display: 'flex', alignItems: 'center', gap: 11, flexShrink: 0 }}>
                <Box
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    backgroundColor: active ? `${CYAN}14` : WELL,
                    border: `1px solid ${active ? CYAN : EDGE}`,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      fontWeight: 600,
                      lineHeight: '14px',
                      color: active ? CYAN : MIST,
                    }}
                  >
                    {i + 1}
                  </Text>
                </Box>
                <Stack gap={2}>
                  <Text
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      lineHeight: '17px',
                      color: active ? SNOW : MIST,
                    }}
                  >
                    {t(s.label)}
                  </Text>
                  <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '14px', color: FAINT }}>
                    {t(s.hint, { count: selected.length })}
                  </Text>
                </Stack>
              </Box>
            </Box>
          );
        })}
      </Box>

      {step === 0 && <StepParams form={form} />}

      {step === 1 && <StepHosts form={form} selected={selected} groupOpen={groupOpen} setGroupOpen={setGroupOpen} profilesQuery={profilesQuery} groups={groups} portByProfile={portByProfile} toggle={toggle} toggleAllCan={toggleAllCan} />}

      {step === 2 && registered && <StepInstall registered={registered} showPayload={showPayload} setShowPayload={setShowPayload} copied={copied} isOnline={isOnline} waited={waited} copy={copy} downloadPayload={downloadPayload} />}

      <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', lineHeight: '12px', color: FAINT }}>
          {t('nodeCreate.footerHint')}
        </Text>
      </Box>
    </Stack>
  );
}


