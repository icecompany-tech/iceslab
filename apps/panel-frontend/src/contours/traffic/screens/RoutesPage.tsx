import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, Textarea, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoutingPresetId } from '@iceslab/shared';
import { ROUTING_PRESET_IDS, isRoutingPresetId, presetKey } from '@/lib/domain/routing-presets';
import {
  ROUTE_POLICY_WRITES_LIVE,
  ROUTING_PRESET_WRITES_LIVE,
  listRoutePolicies,
  listRoutingPresets,
  type RouteAction,
  type RoutePolicy,
  type RouteRule,
  type RoutingPreset,
} from '@/lib/domain/route-policies';
import { apiErrorMessage } from '@/lib/net/client';
import { getSettings, updateSettings } from '@/lib/domain/settings';
import { listSquads, type Squad } from '@/lib/domain/squads';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { RoutePolicyEditor, blankPolicy } from '@/contours/traffic/components/RoutePolicyEditor';
import { DevicePresetEditor, blankPreset } from '@/contours/traffic/components/DevicePresetEditor';

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

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const RAISED = '#152233';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

type Pane = 'node' | 'device';

/* ───── Preset contents ─────────────────────────────────────────────────── */

/**
 * What each preset emits, mirrored from `formats/xrayjson.ts` (RU_SPLIT_RULES /
 * CN_SPLIT_RULES). It is a copy and it can drift, so it is only read while
 * `GET /api/routing-presets` is missing: the moment that endpoint answers, the
 * query below wins and this table can be deleted.
 */
interface PresetRule {
  match: string[];
  action: 'direct' | 'block' | 'proxy';
}

const PRESET_RULES: Record<RoutingPresetId, PresetRule[]> = {
  'proxy-all': [],
  'ru-split': [
    { match: ['geosite:category-ads-all'], action: 'block' },
    { match: ['geosite:category-ru', 'geosite:category-gov-ru'], action: 'direct' },
    { match: ['geoip:private', 'geoip:ru'], action: 'direct' },
  ],
  'cn-split': [
    { match: ['geosite:category-ads-all'], action: 'block' },
    { match: ['geosite:cn'], action: 'direct' },
    { match: ['geoip:private', 'geoip:cn'], action: 'direct' },
  ],
};

/**
 * Why each built-in rule exists, keyed by its matcher. This is panel copy, not
 * operator data: the backend ships rules, it has no business carrying a
 * translated sentence, so the note is looked up here whether the rule came from
 * the API or from the mirror above.
 */
const NOTE_BY_MATCH: Record<string, string> = {
  'geosite:category-ads-all': 'routes.noteAds',
  'geosite:category-ru': 'routes.noteRuDomains',
  'geosite:cn': 'routes.noteCnDomains',
  'geoip:ru': 'routes.noteRuIps',
  'geoip:cn': 'routes.noteCnIps',
};

function noteKeyFor(match: string[]): string | undefined {
  const hit = match.find((m) => NOTE_BY_MATCH[m] !== undefined);
  return hit === undefined ? undefined : NOTE_BY_MATCH[hit];
}

/** The clean resolver each split preset points local domains at. */
const PRESET_DNS: Partial<Record<RoutingPresetId, string>> = {
  'ru-split': '77.88.8.8',
  'cn-split': '223.5.5.5',
};

// PRESET_IDS / presetKey / isBuiltInPresetId now live in lib/routingPresets.ts:
// the Users filter needs the same list and the same labels.

/* ───── Page ────────────────────────────────────────────────────────────── */

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

