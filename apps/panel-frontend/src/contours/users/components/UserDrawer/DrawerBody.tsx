import { ROUTING_PRESET_IDS } from '@/lib/domain/routingPresets';
import { IconCheck, IconChevronDown, IconChevronUp, IconDeviceDesktop, IconDice5, IconMail, IconPlus, IconRoute, IconTag } from '@tabler/icons-react';
import { AdvancedGroup } from '@/contours/users/components/UserDrawer/AdvancedGroup';
import { BORDER_INPUT, CARD, CYAN, DIM, DISPLAY, HAIRLINE, MIST, MONO, MOSS, RED, SNOW, SUNK } from '@/contours/users/lib/colors';
import { Box, NumberInput, Select, Stack, Text, TextInput, Textarea, UnstyledButton } from '@mantine/core';
import { DeviceList } from '@/contours/users/components/UserDrawer/DeviceList';
import { Hint } from '@/contours/users/components/UserDrawer/Hint';
import { LABEL, STRATEGY_VALUES } from '@/contours/users/lib/userForm';
import { PreviewCard } from '@/contours/users/components/UserDrawer/PreviewCard';
import { Section } from '@/contours/users/components/UserDrawer/Section';
import { presetKey } from '@/lib/domain/routingPresets';
import { useTranslation } from 'react-i18next';
import type { Props } from '@/contours/users/components/UserDrawer';
import type { UserForm } from '@/contours/users/components/UserDrawer/useUserForm';

/**
 * The form itself: who the user is, what they may reach, how much they
 * may spend, and the preview of what they will receive.
 */
