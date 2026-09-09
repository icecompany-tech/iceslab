import { useTranslation } from 'react-i18next';
import type { UseFormReturnType } from '@mantine/form';
import {
  Collapse,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';
import { FLOW_COMPATIBLE_TRANSPORTS } from '@/contours/profiles/lib/xrayTransports';

/**
 * The xray fields behind the "advanced" toggle: REALITY material, transport
 * tuning and the raw-config escape hatch. Split out so the visible part of the
 * xray form stays readable on its own.
 */
export function XrayAdvanced({
  form,
  advOpen,
}: {
  form: UseFormReturnType<FormValues>;
  advOpen: boolean;
}) {
  const { t } = useTranslation();

  return (
              <Collapse in={advOpen}>
              <Tabs defaultValue="reality" variant="outline">
                <Tabs.List>
                  <Tabs.Tab value="reality">{t('profiles.form.cfg.advRealityTab')}</Tabs.Tab>
                  <Tabs.Tab value="tls">{t('profiles.form.cfg.advTlsTab')}</Tabs.Tab>
                  <Tabs.Tab value="transport">{t('profiles.form.cfg.advTransportTab')}</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="reality" pt="sm">
                  {form.values.xraySecurity === 'reality' ? (
                    <Stack gap="sm">
                      {/* Moved down from the main row: set once per profile,
                          derived, or only meaningful in one REALITY mode. */}
                      <Group grow align="flex-end">
                        <TextInput
                          label="REALITY dest (target site)"
                          description={t('profiles.form.cfg.realityDestDesc')}
                          placeholder="www.cloudflare.com:443"
                          required={form.values.xrayRealityMode !== 'self-steal'}
                          disabled={form.values.xrayRealityMode === 'self-steal'}
                          {...form.getInputProps('xrayDest')}
                        />
                        <Select
                          label="Fingerprint"
                          description={t('profiles.form.cfg.realityFingerprintDesc')}
                          data={['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random']}
                          {...form.getInputProps('xrayFingerprint')}
                        />
                      </Group>
                      <Group grow align="flex-end">
                        <TextInput
                          label="REALITY public key"
                          description={t('profiles.form.cfg.realityPublicKeyDesc')}
                          required
                          {...form.getInputProps('xrayPublicKey')}
                        />
                        <Select
                          label="Flow"
                          description={t('profiles.form.cfg.realityFlowDesc')}
                          data={[
                            { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
                            { value: 'xtls-rprx-vision-udp443', label: 'xtls-rprx-vision-udp443' },
                            { value: '', label: t('profiles.form.cfg.realityFlowNone') },
                          ]}
                          disabled={
                            form.values.xraySubprotocol !== 'vless' ||
                            !FLOW_COMPATIBLE_TRANSPORTS.includes(form.values.xrayNetwork)
                          }
                          {...form.getInputProps('xrayFlow')}
                        />
                      </Group>
                      {form.values.xrayRealityMode === 'self-steal' && (
                        <TextInput
                          label={t('profiles.form.cfg.realityFallbackUpstreamLabel')}
                          description={t('profiles.form.cfg.realityFallbackUpstreamDesc')}
                          placeholder="https://example.com"
                          {...form.getInputProps('xrayRealityFallbackUpstream')}
                        />
                      )}
                      <Group grow align="flex-end">
                        <Select
                          label={t('profiles.form.cfg.realityXverLabel')}
                          description={t('profiles.form.cfg.realityXverDesc')}
                          data={[
                            { value: '0', label: '0' },
                            { value: '1', label: '1' },
                            { value: '2', label: '2' },
                          ]}
                          allowDeselect={false}
                          value={String(form.values.xrayRealityXver)}
                          onChange={(v) =>
                            form.setFieldValue(
                              'xrayRealityXver',
                              (Number(v) as FormValues['xrayRealityXver']) || 0,
                            )
                          }
                        />
                        <NumberInput
                          label={t('profiles.form.cfg.realityMaxTimeDiffLabel')}
                          description={t('profiles.form.cfg.realityMaxTimeDiffDesc')}
                          placeholder="0"
                          min={0}
                          {...form.getInputProps('xrayRealityMaxTimeDiff')}
                        />
                      </Group>
                      {/* G: throttle the unverified fallback path so a prober
                          that fails REALITY auth sees a slow site, not a proxy. */}
                      <Text size="xs" fw={500}>
                        {t('profiles.form.cfg.realityFallbackRateGroup')}
                      </Text>
                      <Group grow align="flex-end">
                        <NumberInput
                          label={t('profiles.form.cfg.realityLimitFallbackUploadLabel')}
                          description={t('profiles.form.cfg.realityLimitFallbackUploadDesc')}
                          placeholder="0"
                          min={0}
                          {...form.getInputProps('xrayRealityLimitFallbackUpload')}
                        />
                        <NumberInput
                          label={t('profiles.form.cfg.realityLimitFallbackDownloadLabel')}
                          description={t('profiles.form.cfg.realityLimitFallbackDownloadDesc')}
                          placeholder="0"
                          min={0}
                          {...form.getInputProps('xrayRealityLimitFallbackDownload')}
                        />
                      </Group>
                    </Stack>
                  ) : (
                    <Text size="xs" c="dimmed">
                      {t('profiles.form.cfg.advRealityInactive')}
                    </Text>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="tls" pt="sm">
                  {form.values.xraySecurity === 'tls' ? (
                    <Switch
                      label={t('profiles.form.cfg.tlsRejectUnknownSniLabel')}
                      description={t('profiles.form.cfg.tlsRejectUnknownSniDesc')}
                      {...form.getInputProps('xrayTlsRejectUnknownSni', { type: 'checkbox' })}
                    />
                  ) : (
                    <Text size="xs" c="dimmed">
                      {t('profiles.form.cfg.advTlsInactive')}
                    </Text>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="transport" pt="sm">
                  {form.values.xrayNetwork === 'xhttp' ? (
                    <Stack gap="sm">
                      <Select
                        label={t('profiles.form.cfg.xhttpModeLabel')}
                        description={t('profiles.form.cfg.xhttpModeDesc')}
                        data={[
                          { value: 'auto', label: 'auto' },
                          { value: 'packet-up', label: 'packet-up' },
                          { value: 'stream-up', label: 'stream-up' },
                          { value: 'stream-one', label: 'stream-one' },
                        ]}
                        allowDeselect={false}
                        {...form.getInputProps('xrayXhttpMode')}
                      />
                      <TextInput
                        label={t('profiles.form.cfg.xhttpPaddingBytesLabel')}
                        description={t('profiles.form.cfg.xhttpPaddingBytesDesc')}
                        placeholder="100-1000"
                        {...form.getInputProps('xrayXhttpPaddingBytes')}
                      />
                    </Stack>
                  ) : form.values.xrayNetwork === 'grpc' ? (
                    <Switch
                      label={t('profiles.form.cfg.grpcMultiModeLabel')}
                      description={t('profiles.form.cfg.grpcMultiModeDesc')}
                      {...form.getInputProps('xrayGrpcMultiMode', { type: 'checkbox' })}
                    />
                  ) : (
                    <Text size="xs" c="dimmed">
                      {t('profiles.form.cfg.advTransportInactive')}
                    </Text>
                  )}
                </Tabs.Panel>
              </Tabs>
              </Collapse>
  );
}
