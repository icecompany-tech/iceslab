import { AMBER, CARD, CYAN, DISPLAY, FAINT, HAIRLINE, MIST, MONO, MOSS, RED, SNOW, WELL } from '@/contours/traffic/lib/colors';
import { Box, Stack, Text, Textarea } from '@mantine/core';
import { Bucket } from '@/contours/traffic/components/Routes/Bucket';
import { Caption, FieldLabel } from '@/contours/traffic/components/Routes/Labels';
import { PencilIcon } from '@/contours/traffic/components/Routes/icons';
import { SaveButton } from '@/contours/traffic/components/Routes/SaveButton';
import { Verdict } from '@/contours/traffic/components/Routes/Verdict';
import { apiErrorMessage } from '@/lib/net/client';
import { getSettings, updateSettings } from '@/lib/domain/settings';
import { notifications } from '@mantine/notifications';
import { parseRules, splitLines } from '@/contours/traffic/lib/routeExchange';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
export function OwnRules() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings', 'all'], queryFn: getSettings });

  const [draft, setDraft] = useState<{ direct: string; proxy: string; block: string; rules: string } | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);
  if (!loaded && settingsQuery.data) {
    setLoaded(true);
    const cdl = settingsQuery.data.subscriptionCustomDomainLists;
    setDraft({
      direct: (cdl?.direct ?? []).join('\n'),
      proxy: (cdl?.proxy ?? []).join('\n'),
      block: (cdl?.block ?? []).join('\n'),
      rules: settingsQuery.data.subscriptionCustomRoutingRules
        ? JSON.stringify(settingsQuery.data.subscriptionCustomRoutingRules, null, 2)
        : '',
    });
  }

  const rulesState = useMemo(() => parseRules(draft?.rules ?? ''), [draft?.rules]);
  const saved = settingsQuery.data
    ? {
        direct: (settingsQuery.data.subscriptionCustomDomainLists?.direct ?? []).join('\n'),
        proxy: (settingsQuery.data.subscriptionCustomDomainLists?.proxy ?? []).join('\n'),
        block: (settingsQuery.data.subscriptionCustomDomainLists?.block ?? []).join('\n'),
        rules: settingsQuery.data.subscriptionCustomRoutingRules
          ? JSON.stringify(settingsQuery.data.subscriptionCustomRoutingRules, null, 2)
          : '',
      }
    : null;
  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('nothing to save');
      const direct = splitLines(draft.direct);
      const proxy = splitLines(draft.proxy);
      const block = splitLines(draft.block);
      const empty = direct.length + proxy.length + block.length === 0;
      return updateSettings({
        // All three empty clears the setting, so subscription output stays
        // byte-identical to "no lists defined".
        subscriptionCustomDomainLists: empty ? null : { direct, proxy, block },
        subscriptionCustomRoutingRules: rulesState.rules,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] });
      setLoaded(false);
      notifications.show({ color: 'green', message: t('routes.ownSaved') });
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) }),
  });

  if (!draft) return null;
  const patch = (p: Partial<typeof draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  return (
    <Stack
      gap={16}
      style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
        <PencilIcon size={15} color={CYAN} />
        <Caption>{t('routes.ownTitle')}</Caption>
        <Text
          style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT, flex: 1, minWidth: 0 }}
        >
          {t('routes.ownHint')}
        </Text>
        <Verdict tone={rulesState.error ? RED : dirty ? AMBER : MIST}>
          {rulesState.error ? t(rulesState.error) : dirty ? t('routes.unsaved') : t('routes.saved')}
        </Verdict>
        <SaveButton
          disabled={!dirty || rulesState.error !== null || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {t('common.save')}
        </SaveButton>
      </Box>

      <Box className="routes-buckets">
        <Bucket
          tone={MOSS}
          label={t('routes.bucketDirect')}
          hint={t('routes.bucketDirectHint')}
          placeholder={'example.ru\ndomain:gosuslugi.ru'}
          value={draft.direct}
          onChange={(v) => patch({ direct: v })}
        />
        <Bucket
          tone={CYAN}
          label={t('routes.bucketProxy')}
          hint={t('routes.bucketProxyHint')}
          placeholder={'youtube.com\ndomain:google.com'}
          value={draft.proxy}
          onChange={(v) => patch({ proxy: v })}
        />
        <Bucket
          tone={RED}
          label={t('routes.bucketBlock')}
          hint={t('routes.bucketBlockHint')}
          placeholder="ads.example.com"
          value={draft.block}
          onChange={(v) => patch({ block: v })}
        />
      </Box>

      <Stack gap={6}>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FieldLabel>{t('routes.rawRules')}</FieldLabel>
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 18,
              paddingInline: 7,
              borderRadius: 5,
              backgroundColor: WELL,
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 9,
                letterSpacing: '0.1em',
                lineHeight: '11px',
                textTransform: 'uppercase',
                color: FAINT,
              }}
            >
              {t('routes.advanced')}
            </Text>
          </Box>
        </Box>
        <Textarea
          autosize
          minRows={4}
          maxRows={16}
          placeholder={'[\n  { "type": "field", "domain": ["geosite:category-ru"], "outboundTag": "direct" }\n]'}
          value={draft.rules}
          onChange={(e) => patch({ rules: e.currentTarget.value })}
          styles={{ input: { fontFamily: MONO, fontSize: 12, lineHeight: '18px', color: SNOW } }}
        />
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
          {t('routes.rawRulesHint')}
        </Text>
      </Stack>
    </Stack>
  );
}

/* ───── Pieces ──────────────────────────────────────────────────────────── */
