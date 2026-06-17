import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { PageHero } from '../components/PageHero';
import { PrimaryButton } from '../components/PrimaryButton';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconEdit, IconBolt, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react';
import {
  createSrrRule,
  deleteSrrRule,
  listSrrRules,
  testSrrRule,
  updateSrrRule,
  type CreateSrrInput,
  type SrrRule,
  type UpdateSrrInput,
} from '../lib/api';
import { SrrFormModal } from '../components/SrrFormModal';

const FORMAT_COLORS: Record<string, string> = {
  plain: 'gray',
  json: 'gray',
  clash: 'green',
  singbox: 'blue',
  wgconf: 'teal',
  xrayjson: 'violet',
  xkeen: 'grape',
  outline: 'cyan',
  surge: 'orange',
  quantumultx: 'pink',
  loon: 'indigo',
};

export function SrrPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<SrrRule | null>(null);

  const rulesQuery = useQuery({ queryKey: ['srr'], queryFn: listSrrRules });

  const createMutation = useMutation({
    mutationFn: createSrrRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['srr'] });
      notifications.show({ color: 'green', message: t('srr.notify.created') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSrrInput }) => updateSrrRule(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['srr'] });
      notifications.show({ color: 'green', message: t('srr.notify.updated') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  // Inline enable/disable straight from the table. Optimistic so rapid on/off
  // feels instant; rolls back + toasts on failure. No success toast - the
  // switch position is the confirmation, and a toast per flip would spam.
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateSrrRule(id, { enabled }),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: ['srr'] });
      const prev = qc.getQueryData<{ rules: SrrRule[] }>(['srr']);
      if (prev) {
        qc.setQueryData<{ rules: SrrRule[] }>(['srr'], {
          rules: prev.rules.map((r) => (r.id === id ? { ...r, enabled } : r)),
        });
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['srr'], ctx.prev);
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['srr'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSrrRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['srr'] });
      notifications.show({ color: 'green', message: t('srr.notify.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(rule: SrrRule) {
    modals.openConfirmModal({
      title: t('srr.deleteTitle', { name: rule.name }),
      children: <Text size="sm">{t('srr.deleteBody')}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(rule.id),
    });
  }

  // ─── UA tester ───
  const [testUa, setTestUa] = useState('');
  const [testResult, setTestResult] = useState<{ format: string | null } | null>(null);
  const testMutation = useMutation({
    mutationFn: testSrrRule,
    onSuccess: (data) => setTestResult({ format: data.format }),
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('srr.notify.testFailed'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  return (
    <Stack>
      <PageHero
        eyebrow={t('pageHero.srrEyebrow', {
          count: rulesQuery.data?.rules.length ?? 0,
          label:
            (rulesQuery.data?.rules.length ?? 0) === 1
              ? t('pageHero.srrLabelOne')
              : t('pageHero.srrLabelMany'),
        })}
        title={t('pageHero.srrTitle')}
        subtitle={
          <>
            {t('srr.subtitlePrefix')} <Code>priority ASC</Code> {t('srr.subtitleMid')}{' '}
            <Code>User-Agent</Code> {t('srr.subtitleSuffix')} <Code>900</Code>.
          </>
        }
        right={
          <Group gap={8}>
            <Tooltip label={t('common.refresh')}>
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => qc.invalidateQueries({ queryKey: ['srr'] })}
                loading={rulesQuery.isFetching}
                style={{ color: '#7A8BA3' }}
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
            <PrimaryButton leftSection={<IconPlus size={14} />} onClick={openCreate}>
              {t('srr.create')}
            </PrimaryButton>
          </Group>
        }
      />

      <Table.ScrollContainer minWidth={800}>
        <Table verticalSpacing="sm" highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 80 }}>{t('srr.columns.priority')}</Table.Th>
              <Table.Th>{t('srr.columns.name')}</Table.Th>
              <Table.Th>{t('srr.columns.uaPattern')}</Table.Th>
              <Table.Th>{t('srr.columns.format')}</Table.Th>
              <Table.Th style={{ width: 80 }}>{t('srr.columns.enabled')}</Table.Th>
              <Table.Th style={{ width: 1 }}>{t('common.actions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rulesQuery.data?.rules.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center" py="md">
                    {t('srr.empty')}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {rulesQuery.data?.rules.map((r) => (
              <Table.Tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
                <Table.Td>
                  <Code>{r.priority}</Code>
                </Table.Td>
                <Table.Td>
                  <Text fw={500}>{r.name}</Text>
                </Table.Td>
                <Table.Td>
                  <Code>{r.uaPattern}</Code>
                </Table.Td>
                <Table.Td>
                  <Badge color={FORMAT_COLORS[r.format] ?? 'gray'} variant="light">
                    {r.format}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Switch
                    size="sm"
                    checked={r.enabled}
                    onChange={(e) =>
                      toggleMutation.mutate({ id: r.id, enabled: e.currentTarget.checked })
                    }
                    aria-label={t('srr.columns.enabled')}
                  />
                </Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label={t('common.edit')}>
                      <ActionIcon variant="subtle" onClick={() => setEditing(r)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={t('common.delete')}>
                      <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(r)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Card withBorder>
        <Stack>
          <Group>
            <IconBolt size={18} />
            <Text fw={600}>{t('srr.testTitle')}</Text>
          </Group>
          <Group align="end" wrap="nowrap">
            <TextInput
              flex={1}
              placeholder={t('srr.testPlaceholder')}
              value={testUa}
              onChange={(e) => setTestUa(e.currentTarget.value)}
            />
            <Button
              loading={testMutation.isPending}
              disabled={testUa.trim().length === 0}
              onClick={() => testMutation.mutate(testUa)}
            >
              {t('srr.testButton')}
            </Button>
          </Group>
          {testResult && (
            <Text size="sm">
              {testResult.format === null ? (
                <>{t('srr.testNoMatch')} <Code>plain</Code>.</>
              ) : (
                <>
                  {t('srr.testMatchPrefix')}{' '}
                  <Badge color={FORMAT_COLORS[testResult.format] ?? 'gray'}>{testResult.format}</Badge>
                </>
              )}
            </Text>
          )}
        </Stack>
      </Card>

      <SrrFormModal
        opened={createOpen}
        onClose={closeCreate}
        rule={null}
        loading={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input as CreateSrrInput);
        }}
      />
      <SrrFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        rule={editing}
        loading={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editing) return;
          await updateMutation.mutateAsync({ id: editing.id, input: input as UpdateSrrInput });
        }}
      />
    </Stack>
  );
}
