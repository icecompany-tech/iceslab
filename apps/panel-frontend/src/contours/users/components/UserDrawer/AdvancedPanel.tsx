import { ROUTING_PRESET_IDS } from '@/lib/domain/routingPresets';
import { IconChevronDown, IconChevronUp, IconDeviceDesktop, IconMail, IconRoute, IconTag } from '@tabler/icons-react';
import { AdvancedGroup } from '@/contours/users/components/UserDrawer/AdvancedGroup';
import { CARD, DISPLAY, HAIRLINE, MIST, SNOW } from '@/contours/users/lib/colors';
import { Box, NumberInput, Select, Stack, Text, TextInput, Textarea, UnstyledButton } from '@mantine/core';
import { DeviceList } from '@/contours/users/components/UserDrawer/DeviceList';
import { Hint } from '@/contours/users/components/UserDrawer/Hint';
import { LABEL } from '@/contours/users/lib/userForm';
import { presetKey } from '@/lib/domain/routingPresets';
import { useTranslation } from 'react-i18next';
import type { Props } from '@/contours/users/components/UserDrawer';
import type { UserForm } from '@/contours/users/components/UserDrawer/useUserForm';

/**
 * Everything an operator leaves alone on a normal day: how to reach the person,
 * how many devices they may bind, the routing override and the import token.
 *
 * Traffic and expiry used to live here too. They are the two numbers that
 * change on every account, so they moved up into the form column and this
 * panel kept only what is genuinely rare.
 */
export function AdvancedPanel({
  isEdit,
  form,
  advancedOpen,
  setAdvancedOpen,
  user,
}: Pick<UserForm, 'isEdit' | 'form' | 'advancedOpen' | 'setAdvancedOpen'> & {
  user: Props['user'];
}) {
  const { t } = useTranslation();

  return (
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
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: MIST }}>
            {t('userDrawer.advancedContents')}
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
            {/* Only for a user who exists: devices are registered by a client
                that has already connected. */}
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

          <AdvancedGroup icon={<IconRoute size={13} />} title={t('userDrawer.routingOverride')}>
            <Select
              // Built from the shared list the backend validates against, not
              // from a copy of it.
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
  );
}