export function DrawerBody({
  isEdit,
  presets,
  form,
  squads,
  nameTaken,
  nameFree,
  preview,
  applyPreset,
  toggleSquad,
  expiresAt,
  advancedOpen,
  setAdvancedOpen,
  presetId,
  user,
}: Pick<UserForm, 'isEdit' | 'presets' | 'form' | 'squads' | 'nameTaken' | 'nameFree' | 'preview' | 'applyPreset' | 'toggleSquad' | 'expiresAt' | 'advancedOpen' | 'setAdvancedOpen' | 'presetId'> & { user: Props['user'] }) {
  const { t } = useTranslation();

  return (
    <>
        {/* Body */}
        <Box style={{ flex: 1, overflowY: 'auto', padding: 24, minHeight: 0 }}>
          <Stack gap={20}>
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

            {/* Username: the one field that cannot be changed later, so it
                carries its own availability check while typing. */}
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

            <PreviewCard
              preview={preview}
              trafficGb={form.values.trafficLimitGb}
              strategy={form.values.trafficLimitStrategy}
              expiresAt={expiresAt}
              expireDays={form.values.expireDays}
              routingPreset={form.values.routingPreset}
              onEditTraffic={() => setAdvancedOpen(true)}
            />

            {/* Advanced: everything an operator leaves alone on a normal day. */}
            <Box
              style={{
                borderRadius: 10,
                backgroundColor: CARD,
                border: `1px solid ${HAIRLINE}`,
                overflow: 'hidden',
              }}
            >
              <UnstyledButton
                onClick={() => setAdvancedOpen((v) => !v)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8, color: MIST }}>
                  {advancedOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 500, color: SNOW }}>
                    {t('userDrawer.advanced')}
                  </Text>
                </Box>
                <Text style={{ ...LABEL }}>
                  {advancedOpen ? t('userDrawer.hide') : t('userDrawer.show')}
                </Text>
              </UnstyledButton>

              {advancedOpen && (
                <Stack gap={20} style={{ padding: '4px 16px 18px' }}>
                  <AdvancedGroup icon={<IconMail size={13} />} title={t('userDrawer.contact')}>
                    <Box style={{ display: 'flex', gap: 12 }}>
                      <TextInput
                        style={{ flex: 1 }}
                        label={t('userDrawer.email')}
                        placeholder="user@example.com"
                        {...form.getInputProps('email')}
                      />
                      <TextInput
                        style={{ flex: 1 }}
                        label={t('userDrawer.telegram')}
                        placeholder={t('userDrawer.optional')}
                        {...form.getInputProps('telegramId')}
                      />
                    </Box>
                    <Hint>{t('userDrawer.telegramHint')}</Hint>
                  </AdvancedGroup>

                  <AdvancedGroup icon={<IconTag size={13} />} title={t('userDrawer.devicesAndTags')}>
                    <Box style={{ display: 'flex', gap: 12 }}>
                      <NumberInput
                        style={{ width: 150 }}
                        label={t('userDrawer.hwidLimit')}
                        min={0}
                        placeholder="3"
                        {...form.getInputProps('hwidDeviceLimit')}
                      />
                      <TextInput
                        style={{ flex: 1 }}
                        label={t('userDrawer.tag')}
                        placeholder="VIP / TRIAL / ..."
                        {...form.getInputProps('tag')}
                      />
                    </Box>
                    <Hint>{t('userDrawer.hwidHint')}</Hint>
                    {/* Only for a user who exists: devices are registered by a
                        client that has already connected. */}
                    {isEdit && user && (
                      <DeviceList userId={user.id} limit={form.values.hwidDeviceLimit} />
                    )}
                    <Textarea
                      label={t('userDrawer.note')}
                      placeholder={t('userDrawer.notePlaceholder')}
                      autosize
                      minRows={2}
                      {...form.getInputProps('description')}
                    />
                  </AdvancedGroup>

                  <AdvancedGroup icon={<IconRoute size={13} />} title={t('userDrawer.quota')}>
                    <Box style={{ display: 'flex', gap: 12 }}>
                      <NumberInput
                        style={{ width: 150 }}
                        label={t('userDrawer.trafficGb')}
                        min={0}
                        placeholder="∞"
                        {...form.getInputProps('trafficLimitGb')}
                      />
                      <Select
                        style={{ flex: 1 }}
                        label={t('userDrawer.resets')}
                        data={STRATEGY_VALUES.map((v) => ({
                          value: v,
                          label: t(`users.strategy.${v}`),
                        }))}
                        allowDeselect={false}
                        {...form.getInputProps('trafficLimitStrategy')}
                      />
                      {!isEdit && (
                        <NumberInput
                          style={{ width: 130 }}
                          label={t('userDrawer.expireDays')}
                          min={0}
                          placeholder="∞"
                          {...form.getInputProps('expireDays')}
                        />
                      )}
                    </Box>
                  </AdvancedGroup>

                  <AdvancedGroup icon={<IconRoute size={13} />} title={t('userDrawer.routingOverride')}>
                    <Select
                      // Built from the shared list the backend validates
                      // against, not from a copy of it.
                      data={[
                        { value: '', label: t('userDrawer.routingInherit') },
                        ...ROUTING_PRESET_IDS.map((id) => ({
                          value: id,
                          label: t(`metadata.preset${presetKey(id)}`),
                        })),
                      ]}
                      allowDeselect={false}
                      {...form.getInputProps('routingPreset')}
                    />
                    <Hint>{t('userDrawer.routingHint')}</Hint>
                  </AdvancedGroup>

                  {!isEdit && (
                    <AdvancedGroup
                      icon={<IconDeviceDesktop size={13} />}
                      title={t('userDrawer.migration')}
                      badge={t('userDrawer.rare')}
                    >
                      <TextInput
                        label={t('userDrawer.importToken')}
                        placeholder={`(${t('userDrawer.optional')})`}
                        {...form.getInputProps('subscriptionToken')}
                      />
                      <Hint>{t('userDrawer.importTokenHint')}</Hint>
                    </AdvancedGroup>
                  )}
                </Stack>
              )}
            </Box>
          </Stack>
        </Box>
    </>
  );
}
