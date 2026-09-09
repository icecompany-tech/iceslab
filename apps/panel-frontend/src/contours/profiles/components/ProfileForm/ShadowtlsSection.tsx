import { Alert, Select, Stack, Text, TextInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

export function ShadowtlsSection({
  form,
}: {
  form: UseFormReturnType<FormValues>;
}) {
  return (
            <Stack>
              <TextInput
                label="Handshake domain (camouflage SNI)"
                placeholder="www.microsoft.com"
                description="A whitelisted site the ShadowTLS layer fronts with a real TLS handshake. The inner Shadowsocks key is auto-generated; the per-user password is auto-derived."
                {...form.getInputProps('shadowtlsHandshake')}
              />
              <Select
                label="Inner Shadowsocks cipher"
                data={[
                  { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm (recommended)' },
                  { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm' },
                  { value: '2022-blake3-chacha20-poly1305', label: '2022-blake3-chacha20-poly1305' },
                ]}
                allowDeselect={false}
                {...form.getInputProps('shadowtlsSsMethod')}
              />
              <Alert color="blue" variant="light">
                <Text size="sm">
                  ShadowTLS has no share link. It is emitted only in the sing-box and Clash (mihomo) subscription formats.
                </Text>
              </Alert>
            </Stack>
  );
}