function NodePane({
  policies,
  squads,
  loading,
  draft,
  draftKey,
  onDraftDone,
}: {
  policies: RoutePolicy[];
  squads: Squad[];
  loading: boolean;
  draft: RoutePolicy | null;
  draftKey: number;
  onDraftDone: () => void;
}) {
  const { t } = useTranslation();
  // `null` is the plain profile: ordinal 0, implicit, never a row in the table.
  const [selected, setSelected] = useState<string | null>(null);
  const policy = draft ?? policies.find((p) => p.id === selected) ?? null;

  return (
    <Box className="routes-panes">
      <Stack gap={0} className="routes-list">
        <ListHead label={t('routes.policiesTitle')} count={policies.length} />

        {draft && (
          <ListRow
            selected
            title={draft.name || t('routes.newPolicy')}
            sub={t('routes.newPolicySub')}
            onClick={() => undefined}
          />
        )}

        <ListRow
          selected={!draft && selected === null}
          title={t('routes.plainName')}
          sub={t('routes.plainSub')}
          badge={t('routes.builtIn')}
          onClick={() => {
            onDraftDone();
            setSelected(null);
          }}
        />
        {policies.map((p) => {
          const granted = squads.filter((s) => s.policyIds.includes(p.id));
          const total = p.rules?.length ?? p.directDomains.length + p.blockDomains.length;
          return (
            <ListRow
              key={p.id}
              selected={!draft && selected === p.id}
              title={p.name}
              sub={[
                t('routes.ruleCount', { count: total }),
                granted.length > 0
                  ? t('routes.squadCount', { count: granted.length })
                  : t('routes.grantedToNobody'),
              ].join(' · ')}
              onClick={() => {
                onDraftDone();
                setSelected(p.id);
              }}
            />
          );
        })}
        {policies.length === 0 && !loading && <ListEmpty>{t('routes.noPolicies')}</ListEmpty>}
      </Stack>

      {policy === null ? (
        <Stack gap={0} className="routes-detail">
          <DetailHead title={t('routes.plainName')} chip={t('routes.builtIn')} note={t('routes.firstMatchWins')} />
          <Box style={{ padding: '20px 22px' }}>
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: MIST }}>
              {t('routes.plainBody')}
            </Text>
          </Box>
          <LockedRow
            label={t('routes.everythingElse')}
            value={t('routes.nodeDoor')}
            note={t('routes.nodeDoorNote')}
          />
        </Stack>
      ) : (
        <RoutePolicyEditor
          key={draft ? `draft-${draftKey}` : policy.id}
          policy={policy}
          squads={squads}
          onCreated={() => {
            onDraftDone();
            setSelected(null);
          }}
        />
      )}
    </Box>
  );
}

/* ───── On the device ───────────────────────────────────────────────────── */

function DevicePane({
  presets,
  defaultPreset,
  squads,
  draft,
  draftKey,
  onDraftDone,
}: {
  presets: RoutingPreset[];
  defaultPreset: RoutingPresetId;
  squads: Squad[];
  draft: RoutingPreset | null;
  draftKey: number;
  onDraftDone: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>(defaultPreset);

  const preset = draft ?? presets.find((p) => p.id === selected) ?? presets[0]!;
  const usedBy = (id: string) => squads.filter((s) => s.routingPreset === id).length;

  return (
    <Box className="routes-panes">
      <Stack gap={0} className="routes-list">
        <ListHead label={t('routes.presetsTitle')} count={presets.length} />

        {draft && (
          <ListRow
            selected
            title={draft.name || t('routes.newPreset')}
            sub={t('routes.newPolicySub')}
            onClick={() => undefined}
          />
        )}

        {presets.map((p) => {
          const squadCount = usedBy(p.id);
          return (
            <ListRow
              key={p.id}
              selected={!draft && selected === p.id}
              title={p.name}
              sub={[
                p.rules.length > 0 ? t('routes.ruleCount', { count: p.rules.length }) : t('routes.noRulesShort'),
                p.id === defaultPreset ? t('routes.isDefault') : null,
                squadCount > 0 ? t('routes.squadCount', { count: squadCount }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              badge={t('routes.builtIn')}
              onClick={() => {
                onDraftDone();
                setSelected(p.id);
              }}
            />
          );
        })}
      </Stack>

      <DevicePresetEditor
        key={draft ? `draft-${draftKey}` : preset.id}
        preset={preset}
        isDefault={!draft && preset.id === defaultPreset}
        dns={draft ? undefined : PRESET_DNS[preset.id as RoutingPresetId]}
        onSaved={onDraftDone}
      />

      <Box className="routes-full">
        <OwnRules />
      </Box>
    </Box>
  );
}

/** i18n suffix for a preset id, so the labels stay in one place. */

/* ───── The operator's own layer ────────────────────────────────────────── */

/**
 * The only part of on-device routing that is stored rather than compiled: the
 * operator's domain lists and raw Xray rules. They are emitted BEFORE the
 * preset, which is why they sit under it here with that said out loud.
 */
function OwnRules() {
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

function PaneTab({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: '100%',
        paddingInline: 14,
        borderRadius: 6,
        backgroundColor: active ? HAIRLINE : 'transparent',
      }}
    >
      {icon}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '16px',
          color: active ? SNOW : MIST,
        }}
      >
        {label}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: active ? MIST : FAINT }}>
        {count}
      </Text>
    </UnstyledButton>
  );
}

