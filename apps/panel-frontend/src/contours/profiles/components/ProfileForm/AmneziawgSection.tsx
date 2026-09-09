import { useTranslation } from 'react-i18next';
import {
  Accordion,
  Alert,
  Button,
  Group,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconKey } from '@tabler/icons-react';
import { randomAwgHeaders } from '@/contours/profiles/lib/awgPresets';
import type { UseFormReturnType } from '@mantine/form';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

export function AmneziawgSection({
  generateAwgKeys,
  applyAwgPreset,
  keypairPending,
  form,
  isEdit,
}: {
  generateAwgKeys: () => Promise<void>;
  applyAwgPreset: (preset: 'tspu' | 'mobile' | 'custom') => void;
  keypairPending: boolean;
  form: UseFormReturnType<FormValues>;
  isEdit: boolean;
}) {
  const { t } = useTranslation();
  return (
            <Stack>
              {/* AmneziaWG-specific gotchas in one place. Per upstream
                  amnezia.org docs: (a) pre-4.8.12.9 AmneziaVPN clients
                  silently don't recognize S3/S4 v2.0 fields - handshake
                  fails without error. (b) AmneziaWG 1.0 credentials are
                  not interchangeable with 2.0 - fresh keys required for
                  every peer when migrating. (c) port choice matters -
                  upstream recommends < 9999 because some ISPs block
                  high UDP ports; 51820 is the well-known WG default
                  and is specifically targeted by DPI. Port is set on
                  the binding (Nodes → Edit), not here. */}
              <Alert color="blue" variant="light" p="xs">
                <Text size="xs" component="div">
                  <strong>{t('profileForm.awgImportantTitle')}</strong>
                  <ul style={{ margin: '4px 0 0 16px', paddingLeft: 0 }}>
                    <li>{t('profileForm.awgImportant1')}</li>
                    <li>{t('profileForm.awgImportant2')}</li>
                    <li>{t('profileForm.awgImportant3')}</li>
                  </ul>
                </Text>
              </Alert>
              {/* Subnet and both keys read as one decision, so they sit on one
                  line. The subnet note differs by mode: before the first save it
                  is advice, afterwards it is a consequence. */}
              <Group align="flex-start" wrap="nowrap" gap="md">
                <TextInput
                  w={220}
                  label={t('profiles.form.cfg.awgSubnetLabel')}
                  placeholder="10.66.66.0/24"
                  description={
                    isEdit
                      ? t('profiles.form.cfg.awgSubnetLockedHint')
                      : t('profiles.form.cfg.awgSubnetHint')
                  }
                  // The note explains the field, so it reads after it. Without
                  // this the row's inputs stop sharing a baseline.
                  inputWrapperOrder={['label', 'input', 'description', 'error']}
                  required
                  {...form.getInputProps('awgSubnet')}
                />
                <Group flex={1} align="end" wrap="nowrap" gap="xs">
                  <PasswordInput
                    flex={1}
                    label={t('profiles.form.cfg.awgServerPrivLabel')}
                    required
                    {...form.getInputProps('awgServerPriv')}
                  />
                  <Button
                    leftSection={<IconKey size={14} />}
                    variant="light"
                    loading={keypairPending}
                    onClick={generateAwgKeys}
                    type="button"
                  >
                    {t('profiles.form.cfg.generate')}
                  </Button>
                </Group>
                <TextInput
                  flex={1}
                  label={t('profiles.form.cfg.awgServerPubLabel')}
                  placeholder={t('profiles.form.cfg.awgServerPubPlaceholder')}
                  required
                  {...form.getInputProps('awgServerPub')}
                />
              </Group>
              <Group justify="space-between" align="center" wrap="nowrap" gap="md">
                <Text size="sm" fw={500}>
                  {t('profiles.form.cfg.awgPresetLabel')}
                </Text>
                <SegmentedControl
                  value={form.values.awgPreset}
                  onChange={(v) => applyAwgPreset(v as 'tspu' | 'mobile' | 'custom')}
                  data={[
                    { label: 'TSPU (Russia DPI)', value: 'tspu' },
                    { label: 'Mobile', value: 'mobile' },
                    { label: 'Custom', value: 'custom' },
                  ]}
                />
              </Group>
              <Group grow>
                <NumberInput label="Jc" min={0} {...form.getInputProps('awgJc')} />
                <NumberInput label="Jmin" min={0} {...form.getInputProps('awgJmin')} />
                <NumberInput label="Jmax" min={0} {...form.getInputProps('awgJmax')} />
              </Group>
              <Group grow>
                <NumberInput label="S1" min={0} {...form.getInputProps('awgS1')} />
                <NumberInput label="S2" min={0} {...form.getInputProps('awgS2')} />
                {/* S3/S4 stay 0 until AmneziaVPN ships the fix for #2582: a
                    non-zero value there drops traffic on 4.8.15.x clients. */}
                <NumberInput
                  label="S3"
                  description={t('profiles.form.cfg.awgKeepZero')}
                  inputWrapperOrder={['label', 'input', 'description', 'error']}
                  min={0}
                  {...form.getInputProps('awgS3')}
                />
                <NumberInput
                  label="S4"
                  description={t('profiles.form.cfg.awgKeepZero')}
                  inputWrapperOrder={['label', 'input', 'description', 'error']}
                  min={0}
                  {...form.getInputProps('awgS4')}
                />
              </Group>
              <Group align="flex-end" gap="xs" wrap="nowrap">
                <NumberInput
                  flex={1}
                  label="H1"
                  description="magic header byte"
                  min={5}
                  max={2147483647}
                  {...form.getInputProps('awgH1')}
                />
                <NumberInput
                  flex={1}
                  label="H2"
                  description={t('profiles.form.cfg.awgS1Desc')}
                  min={5}
                  max={2147483647}
                  {...form.getInputProps('awgH2')}
                />
                <NumberInput
                  flex={1}
                  label="H3"
                  description={t('profiles.form.cfg.awgJDesc')}
                  min={5}
                  max={2147483647}
                  {...form.getInputProps('awgH3')}
                />
                <NumberInput
                  flex={1}
                  label="H4"
                  description={t('profiles.form.cfg.awgHDesc')}
                  min={5}
                  max={2147483647}
                  {...form.getInputProps('awgH4')}
                />
                <Button
                  variant="light"
                  type="button"
                  leftSection={<IconKey size={14} />}
                  onClick={() => {
                    const h = randomAwgHeaders();
                    form.setValues({
                      ...form.values,
                      awgH1: h.h1,
                      awgH2: h.h2,
                      awgH3: h.h3,
                      awgH4: h.h4,
                    });
                  }}
                >
                  Re-roll
                </Button>
              </Group>
              {/* I1-I5 mimicry packets - power-user feature, 99% of
                  operators don't need them. Hidden behind a collapsible
                  section so the main form stays clean. Standard pattern
                  for "you probably don't want this, but it exists". */}
              <Accordion variant="separated" radius="sm">
                <Accordion.Item value="awg-mimicry">
                  <Accordion.Control>
                    <Text size="sm" fw={500}>
                      {t('profiles.form.cfg.awgMimicryTitle')}
                    </Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap={6}>
                      <Text size="xs" c="dimmed">
                        {t('profiles.form.cfg.awgMimicryDesc')}
                      </Text>
                      <Group grow>
                        <TextInput label="I1" placeholder="hex" {...form.getInputProps('awgI1')} />
                        <TextInput label="I2" placeholder="hex" {...form.getInputProps('awgI2')} />
                        <TextInput label="I3" placeholder="hex" {...form.getInputProps('awgI3')} />
                      </Group>
                      <Group grow>
                        <TextInput label="I4" placeholder="hex" {...form.getInputProps('awgI4')} />
                        <TextInput label="I5" placeholder="hex" {...form.getInputProps('awgI5')} />
                      </Group>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              {(() => {
                // Live H-uniqueness validator. Empty values pass - let the
                // `required` semantics fire on submit instead.
                const vals = [
                  form.values.awgH1,
                  form.values.awgH2,
                  form.values.awgH3,
                  form.values.awgH4,
                ].filter((v) => v !== '');
                const set = new Set(vals);
                if (vals.length === 4 && set.size < 4) {
                  return (
                    <Alert color="red" variant="light" p="xs">
                      <Text size="xs">
                        {t('profiles.form.cfg.awgHWarning')}
                      </Text>
                    </Alert>
                  );
                }
                return null;
              })()}
            </Stack>
  );
}
