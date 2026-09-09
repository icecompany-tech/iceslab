import { useTranslation } from 'react-i18next';
import { Group, NumberInput, PasswordInput, Stack, TextInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

export function HysteriaSection({
  form,
}: {
  form: UseFormReturnType<FormValues>;
}) {
  const { t } = useTranslation();
  return (
            <Stack>
              <PasswordInput
                label={t('profiles.form.cfg.salamanderObfsLabel')}
                description={t('profiles.form.cfg.salamanderObfsDesc')}
                {...form.getInputProps('hyObfsPassword')}
              />
              <TextInput
                label={t('profiles.form.cfg.masqueradeUrlLabel')}
                placeholder="https://en.wikipedia.org"
                {...form.getInputProps('hyMasqueradeUrl')}
              />
              <Group grow>
                <NumberInput
                  label={t('profiles.form.cfg.brutalUpLabel')}
                  min={1}
                  {...form.getInputProps('hyBrutalUp')}
                />
                <NumberInput
                  label={t('profiles.form.cfg.brutalDownLabel')}
                  min={1}
                  {...form.getInputProps('hyBrutalDown')}
                />
              </Group>
              <Group grow align="flex-end">
                <NumberInput
                  label={t('profileForm.portRangeStart')}
                  description={t('profileForm.portRangeStartDesc')}
                  placeholder="20000"
                  min={1024}
                  max={65535}
                  {...form.getInputProps('hyPortHopStart')}
                />
                <NumberInput
                  label={t('profileForm.portRangeEnd')}
                  description={t('profileForm.portRangeEndDesc')}
                  placeholder="50000"
                  min={1024}
                  max={65535}
                  {...form.getInputProps('hyPortHopEnd')}
                />
              </Group>
            </Stack>
  );
}