function ListHead({ label, count }: { label: string; count: number }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 18px',
        borderBottom: `1px solid ${HAIRLINE}`,
      }}
    >
      <Caption>{label}</Caption>
      <Box style={{ flex: 1, minWidth: 0 }} />
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: FAINT }}>{count}</Text>
    </Box>
  );
}

/** Import: a label that opens the file picker and hands back the text. */
function FileLink({
  label,
  title,
  tone,
  icon,
  onFile,
}: {
  label: string;
  title: string;
  tone: string;
  icon: ReactNode;
  onFile: (text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          void file.text().then(onFile);
        }}
      />
      <UnstyledButton
        type="button"
        title={title}
        onClick={() => input.current?.click()}
        style={{ display: 'flex', alignItems: 'center', gap: 7 }}
      >
        {icon}
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: tone }}>{label}</Text>
      </UnstyledButton>
    </>
  );
}

function ListRow({
  selected,
  title,
  sub,
  badge,
  onClick,
}: {
  selected: boolean;
  title: string;
  sub: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '13px 18px',
        width: '100%',
        textAlign: 'left',
        backgroundColor: selected ? RAISED : 'transparent',
        borderLeft: `2px solid ${selected ? CYAN : 'transparent'}`,
        borderBottom: `1px solid ${HAIRLINE}`,
      }}
    >
      <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: '17px',
            color: selected ? SNOW : MIST,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '13px', color: FAINT }}>{sub}</Text>
      </Stack>
      {badge && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 18,
            paddingInline: 7,
            borderRadius: 5,
            flexShrink: 0,
            backgroundColor: WELL,
            border: `1px solid ${HAIRLINE}`,
          }}
        >
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: '0.08em',
              lineHeight: '11px',
              textTransform: 'uppercase',
              color: FAINT,
            }}
          >
            {badge}
          </Text>
        </Box>
      )}
    </UnstyledButton>
  );
}

function ListEmpty({ children }: { children: ReactNode }) {
  return (
    <Box style={{ padding: '20px 18px' }}>
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: MIST, textAlign: 'center' }}>{children}</Text>
    </Box>
  );
}

function DetailHead({ title, chip, note }: { title: string; chip?: string; note: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 22px', width: '100%' }}>
      <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
        {title}
      </Text>
      {chip && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 20,
            paddingInline: 8,
            borderRadius: 6,
            flexShrink: 0,
            backgroundColor: `${CYAN}14`,
            border: `1px solid ${CYAN}2E`,
          }}
        >
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.08em',
              lineHeight: '12px',
              textTransform: 'uppercase',
              color: CYAN,
            }}
          >
            {chip}
          </Text>
        </Box>
      )}
      <Box style={{ flex: 1, minWidth: 0 }} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{note}</Text>
    </Box>
  );
}

/** The row nobody wrote and nobody can delete. */
function LockedRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Box
      className="routes-rule"
      style={{ paddingBlock: 13, paddingInline: 22, backgroundColor: WELL, borderTop: `1px solid ${HAIRLINE}` }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <LockIcon size={13} color={DIM} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '17px', color: MIST }}>
          {label}
        </Text>
      </Box>
      <Box style={{ width: 200, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: CYAN, flexShrink: 0 }} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '17px', color: SNOW }}>{value}</Text>
      </Box>
      <Text
        style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: FAINT, flex: 1, minWidth: 0 }}
      >
        {note}
      </Text>
    </Box>
  );
}

function Bucket({
  tone,
  label,
  hint,
  placeholder,
  value,
  onChange,
}: {
  tone: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone, flexShrink: 0 }} />
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.1em',
            lineHeight: '12px',
            textTransform: 'uppercase',
            color: tone,
          }}
        >
          {label}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{hint}</Text>
      </Box>
      <Textarea
        autosize
        minRows={4}
        maxRows={10}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        styles={{ input: { fontFamily: MONO, fontSize: 12, lineHeight: '17px', color: SNOW } }}
      />
    </Stack>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.16em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.12em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}

