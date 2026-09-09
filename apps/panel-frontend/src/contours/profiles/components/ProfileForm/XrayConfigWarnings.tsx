import { useTranslation } from 'react-i18next';
import { Alert, Stack, Text } from '@mantine/core';
import { validateXrayConfig } from '@/contours/profiles/lib/recipes';
import type { UseFormReturnType } from '@mantine/form';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

export function XrayConfigWarnings({
  form,
}: {
  form: UseFormReturnType<FormValues>;
}) {
  const { t } = useTranslation();
    const issues = validateXrayConfig({
      xrayNetwork: form.values.xrayNetwork,
      xrayFlow: form.values.xrayFlow,
      xraySubprotocol: form.values.xraySubprotocol,
    });
    if (issues.length === 0) return null;
    return (
      <Stack gap={4}>
        {issues.map((iss, i) => (
          <Alert
            key={i}
            color={
              iss.level === 'error'
                ? 'red'
                : iss.level === 'warning'
                  ? 'yellow'
                  : 'blue'
            }
            variant="light"
            p="xs"
          >
            <Text size="xs">{t(iss.key, iss.args ?? {})}</Text>
          </Alert>
        ))}
      </Stack>
    );
}
