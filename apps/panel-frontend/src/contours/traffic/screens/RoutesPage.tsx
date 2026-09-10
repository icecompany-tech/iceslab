import { CYAN, DISPLAY, FAINT, HAIRLINE, MIST, SNOW, WELL } from '@/contours/traffic/lib/colors';
import { DevicePane } from '@/contours/traffic/components/Routes/DevicePane';
import { ExportIcon, ImportIcon, PhoneIcon, PlusIcon, ServerIcon } from '@/contours/traffic/components/Routes/icons';
import { FileLink } from '@/contours/traffic/components/Routes/FileLink';
import { NodePane } from '@/contours/traffic/components/Routes/NodePane';
import { PRESET_RULES, noteKeyFor } from '@/contours/traffic/lib/devicePresets';
import { PaneTab } from '@/contours/traffic/components/Routes/PaneTab';
import { exportJson, parseImport, policyRules } from '@/contours/traffic/lib/routeExchange';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { ROUTING_PRESET_IDS, isRoutingPresetId, presetKey } from '@/lib/domain/routingPresets';
import { ROUTE_POLICY_WRITES_LIVE, ROUTING_PRESET_WRITES_LIVE, listRoutePolicies, listRoutingPresets, type RoutePolicy, type RoutingPreset } from '@/lib/domain/routePolicies';
import { getSettings } from '@/lib/domain/settings';
import { listSquads } from '@/lib/domain/squads';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { blankPolicy } from '@/contours/traffic/lib/routeRules';
import { blankPreset } from '@/contours/traffic/lib/devicePresets';

/**
 * Routes: what happens to traffic, in the two places it can be decided.
 *
 *   On the node   - route policies. Traffic has already reached us; the policy
 *                   says which door it leaves by. Granted per squad.
 *   On the device - the routing preset baked into the client's own config, plus
 *                   the operator's own domain lists and raw rules. Decides what
 *                   never enters the tunnel at all.
 *
 * Both panes are editors, but only one of them writes for real. Route policies
 * are stored data with a full CRUD behind them, and saving one re-pushes every
 * cascade entry, so the change reaches the fleet. Presets are still three fixed
 * ids compiled into the subscription builders: their pane reads real data and
 * reports what saving hits, until GET /api/routing-presets exists. The
 * operator's own lists and raw rules are stored as data and editable below.
 */

type Pane = 'node' | 'device';

