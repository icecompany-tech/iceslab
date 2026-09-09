import { useTranslation } from 'react-i18next';
import type { UseFormReturnType } from '@mantine/form';
import { Group, Select, Switch, TextInput, Textarea } from '@mantine/core';
import { IconShield } from '@tabler/icons-react';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';
import {
  PROFILE_KIND_BY_KEY,
  PROFILE_KINDS,
  PROFILE_PROTOCOL_GROUPED,
  profileKindKey,
} from '@/contours/profiles/lib/profileKinds';
import { SectionCard } from '@/contours/profiles/components/ProfileForm/SectionCard';

/**
 * Name, description, enabled and the protocol picker: what the profile is
 * called, before anything about how the wire behaves.
 */
export function IdentitySection({
  form,
  isEdit,
  inline,
}: {
  form: UseFormReturnType<FormValues>;
  isEdit: boolean;
  inline: boolean | undefined;
}) {
  const { t } = useTranslation();

  return (
          <SectionCard
            title={t('profiles.form.cfg.basicsTitle')}
            icon={<IconShield size={15} color="#7DD3FC" stroke={1.8} />}
          >
          {/* Name, description and the switch share one row: three short
              answers, not three stacked sections. */}
          <Group align="flex-start" gap={16} wrap="nowrap" style={{ width: '100%' }}>
            <TextInput
              style={{ flex: 1, minWidth: 0 }}
              label={t('profiles.form.name')}
              placeholder="vless-reality"
              required
              {...form.getInputProps('name')}
            />
            <Textarea
              style={{ flex: 2, minWidth: 0 }}
              label={t('profiles.form.description')}
              placeholder={t('profiles.form.descriptionPlaceholder')}
              autosize
              minRows={1}
              maxRows={3}
              {...form.getInputProps('description')}
            />
            <Select
              label={t('profiles.form.protocol')}
              description={isEdit ? t('profiles.form.protocolEdit') : undefined}
              // On the page, the protocol is picked from the engine tabs below;
              // the select stays for the modal path and for edit, where the
              // protocol is fixed anyway.
              style={inline && !isEdit ? { display: 'none' } : undefined}
              data={
                isEdit
                  ? PROFILE_KINDS.filter((k) => k.protocol === form.values.protocol).map((k) => ({
                      value: k.key,
                      label: k.label,
                    }))
                  : PROFILE_PROTOCOL_GROUPED
              }
              // Protocol is immutable on edit; only its engine variants stay
              // selectable, so a single-engine protocol shows one locked option.
              disabled={
                isEdit &&
                PROFILE_KINDS.filter((k) => k.protocol === form.values.protocol).length <= 1
              }
              allowDeselect={false}
              value={profileKindKey(form.values.protocol, form.values.engine)}
              onChange={(val) => {
                const kind = val ? PROFILE_KIND_BY_KEY.get(val) : undefined;
                if (!kind) return;
                form.setFieldValue('engine', kind.engine);
                if (!isEdit) form.setFieldValue('protocol', kind.protocol);
              }}
            />
            <Switch
              style={{ flexShrink: 0, marginTop: 26 }}
              label={t('common.enabled')}
              {...form.getInputProps('enabled', { type: 'checkbox' })}
            />
          </Group>
          </SectionCard>
  );
}
