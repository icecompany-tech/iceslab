import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  Group,
  NumberInput,
  Radio,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconCheck, IconRoute, IconRss } from '@tabler/icons-react';
import type { RoutingPresetId } from '@iceslab/shared';
import { PageHero } from '../components/PageHero';
import { PrimaryButton } from '../components/PrimaryButton';
import { getSettings, updateSettings } from '../lib/api';

/**
 * Admin-facing editor for the headers `/sub/:token` emits to client apps:
 * Profile-Title (display name), Profile-Update-Interval (refresh cadence),
 * Support-URL, and an Announce template with `{{TRAFFIC_LEFT}}`,
 * `{{DAYS_LEFT}}`, `{{SUPPORT_URL}}` placeholders rendered per request.
 *
 * Subscription-Userinfo (quota gauge) is auto-emitted from user state, not
 * configurable here. Lived under Settings before — promoted to its own
 * page under the Subscription section so operators stop hunting for it.
 */
export function SubscriptionMetadataPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['settings', 'all'],
    queryFn: getSettings,
  });

  const [profileTitle, setProfileTitle] = useState('');
  const [intervalHours, setIntervalHours] = useState<number | ''>(24);
  const [supportUrl, setSupportUrl] = useState('');
  const [announceTemplate, setAnnounceTemplate] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!hydrated && settingsQuery.data) {
      setProfileTitle(settingsQuery.data.subscriptionProfileTitle ?? '');
      setIntervalHours(settingsQuery.data.subscriptionUpdateIntervalHours ?? 24);
      setSupportUrl(settingsQuery.data.subscriptionSupportUrl ?? '');
      setAnnounceTemplate(settingsQuery.data.subscriptionAnnounceTemplate ?? '');
      setHydrated(true);
    }
  }, [settingsQuery.data, hydrated]);

  const saveMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      notifications.show({
        color: 'green',
        message: t('settings.subscription.saved'),
      });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  // Routing Templates (R1d). The picker saves on change ("simple toggle") and
  // reads its value straight from the query - no local state, so the radio
  // can never drift from what the server actually persisted. While the save
  // is in flight the group is disabled; on success the invalidated query
  // snaps it to the new value.
  const routingPreset: RoutingPresetId =
    settingsQuery.data?.subscriptionRoutingPreset ?? 'proxy-all';
  const routingMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      notifications.show({
        color: 'green',
        message: t('settings.subscription.routingSaved'),
      });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function save() {
    saveMutation.mutate({
      subscriptionProfileTitle: profileTitle.trim() || null,
      subscriptionUpdateIntervalHours:
        typeof intervalHours === 'number' ? intervalHours : 24,
      subscriptionSupportUrl: supportUrl.trim() || null,
      subscriptionAnnounceTemplate: announceTemplate.trim() || null,
    });
  }

  return (
    <Stack gap="lg">
      <PageHero
        eyebrow={t('pageHero.subscriptionMetadataEyebrow')}
        title={t('pageHero.subscriptionMetadataTitle')}
        subtitle={t('pageHero.subscriptionMetadataSubtitle')}
      />

      <Card withBorder padding="lg" radius="md">
        <Group gap="sm" mb="md">
          <ThemeIcon size={32} radius="md" variant="light" color="blue">
            <IconRss size={18} />
          </ThemeIcon>
          <Stack gap={0}>
            <Text fw={600}>{t('settings.subscription.title')}</Text>
            <Text size="xs" c="dimmed">
              {t('settings.subscription.description')}
            </Text>
          </Stack>
        </Group>

        <Stack gap="sm" maw={620}>
          <TextInput
            label={t('settings.subscription.profileTitle')}
            description={t('settings.subscription.profileTitleDesc')}
            value={profileTitle}
            onChange={(e) => setProfileTitle(e.currentTarget.value)}
            placeholder="Iceslab"
          />
          <Group grow align="flex-start">
            <NumberInput
              label={t('settings.subscription.updateInterval')}
              description={t('settings.subscription.updateIntervalDesc')}
              min={1}
              max={168}
              value={intervalHours}
              onChange={(v) => setIntervalHours(typeof v === 'number' ? v : '')}
            />
            <TextInput
              label={t('settings.subscription.supportUrl')}
              description={t('settings.subscription.supportUrlDesc')}
              value={supportUrl}
              onChange={(e) => setSupportUrl(e.currentTarget.value)}
              placeholder="https://t.me/your_support"
            />
          </Group>
          <Textarea
            label={t('settings.subscription.announce')}
            description={t('settings.subscription.announceDesc')}
            value={announceTemplate}
            onChange={(e) => setAnnounceTemplate(e.currentTarget.value)}
            placeholder="Traffic left: {{TRAFFIC_LEFT}} · {{DAYS_LEFT}} days remaining · support {{SUPPORT_URL}}"
            autosize
            minRows={2}
            maxRows={5}
          />
          <Group justify="flex-end">
            <PrimaryButton
              onClick={save}
              loading={saveMutation.isPending}
              disabled={settingsQuery.isLoading}
              leftSection={<IconCheck size={14} />}
            >
              {t('common.save')}
            </PrimaryButton>
          </Group>
        </Stack>
      </Card>

      <Card withBorder padding="lg" radius="md">
        <Group gap="sm" mb="md">
          <ThemeIcon size={32} radius="md" variant="light" color="teal">
            <IconRoute size={18} />
          </ThemeIcon>
          <Stack gap={0}>
            <Text fw={600}>{t('settings.subscription.routingTitle')}</Text>
            <Text size="xs" c="dimmed">
              {t('settings.subscription.routingDesc')}
            </Text>
          </Stack>
        </Group>

        <Radio.Group
          value={routingPreset}
          onChange={(v) =>
            routingMutation.mutate({
              subscriptionRoutingPreset: v as RoutingPresetId,
            })
          }
        >
          <Stack gap="sm" maw={620}>
            <Radio
              value="proxy-all"
              disabled={routingMutation.isPending || settingsQuery.isLoading}
              label={t('settings.subscription.routingProxyAll')}
              description={t('settings.subscription.routingProxyAllDesc')}
            />
            <Radio
              value="ru-split"
              disabled={routingMutation.isPending || settingsQuery.isLoading}
              label={t('settings.subscription.routingRuSplit')}
              description={t('settings.subscription.routingRuSplitDesc')}
            />
          </Stack>
        </Radio.Group>
      </Card>
    </Stack>
  );
}
