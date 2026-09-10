import { IconCheck, IconDice5, IconPlus } from '@tabler/icons-react';
import { BORDER_INPUT, CARD, CYAN, DIM, DISPLAY, HAIRLINE, MIST, MONO, MOSS, RED, SNOW, SUNK } from '@/contours/users/lib/colors';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { PlanRow } from '@/contours/users/components/UserDrawer/PlanRow';
import { Section } from '@/contours/users/components/UserDrawer/Section';
import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';
import type { UserForm } from '@/contours/users/components/UserDrawer/useUserForm';

/**
 * The left column: who this account is and what it is worth. Preset, name and
 * squads answer "who", the plan row answers "how much", and everything an
 * operator leaves alone on a normal day sits in Advanced below both columns.
 */
export function FormColumn({
  isEdit,
  presets,
  form,
  squads,
  nameTaken,
  nameFree,
  applyPreset,
  toggleSquad,
  presetId,
  now,
  expiresAt,
  setExpiry,
  trafficRef,
}: Pick<
  UserForm,
  | 'isEdit'
  | 'presets'
  | 'form'
  | 'squads'
  | 'nameTaken'
  | 'nameFree'
  | 'applyPreset'
  | 'toggleSquad'
  | 'presetId'
  | 'now'
  | 'expiresAt'
  | 'setExpiry'
> & { trafficRef: RefObject<HTMLInputElement | null> }) {
  const { t } = useTranslation();

  return (
    <Stack gap={14}>
      {!isEdit && (
        <Section label={t('userDrawer.preset')}>
          <Box style={{ display: 'flex', gap: 8, width: '100%' }}>
            {presets.map((p) => {
              const active = presetId === p.id;
              return (
                <UnstyledButton
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: active ? `${CYAN}14` : CARD,
                    border: `1px solid ${active ? CYAN : HAIRLINE}`,
                  }}
                >
                  <Text
                    style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}
                  >
                    {p.name}
                  </Text>
                  <Text
                    style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: active ? CYAN : MIST }}
                  >
                    {p.trafficGb === null ? '∞' : `${p.trafficGb} GB`}
                    {p.expireDays === null ? '' : ` · ${p.expireDays}d`}
                  </Text>
                </UnstyledButton>
              );
            })}
            <Box
              title={t('userDrawer.presetAddHint')}
              style={{
                width: 44,
                borderRadius: 10,
                backgroundColor: CARD,
                border: `1px dashed ${BORDER_INPUT}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: MIST,
                flexShrink: 0,
              }}
            >
              <IconPlus size={16} stroke={1.8} />
            </Box>
          </Box>
        </Section>
      )}

      {/* Username: the one field that cannot be changed later, so it carries
          its own availability check while typing. */}
      {!isEdit && (
        <Section label={t('userDrawer.username')} required>
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 40,
              padding: '0 12px',
              borderRadius: 10,
              backgroundColor: SUNK,
              border: `1px solid ${form.errors.username ? RED : BORDER_INPUT}`,
            }}
          >
            <input
              {...form.getInputProps('username')}
              placeholder={t('userDrawer.usernamePlaceholder')}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: SNOW,
                fontFamily: DISPLAY,
                fontSize: 13,
                lineHeight: '16px',
              }}
            />
            {nameFree && (
              <Box style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                <IconCheck size={14} stroke={2.2} color={MOSS} />
                <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', color: MOSS }}>
                  {t('userDrawer.nameFree')}
                </Text>
              </Box>
            )}
            {nameTaken && (
              <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', color: RED }}>
                {t('userDrawer.nameTaken')}
              </Text>
            )}
            <Box style={{ width: 1, height: 20, backgroundColor: HAIRLINE, flexShrink: 0 }} />
            <UnstyledButton
              title={t('userDrawer.generateName')}
              onClick={() =>
                form.setFieldValue('username', `user-${Math.random().toString(36).slice(2, 8)}`)
              }
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: MIST,
                flexShrink: 0,
              }}
            >
              <IconDice5 size={15} stroke={1.8} />
            </UnstyledButton>
          </Box>
          {form.errors.username && (
            <Text style={{ fontSize: 11, color: RED, marginTop: 4 }}>{form.errors.username}</Text>
          )}
        </Section>
      )}

      <Section label={t('userDrawer.squads')}>
        <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {squads.map((s) => {
            const active = form.values.groupIds.includes(s.id);
            return (
              <UnstyledButton
                key={s.id}
                onClick={() => toggleSquad(s.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 8,
                  backgroundColor: active ? `${CYAN}14` : CARD,
                  border: `1px solid ${active ? CYAN : HAIRLINE}`,
                }}
              >
                <Box
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    border: `1px solid ${active ? CYAN : DIM}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {active && <IconCheck size={8} stroke={3.4} color={CYAN} />}
                </Box>
                <Text
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: 12,
                    lineHeight: '16px',
                    fontWeight: active ? 500 : 400,
                    color: active ? SNOW : MIST,
                  }}
                >
                  {s.name}
                </Text>
              </UnstyledButton>
            );
          })}
        </Box>
      </Section>

      <PlanRow
        form={form}
        now={now}
        expiresAt={expiresAt}
        setExpiry={setExpiry}
        trafficRef={trafficRef}
      />
    </Stack>
  );
}
