import { useTranslation } from 'react-i18next';
import {
  Alert,
  Group,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronDown, IconKey } from '@tabler/icons-react';
import {
  PATH_HOST_TRANSPORTS,
  XRAY_TRANSPORTS,
} from '@/contours/profiles/lib/xrayTransports';
import { PillChip } from '@/contours/profiles/components/ProfileForm/PillChip';
import { StepLabel } from '@/contours/profiles/components/ProfileForm/StepLabel';
import type { UseFormReturnType } from '@mantine/form';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';
import { XrayAdvanced } from '@/contours/profiles/components/ProfileForm/XrayAdvanced';

export function XraySection({
  generateXrayKeys,
  keypairPending,
  form,
  advOpen,
  advCtl,
}: {
  generateXrayKeys: () => Promise<void>;
  keypairPending: boolean;
  form: UseFormReturnType<FormValues>;
  advOpen: boolean;
  advCtl: { toggle: () => void; open: () => void; close: () => void };
}) {
  const { t } = useTranslation();
  return (
            <Stack>
              {/* The three decisions in one row, the way the artboard frames
                  them: what it speaks, how it travels, how it hides. Transport
                  gets the widest lane because it holds six pills; their shared
                  hint sits under the row so the columns stay aligned. */}
              <Group align="flex-start" gap={24} wrap="nowrap" style={{ width: '100%' }}>
                <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
                  <StepLabel>{t('profiles.form.cfg.stepProtocol')}</StepLabel>
                  <Group gap={8}>
                    {(['vless', 'vmess', 'trojan'] as const).map((v) => (
                      <PillChip
                        key={v}
                        label={v === 'vless' ? 'VLESS' : v === 'vmess' ? 'VMess' : 'Trojan'}
                        active={form.values.xraySubprotocol === v}
                        onClick={() => form.setFieldValue('xraySubprotocol', v)}
                      />
                    ))}
                  </Group>
                </Stack>

                <Stack gap={8} style={{ flex: 2, minWidth: 0 }}>
                  <StepLabel>{t('profiles.form.cfg.stepTransport')}</StepLabel>
                  <Group gap={8}>
                    {/* What each transport actually is stays on hover: the
                        artboard keeps this row to pills alone. */}
                    {XRAY_TRANSPORTS.map((tr) => (
                      <PillChip
                        key={tr.value}
                        label={tr.label}
                        title={tr.hint}
                        active={form.values.xrayNetwork === tr.value}
                        onClick={() => form.setFieldValue('xrayNetwork', tr.value)}
                      />
                    ))}
                  </Group>
                </Stack>

                <Stack gap={8} style={{ flex: 1.2, minWidth: 0 }}>
                  <StepLabel>{t('profiles.form.cfg.stepSecurity')}</StepLabel>
                  <Group gap={8}>
                    <PillChip
                      label="REALITY"
                      title="TLS-replacement, no domain or certificate needed."
                      active={form.values.xraySecurity === 'reality'}
                      disabled={form.values.xraySubprotocol === 'vmess'}
                      onClick={() => form.setFieldValue('xraySecurity', 'reality')}
                    />
                    <PillChip
                      label="none"
                      title="Plain transport, for a CDN that terminates TLS in front."
                      active={form.values.xraySecurity === 'none'}
                      onClick={() => form.setFieldValue('xraySecurity', 'none')}
                    />
                    <PillChip
                      label="TLS"
                      title="The node terminates TLS with your own certificate."
                      active={form.values.xraySecurity === 'tls'}
                      onClick={() => form.setFieldValue('xraySecurity', 'tls')}
                    />
                  </Group>
                </Stack>
              </Group>

              {PATH_HOST_TRANSPORTS.includes(form.values.xrayNetwork) && (
                <Group grow align="flex-start">
                  <TextInput
                    label="Path"
                    description={t('profiles.form.cfg.xhttpPathDesc')}
                    placeholder="/api/v1/stream"
                    {...form.getInputProps('xrayPath')}
                  />
                  <TextInput
                    label="Host header"
                    description={t('profiles.form.cfg.hostHeaderDesc')}
                    placeholder="cdn.example.com"
                    {...form.getInputProps('xrayHostHeader')}
                  />
                </Group>
              )}
              {form.values.xrayNetwork === 'grpc' && (
                <TextInput
                  label="gRPC serviceName"
                  description={t('profiles.form.cfg.grpcServiceNameDesc')}
                  placeholder="GunService"
                  required
                  {...form.getInputProps('xrayServiceName')}
                />
              )}
              {form.values.xrayNetwork === 'kcp' && (
                <Alert color="blue" variant="light" p="xs">
                  <Text size="xs">
                    mKCP renders with safe defaults on the node (header type none).
                    It is UDP-based: do not place it on a UDP port already used by
                    Hysteria or AmneziaWG on this node.
                  </Text>
                </Alert>
              )}

              {/* The four settings an operator actually touches per profile,
                  in one row. Dest, fingerprint, flow and the public key live
                  under Advanced: they are either derived or set once. */}
              {form.values.xraySecurity === 'reality' && (
                <Group align="flex-start" gap={16} wrap="nowrap" style={{ width: '100%' }}>
                  <Select
                    style={{ flex: 1.4, minWidth: 0 }}
                    label={t('profiles.form.cfg.realityModeLabel')}
                    data={[
                      { value: 'steal-others', label: t('profiles.form.cfg.realityModeStealOthers') },
                      { value: 'self-steal', label: t('profiles.form.cfg.realityModeSelfSteal') },
                    ]}
                    {...form.getInputProps('xrayRealityMode')}
                  />
                  <TextInput
                    style={{ flex: 1.2, minWidth: 0 }}
                    label={
                      form.values.xrayRealityMode === 'self-steal'
                        ? t('profiles.form.cfg.realitySelfStealDomainLabel')
                        : t('profiles.form.cfg.serverNamesLabel')
                    }
                    placeholder={
                      form.values.xrayRealityMode === 'self-steal'
                        ? 'des-01.example.com'
                        : 'node1.example.com'
                    }
                    required
                    {...form.getInputProps('xrayServerNames')}
                  />
                  <TextInput
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('profiles.form.cfg.shortIdsLabel')}
                    placeholder="6ba85179e30d4fc2"
                    required
                    {...form.getInputProps('xrayShortIds')}
                  />
                  <Stack gap={6} style={{ flex: 1.2, minWidth: 0 }}>
                    <StepLabel>{t('profiles.form.cfg.keypairLabel')}</StepLabel>
                    <Group gap={8} wrap="nowrap" style={{ width: '100%' }}>
                      <PasswordInput
                        style={{ flex: 1, minWidth: 0 }}
                        placeholder={t('profiles.form.cfg.keypairPlaceholder')}
                        required
                        {...form.getInputProps('xrayPrivateKey')}
                      />
                      <UnstyledButton
                        type="button"
                        onClick={generateXrayKeys}
                        disabled={keypairPending}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          height: 36,
                          padding: '0 14px',
                          borderRadius: 8,
                          backgroundColor: '#0B1420',
                          border: '1px solid #1C2A3D',
                          flexShrink: 0,
                        }}
                      >
                        <IconKey size={14} color="#7DD3FC" stroke={1.8} />
                        <Text
                          style={{
                            fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                            fontSize: 12,
                            fontWeight: 500,
                            lineHeight: '16px',
                            color: '#C8D4E3',
                          }}
                        >
                          {t('profiles.form.cfg.generate')}
                        </Text>
                      </UnstyledButton>
                    </Group>
                  </Stack>
                </Group>
              )}
              {form.values.xraySecurity === 'tls' && (
                <>
                  <TextInput
                    label="TLS serverName (SNI)"
                    description="Domain on the certificate; the client sends it as SNI."
                    placeholder="vpn.example.com"
                    {...form.getInputProps('xrayTlsServerName')}
                  />
                  <Textarea
                    label="TLS certificate (PEM)"
                    description="Full chain. Embedded inline into the node config (no ACME)."
                    placeholder="-----BEGIN CERTIFICATE-----"
                    autosize
                    minRows={3}
                    maxRows={6}
                    {...form.getInputProps('xrayTlsCert')}
                  />
                  <Textarea
                    label="TLS private key (PEM)"
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    autosize
                    minRows={3}
                    maxRows={6}
                    {...form.getInputProps('xrayTlsKey')}
                  />
                </>
              )}

              {/* B3: advanced xray knobs, grouped into tabs so the common
                  path stays clean. Each control is gated on the same
                  security/network the field actually applies to (REALITY tab
                  when security=reality, TLS tab when security=tls, the xhttp
                  controls when network=xhttp, grpc control when network=grpc).
                  Tabs whose underlying transport/security isn't selected just
                  render an inactive hint, so the operator sees why. */}
              {/* Collapsed by default: the row above is the whole decision for
                  a normal profile, and these knobs are the exception. */}
              <UnstyledButton
                type="button"
                onClick={advCtl.toggle}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '13px 16px',
                  borderRadius: 10,
                  backgroundColor: '#0B1420',
                  border: '1px solid #1C2A3D',
                }}
              >
                <Text
                  style={{
                    fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                    fontSize: 13,
                    lineHeight: '16px',
                    color: '#C8D4E3',
                  }}
                >
                  {t('profiles.form.cfg.advTitle')}
                </Text>
                <Group gap={10} wrap="nowrap">
                  <Text style={{ fontSize: 11, lineHeight: '14px', color: '#5A6B82' }}>
                    {t('profiles.form.cfg.advHint')}
                  </Text>
                  <IconChevronDown
                    size={14}
                    stroke={2}
                    color="#7A8BA3"
                    style={{
                      transform: advOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 120ms',
                    }}
                  />
                </Group>
              </UnstyledButton>
              <XrayAdvanced form={form} advOpen={advOpen} />
            </Stack>
  );
}