function Verdict({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 20,
        paddingInline: 8,
        borderRadius: 6,
        flexShrink: 0,
        backgroundColor: `${tone}14`,
        border: `1px solid ${tone}2E`,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: tone }}>{children}</Text>
    </Box>
  );
}

function SaveButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 34,
        paddingInline: 14,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <TickIcon size={14} color={CYAN} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
        {children}
      </Text>
    </UnstyledButton>
  );
}

/* ───── Import and export ───────────────────────────────────────────────── */

/**
 * The exchange format is ours and deliberately small: a kind, a version and a
 * list of `{ name, rules }`. It is exactly the body the write endpoints will
 * take, so a file exported today stays valid once they exist.
 */
interface Exchanged {
  name: string;
  rules: RouteRule[];
}

/** A policy's rules, derived from the domain lists when the API sends no list. */
function policyRules(p: RoutePolicy): { match: string[]; action: RouteAction; note: string }[] {
  if (p.rules) return p.rules.map((r) => ({ match: r.match, action: r.action, note: r.note }));
  const out: { match: string[]; action: RouteAction; note: string }[] = [];
  if (p.blockDomains.length > 0) out.push({ match: p.blockDomains, action: 'block', note: '' });
  if (p.directDomains.length > 0) out.push({ match: p.directDomains, action: 'direct', note: '' });
  return out;
}

function exportJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const ACTIONS: RouteAction[] = ['block', 'direct', 'warp', 'proxy'];

/** Parsed entries, or an i18n key naming what is wrong with the file. */
function parseImport(text: string): Exchanged[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'routes.importBadJson';
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.policies)
      ? parsed.policies
      : isRecord(parsed) && Array.isArray(parsed.presets)
        ? parsed.presets
        : null;
  if (raw === null) return 'routes.importBadShape';
  if (raw.length === 0) return 'routes.importEmpty';

  const out: Exchanged[] = [];
  for (const [i, entry] of raw.entries()) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !Array.isArray(entry.rules)) {
      return 'routes.importBadShape';
    }
    const rules: RouteRule[] = [];
    for (const [j, rule] of entry.rules.entries()) {
      if (!isRecord(rule) || !Array.isArray(rule.match) || !rule.match.every((m) => typeof m === 'string')) {
        return 'routes.importBadShape';
      }
      if (typeof rule.action !== 'string' || !ACTIONS.includes(rule.action as RouteAction)) {
        return 'routes.importBadAction';
      }
      rules.push({
        id: `i${i}-${j}`,
        match: rule.match as string[],
        action: rule.action as RouteAction,
        note: typeof rule.note === 'string' ? rule.note : '',
      });
    }
    out.push({ name: entry.name, rules });
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

/* ───── Data helpers ────────────────────────────────────────────────────── */

/** Trimmed, deduped, non-empty lines. */
function splitLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const d = raw.trim();
    if (d.length > 0 && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

/** The rules field as three states: empty, a parsed array, or a reason it is
 *  neither. Empty clears the setting rather than saving `[]`. */
function parseRules(text: string): { rules: Record<string, unknown>[] | null; error: string | null } {
  const trimmed = text.trim();
  if (trimmed === '') return { rules: null, error: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { rules: null, error: 'routes.rulesInvalidJson' };
  }
  if (!Array.isArray(parsed) || !parsed.every((r) => r !== null && typeof r === 'object')) {
    return { rules: null, error: 'routes.rulesNotArray' };
  }
  return { rules: parsed as Record<string, unknown>[], error: null };
}

/* ───── Icons ───────────────────────────────────────────────────────────── */

function ServerIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="7" rx="2" fill="none" stroke={color} strokeWidth="1.8" />
      <rect x="3" y="13" width="18" height="7" rx="2" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M7 7.5h.01" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 16.5h.01" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PhoneIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="6" y="3" width="12" height="18" rx="2.5" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M10.5 18h3" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke={color} strokeWidth="1.9" />
      <path
        d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 5l0 14" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M5 12l14 0" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function ImportIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 15V4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M8 8l4 -4l4 4"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ExportIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 4v11" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M8 11l4 4l4 -4"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M4 20h4l10.5 -10.5a2.1 2.1 0 0 0 -3 -3L5 17v3"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TickIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M5 12l5 5L20 7"
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