export function RoutesPage() {
  const { t } = useTranslation();
  const [pane, setPane] = useState<Pane>('node');
  // A draft is a policy or preset that exists only here: written by New, or
  // read out of an imported file. Neither can be saved until the API grows the
  // write endpoints, so the pane shows it as an unsaved row and says so.
  const [nodeDraft, setNodeDraft] = useState<RoutePolicy | null>(null);
  const [deviceDraft, setDeviceDraft] = useState<RoutingPreset | null>(null);
  // Every draft carries the same id, so the editor cannot tell one from the
  // next. This counter keys it, and a new draft remounts it with fresh fields.
  const [draftSeq, setDraftSeq] = useState(0);

  const policiesQuery = useQuery({ queryKey: ['route-policies'], queryFn: listRoutePolicies });
  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads });
  const settingsQuery = useQuery({ queryKey: ['settings', 'all'], queryFn: getSettings });
  // Asked once, never retried: while the endpoint is missing this is a single
  // 404 and the mirror below answers instead. When it lands, it wins silently.
  const presetsQuery = useQuery({
    queryKey: ['routing-presets'],
    queryFn: listRoutingPresets,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const policies = policiesQuery.data?.policies ?? [];
  const squads = squadsQuery.data?.squads ?? [];
  const defaultPreset = settingsQuery.data?.subscriptionRoutingPreset ?? 'proxy-all';

  // The presets as the subscription builder emits them. They live here rather
  // than in the pane so Export can reach them.
  const presets: RoutingPreset[] = useMemo(() => {
    const source: RoutingPreset[] =
      presetsQuery.data?.presets ??
      ROUTING_PRESET_IDS.map((id) => ({
        id,
        name: '',
        builtIn: true,
        rules: PRESET_RULES[id].map((r, i) => ({ id: `${id}-${i}`, match: r.match, action: r.action, note: '' })),
      }));
    return source.map((p) => ({
      ...p,
      // The three built-ins are panel copy, not operator data: their name and
      // their notes stay translated here whatever the API calls them.
      name: isRoutingPresetId(p.id) ? t(`metadata.preset${presetKey(p.id)}`) : p.name,
      rules: p.rules.map((r) => {
        const key = noteKeyFor(r.match);
        return key === undefined ? r : { ...r, note: t(key) };
      }),
    }));
  }, [presetsQuery.data, t]);

  usePageMeta([
    t('routes.factPolicies', { count: policies.length }),
    t('routes.factPresets', { count: presets.length }),
  ]);

  const onNode = pane === 'node';
  const canCreate = onNode ? ROUTE_POLICY_WRITES_LIVE : ROUTING_PRESET_WRITES_LIVE;

  function stage(policy: RoutePolicy | null, preset: RoutingPreset | null) {
    setNodeDraft(policy);
    setDeviceDraft(preset);
    setDraftSeq((s) => s + 1);
  }

  function exportPane() {
    if (onNode) {
      exportJson('iceslab-route-policies.json', {
        kind: 'iceslab.route-policies',
        version: 1,
        policies: policies.map((p) => ({ name: p.name, rules: policyRules(p) })),
      });
    } else {
      exportJson('iceslab-routing-presets.json', {
        kind: 'iceslab.routing-presets',
        version: 1,
        presets: presets.map((p) => ({
          name: p.name,
          rules: p.rules.map((r) => ({ match: r.match, action: r.action, note: r.note })),
        })),
      });
    }
    notifications.show({ color: 'green', message: t('routes.exported') });
  }

  function importPane(text: string) {
    const parsed = parseImport(text);
    if (typeof parsed === 'string') {
      notifications.show({ color: 'red', title: t('routes.importFailed'), message: t(parsed) });
      return;
    }
    const first = parsed[0]!;
    if (onNode) {
      stage({ ...blankPolicy(), name: first.name, rules: first.rules }, null);
    } else {
      stage(null, { ...blankPreset(), name: first.name, rules: first.rules });
    }
    notifications.show({
      color: parsed.length > 1 ? 'yellow' : 'green',
      message:
        parsed.length > 1
          ? t('routes.importedFirst', { name: first.name, count: parsed.length - 1 })
          : t('routes.importedOne', { name: first.name }),
    });
  }

  return (
    <Stack gap={20}>
      {/* Page bar: the two layers are the page, so they are the bar. */}
      <Box className="page-bar">
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 38,
            padding: 3,
            borderRadius: 8,
            backgroundColor: WELL,
            border: `1px solid ${HAIRLINE}`,
            flexShrink: 0,
          }}
        >
          <PaneTab
            active={onNode}
            icon={<ServerIcon size={13} color={onNode ? CYAN : MIST} />}
            label={t('routes.paneNode')}
            count={policies.length}
            onClick={() => setPane('node')}
          />
          <PaneTab
            active={!onNode}
            icon={<PhoneIcon size={13} color={!onNode ? CYAN : MIST} />}
            label={t('routes.paneDevice')}
            count={presets.length}
            onClick={() => setPane('device')}
          />
        </Box>

        <Box className="page-bar-facts" style={{ paddingLeft: 14 }}>
          <Text
            className="page-bar-fact-soft"
            style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '16px', color: MIST }}
          >
            {onNode ? t('routes.paneNodeHint') : t('routes.paneDeviceHint')}
          </Text>
          <Box style={{ flex: 1, minWidth: 0 }} />
        </Box>

        <Box style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
          <FileLink
            label={t('routes.import')}
            title={t('routes.importHint')}
            tone={CYAN}
            icon={<ImportIcon size={13} color={CYAN} />}
            onFile={importPane}
          />
          <UnstyledButton
            type="button"
            title={t('routes.exportHint')}
            onClick={exportPane}
            style={{ display: 'flex', alignItems: 'center', gap: 7 }}
          >
            <ExportIcon size={13} color={MIST} />
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}>
              {t('routes.export')}
            </Text>
          </UnstyledButton>
          {/* Creating is the one thing this button does, and there is nothing
              to create into yet, so it stays visible but off with a reason. */}
          <UnstyledButton
            type="button"
            disabled={!canCreate}
            title={
              canCreate
                ? undefined
                : onNode
                  ? t('routes.writesDisabledPolicies')
                  : t('routes.writesDisabledPresets')
            }
            onClick={() => (onNode ? stage(blankPolicy(), null) : stage(null, blankPreset()))}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 38,
              paddingInline: 16,
              borderRadius: 8,
              backgroundColor: canCreate ? `${CYAN}1F` : WELL,
              border: `1px solid ${canCreate ? CYAN : HAIRLINE}`,
              opacity: canCreate ? 1 : 0.5,
              cursor: canCreate ? 'pointer' : 'not-allowed',
            }}
          >
            <PlusIcon size={13} color={canCreate ? CYAN : FAINT} />
            <Text
              style={{
                fontFamily: DISPLAY,
                fontSize: 13,
                fontWeight: 500,
                lineHeight: '16px',
                color: canCreate ? SNOW : MIST,
              }}
            >
              {onNode ? t('routes.newPolicy') : t('routes.newPreset')}
            </Text>
          </UnstyledButton>
        </Box>
      </Box>

      {onNode ? (
        <NodePane
          policies={policies}
          squads={squads}
          loading={policiesQuery.isLoading}
          draft={nodeDraft}
          draftKey={draftSeq}
          onDraftDone={() => setNodeDraft(null)}
        />
      ) : (
        <DevicePane
          presets={presets}
          defaultPreset={defaultPreset}
          squads={squads}
          draft={deviceDraft}
          draftKey={draftSeq}
          onDraftDone={() => setDeviceDraft(null)}
        />
      )}
    </Stack>
  );
}

/* ───── On the node ─────────────────────────────────────────────────────── */
