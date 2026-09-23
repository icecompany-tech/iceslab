import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import {
  IconBolt,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconShieldLock,
} from '@tabler/icons-react';
import { testConnectProfile, type TestConnectResult, type Profile } from '@/lib/domain/profiles';

interface Props {
  profile: Profile | null;
  onClose: () => void;
}

/**
 * Slice 31: the operator asks for a connection test on a profile, and the
 * panel fires outbound probes against every binding × host. Results appear as
 * green / red rows with the TLS handshake CN, latency, or the probe error.
 * UDP-based protocols (Hysteria/AmneziaWG/Mieru) get a yellow caveat: the
 * TCP-port probe does not actually validate them.
 *
 * The point is that a fresh inbound can be checked without ssh to the node
 * and a hand-run curl/openssl: one click, and the panel does the network IO
 * from its container, the same network path the subscription generator uses.
 *
 * The door is on the profile page (ProfileEditPage), next to the save bar.
 */
export function TestConnectModal({ profile, onClose }: Props) {
  const { t } = useTranslation();
  const [results, setResults] = useState<TestConnectResult[] | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => testConnectProfile(id),
    onSuccess: (data) => setResults(data.results),
  });
  const { mutate } = mutation;
  const profileId = profile?.id ?? null;

  /**
   * Открыли для другого профиля: старые результаты больше не про него.
   *
   * Сброс делается сравнением в рендере, а не в эффекте. В эффекте он приезжал
   * ПОСЛЕ отрисовки, то есть кадр между открытием и ответом показывал чужие
   * результаты как свои.
   */
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (profileId !== null && shownFor !== profileId) {
    setShownFor(profileId);
    setResults(null);
  }

  // Запрос сам по себе это побочное действие, и ему место именно в эффекте.
  // `mutate` у react-query стабильна, поэтому список зависимостей честный и
  // глушить правило нечем.
  useEffect(() => {
    if (!profileId) return;
    mutate(profileId);
  }, [profileId, mutate]);

  return (
    <Modal
      opened={profile !== null}
      onClose={onClose}
      title={
        <Group gap="sm">
          <ThemeIcon size={28} radius="md" variant="light" color="cyan">
            <IconBolt size={16} />
          </ThemeIcon>
          <Stack gap={0}>
            <Text fw={600}>{t('testConnect.title')}</Text>
            <Text size="xs" c="dimmed">
              {profile?.name}
            </Text>
          </Stack>
        </Group>
      }
      size="lg"
    >
      <Stack gap="sm">
        <Alert color="blue" variant="light" icon={<IconShieldLock size={14} />}>
          {t('testConnect.scope')}
        </Alert>

        {mutation.isPending && (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            {t('testConnect.running')}
          </Text>
        )}

        {mutation.isError && (
          <Alert color="red" variant="light">
            {mutation.error instanceof Error ? mutation.error.message : t('testConnect.failed')}
          </Alert>
        )}

        {results && results.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            {t('testConnect.empty')}
          </Text>
        )}

        {results && results.length > 0 && (
          <Stack gap={4}>
            {results.map((r, i) => (
              <ResultRow key={`${r.bindingId}-${r.hostId ?? i}`} result={r} />
            ))}
          </Stack>
        )}

        <Group justify="space-between">
          <Button
            variant="light"
            loading={mutation.isPending}
            disabled={!profile}
            onClick={() => {
              if (profile) {
                setResults(null);
                mutation.mutate(profile.id);
              }
            }}
          >
            {t('testConnect.rerun')}
          </Button>
          <Button variant="subtle" onClick={onClose}>
            {t('testConnect.close')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ResultRow({ result }: { result: TestConnectResult }) {
  const { t } = useTranslation();
  const okColor = result.ok ? 'teal' : 'red';
  const Icon = result.ok ? IconCircleCheck : IconCircleX;
  return (
    <Paper
      withBorder
      p="xs"
      radius="sm"
      style={{
        borderLeft: `3px solid var(--mantine-color-${okColor}-6)`,
      }}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap">
            <ThemeIcon size={20} radius="xl" variant="light" color={okColor}>
              <Icon size={14} />
            </ThemeIcon>
            <Text size="sm" fw={500} truncate>
              {result.nodeName}
            </Text>
            <Badge size="xs" variant="light" color="grape">
              {result.hostRemark}
            </Badge>
            <Badge size="xs" variant="light" color="gray" tt="uppercase">
              {result.probe}
            </Badge>
          </Group>
          <Group gap={6} wrap="wrap">
            <Code style={{ fontSize: 11 }}>
              {result.endpoint}:{result.port}
            </Code>
            {result.sni && (
              <Tooltip label={t('testConnect.sniHint')}>
                <Code style={{ fontSize: 11 }}>SNI={result.sni}</Code>
              </Tooltip>
            )}
            {result.certCn && (
              <Tooltip label={t('testConnect.certHint')}>
                <Code style={{ fontSize: 11 }}>cert={result.certCn}</Code>
              </Tooltip>
            )}
            {result.tlsVersion && (
              <Tooltip label={t('testConnect.tlsHint')}>
                <Code
                  style={{ fontSize: 11 }}
                  c={result.tlsVersion !== 'TLSv1.3' && result.kind === 'dest' ? 'red' : undefined}
                >
                  {result.tlsVersion}
                </Code>
              </Tooltip>
            )}
          </Group>
          {result.error && (
            <Text size="xs" c="red">
              {result.error}
            </Text>
          )}
          {result.notes && (
            <Text size="xs" c="yellow">
              ⚠ {result.notes}
            </Text>
          )}
        </Stack>
        {typeof result.latencyMs === 'number' && (
          <Group gap={4} wrap="nowrap">
            <IconClock size={12} />
            <Text size="xs" ff="monospace">
              {result.latencyMs}ms
            </Text>
          </Group>
        )}
      </Group>
    </Paper>
  );
}
