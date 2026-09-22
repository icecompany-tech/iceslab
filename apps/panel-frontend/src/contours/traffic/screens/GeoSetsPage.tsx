import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Select, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage } from '@/lib/net/client';
import { listNodes } from '@/lib/domain/nodes';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { relativeTime } from '@/lib/ui/relativeTime';
import {
  deleteGeoSet,
  geoSetRefusal,
  getGeoRollout,
  isNotImplemented,
  listGeoSets,
  refreshGeoSet,
  uploadGeoSet,
  type GeoRolloutNode,
  type GeoSet,
  type GeoSetKind,
} from '@/lib/domain/geoSets';
import {
  geoScreenFacts,
  geoSetActions,
  rolloutFacts,
  rolloutSummary,
} from '@/contours/traffic/lib/geoFacts';
import { AMBER, CARD, DIM, FAINT, HAIRLINE, MIST, MOSS, RED, SNOW, WELL } from '@/contours/traffic/lib/colors';

/**
 * Гео-наборы: списки доменов и адресов, которыми правила решают судьбу трафика.
 *
 * Строка отвечает на три вопроса сразу, потому что поодиночке они бесполезны:
 * ЧТО это (имя, вид, источник), КАКОЙ версии файл у панели, и СКОЛЬКО нод
 * реально несут эту версию. Набор, обновлённый в панели и не доехавший до нод,
 * выглядит свежим и работает по-старому, и увидеть это можно только рядом.
 *
 * ⚠ До бэкенда фазы 9 запросы отвечают 404: экран говорит «появится с фазой 9»,
 * а не рисует ошибку и не притворяется пустым.
 */

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

export function GeoSetsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  usePageMeta([]);

  const setsQuery = useQuery({
    queryKey: ['geo-sets'],
    queryFn: listGeoSets,
    retry: (count, err) => !isNotImplemented(err) && count < 2,
  });

  // Раскладка спрашивается отдельным запросом и отдельно же может отсутствовать:
  // набор известен, а что лежит на нодах, ещё нет, и это разные незнания.
  const rolloutQuery = useQuery({
    queryKey: ['geo-rollout'],
    queryFn: getGeoRollout,
    enabled: setsQuery.isSuccess,
    retry: (count, err) => !isNotImplemented(err) && count < 2,
  });

  // Имена нод берутся из своего списка: раскладка приходит по id, а человеку
  // «n7f3a» не говорит ничего. Нет ответа - покажем id, это хотя бы зацепка.
  const nodesQuery = useQuery({ queryKey: ['nodes'], queryFn: () => listNodes() });
  const nodeNames = useMemo(
    () => new Map((nodesQuery.data?.nodes ?? []).map((n) => [n.id, n.name] as const)),
    [nodesQuery.data],
  );

  const facts = geoScreenFacts({
    sets: setsQuery.data?.sets,
    notImplemented: isNotImplemented(setsQuery.error),
  });
  const rollout = rolloutQuery.data?.nodes ?? null;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState>({
    open: false,
    name: '',
    kind: 'geosite',
    file: null,
  });

  const refresh = useMutation({
    mutationFn: (id: string) => refreshGeoSet(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['geo-sets'] });
      qc.invalidateQueries({ queryKey: ['geo-rollout'] });
    },
    onError: (err) => showRefusal(err, t('geoSets.refreshFailed')),
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!upload.file) throw new Error('no file');
      return uploadGeoSet({ file: upload.file, name: upload.name.trim(), kind: upload.kind });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['geo-sets'] });
      qc.invalidateQueries({ queryKey: ['geo-rollout'] });
      setUpload({ open: false, name: '', kind: 'geosite', file: null });
      notifications.show({ color: 'green', message: t('geoSets.uploaded') });
    },
    onError: (err) => showRefusal(err, t('geoSets.uploadFailed')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteGeoSet(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['geo-sets'] });
      notifications.show({ color: 'green', message: t('geoSets.deleted') });
    },
    onError: (err) => showRefusal(err, t('common.deleteError')),
  });

  /**
   * Отказы сервера словами, и один из них особенный.
   *
   * `GEO_SET_IN_USE` называет политики поимённо: без этого списка «нельзя»
   * отправляет оператора искать по всем правилам вручную.
   */
  function showRefusal(err: unknown, title: string) {
    const r = geoSetRefusal(err);
    const message = isNotImplemented(err)
      ? t('geoSets.soonBody')
      : r?.code === 'GEO_SET_IN_USE'
        ? t('geoSets.inUse', { policies: (r.policies ?? []).join(', ') || t('geoSets.inUseUnnamed') })
        : (r?.message ?? apiErrorMessage(err));
    notifications.show({ color: isNotImplemented(err) ? 'yellow' : 'red', title, message });
  }

  function confirmDelete(set: GeoSet) {
    modals.openConfirmModal({
      title: t('geoSets.deleteTitle', { name: set.name }),
      children: (
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '19px', color: SNOW }}>
          {t('geoSets.deleteBody')}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(set.id),
    });
  }

  return (
    <Stack gap={20}>
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          borderRadius: 12,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Text style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 500, color: SNOW }}>
          {t('geoSets.title')}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: MIST }}>
          {facts.state === 'list' ? t('geoSets.count', { n: facts.total }) : ''}
        </Text>
        <Box style={{ flex: 1 }} />
        <GhostButton
          disabled={facts.state === 'unavailable' || uploadMutation.isPending}
          onClick={() => setUpload((u) => ({ ...u, open: !u.open }))}
        >
          {t('geoSets.upload')}
        </GhostButton>
      </Box>

      {facts.state === 'unavailable' && (
        <Placeholder title={t('geoSets.soonTitle')} body={t('geoSets.soonBody')} />
      )}
      {facts.state === 'empty' && (
        <Placeholder title={t('geoSets.emptyTitle')} body={t('geoSets.emptyBody')} />
      )}
      {upload.open && (
        <UploadPanel
          busy={uploadMutation.isPending}
          onCancel={() => setUpload({ open: false, name: '', kind: 'geosite', file: null })}
          state={upload}
          onState={setUpload}
          onSubmit={() => uploadMutation.mutate()}
        />
      )}

      {facts.state === 'list' &&
        facts.sets.map((s) => (
          <GeoSetRow
            key={s.id}
            set={s}
            rollout={rollout}
            nodeNames={nodeNames}
            expanded={expandedId === s.id}
            busy={refresh.isPending && refresh.variables === s.id}
            onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
            onRefresh={() => refresh.mutate(s.id)}
            onDelete={() => confirmDelete(s)}
          />
        ))}
    </Stack>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <Box
      style={{
        padding: '28px 22px',
        borderRadius: 12,
        backgroundColor: CARD,
        border: `1px dashed ${HAIRLINE}`,
      }}
    >
      <Stack gap={8}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 14, color: SNOW }}>{title}</Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '18px', color: MIST, maxWidth: 680 }}>
          {body}
        </Text>
      </Stack>
    </Box>
  );
}

function GeoSetRow({
  set,
  rollout,
  nodeNames,
  expanded,
  busy,
  onToggle,
  onRefresh,
  onDelete,
}: {
  set: GeoSet;
  rollout: GeoRolloutNode[] | null;
  nodeNames: Map<string, string>;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const sum = rollout ? rolloutSummary(set, rollout) : null;
  const actions = geoSetActions(set);
  const tone = set.status === 'invalid' ? RED : set.status === 'fetching' ? AMBER : MOSS;

  return (
    <Stack gap={0}>
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 16px',
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${set.status === 'invalid' ? `${RED}44` : HAIRLINE}`,
      }}
    >
      <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
      <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: SNOW }}>{set.name}</Text>
          <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', color: MIST }}>
            {set.kind}
          </Text>
        </Box>
        {/* Источник словами: «откуда файл» это первое, что спрашивают, когда
            версия на ноде не та, которую ждали. */}
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '14px', color: DIM }}>
          {sourceWords(set, t)}
        </Text>
      </Stack>

      <Stack gap={2} style={{ flexShrink: 0, alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: SNOW }}>{set.version}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 10, color: FAINT }}>
          {t('geoSets.fetched', { when: relativeTime(set.fetchedAt, t).text })}
        </Text>
      </Stack>

      {/* Сколько нод несут ИМЕННО эту версию. Пока раскладки нет, тут молчание,
          а не «0 из 0»: ноль сказал бы, что не несёт никто. */}
      <Box style={{ width: 150, flexShrink: 0, textAlign: 'right' }}>
        {sum ? (
          <Stack gap={2} style={{ alignItems: 'flex-end' }}>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: sum.same === sum.total && sum.total > 0 ? MOSS : AMBER,
              }}
            >
              {t('geoSets.onNodes', { same: sum.same, total: sum.total })}
            </Text>
            {sum.hasDiverged && (
              <Text style={{ fontFamily: MONO, fontSize: 10, color: AMBER }}>
                {t('geoSets.diverged', { n: sum.diverged })}
              </Text>
            )}
          </Stack>
        ) : (
          <Text style={{ fontFamily: MONO, fontSize: 10, color: DIM }}>{t('geoSets.rolloutUnknown')}</Text>
        )}
      </Box>

      {set.status === 'invalid' && (
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '14px', color: RED, maxWidth: 260 }}>
          {set.error ?? t('geoSets.invalidNoMessage')}
        </Text>
      )}

      {/* Обновление есть только у ссылки и встроенного: загруженный файл
          «обновляют» новой загрузкой, и кнопка с тем же словом врала бы. */}
      {actions.canRefresh && (
        <GhostButton disabled={busy} onClick={onRefresh}>
          {busy ? t('geoSets.refreshing') : t('geoSets.refresh')}
        </GhostButton>
      )}
      <GhostButton disabled={!actions.canDelete} onClick={onDelete}>
        {t('common.delete')}
      </GhostButton>
      <GhostButton onClick={onToggle}>
        {expanded ? t('geoSets.hideNodes') : t('geoSets.showNodes')}
      </GhostButton>
    </Box>

    {expanded && (
      <Box
        style={{
          margin: '0 16px',
          padding: '10px 14px',
          borderRadius: '0 0 10px 10px',
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
          borderTop: 'none',
        }}
      >
        {rollout === null ? (
          <Text style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>
            {t('geoSets.rolloutUnknownLong')}
          </Text>
        ) : rollout.length === 0 ? (
          <Text style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>{t('geoSets.noNodes')}</Text>
        ) : (
          <Stack gap={4}>
            {rollout.map((n) => (
              <RolloutRow key={n.nodeId} set={set} node={n} name={nodeNames.get(n.nodeId) ?? n.nodeId} />
            ))}
          </Stack>
        )}
      </Box>
    )}
    </Stack>
  );
}

/** Одна нода в раскладке: что на ней лежит и что это значит. */
function RolloutRow({
  set,
  node,
  name,
}: {
  set: GeoSet;
  node: GeoRolloutNode;
  name: string;
}) {
  const { t } = useTranslation();
  const f = rolloutFacts(set, node);
  // Янтарное у обоих несовпадений и серое у незнания: «отстаёт» и «ушла
  // вперёд» это разные новости, но обе требуют внимания, а молчание нет.
  const tone = f.state === 'same' ? MOSS : f.state === 'unknown' ? DIM : AMBER;

  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Box style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: SNOW, width: 200, flexShrink: 0 }}>
        {name}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 11, color: f.version ? SNOW : DIM, width: 160 }}>
        {f.version ?? t('geoSets.noVersion')}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 10, color: FAINT, width: 150 }}>
        {f.appliedAt ? t('geoSets.applied', { when: relativeTime(f.appliedAt, t).text }) : ''}
      </Text>
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, color: tone }}>
        {t(`geoSets.state.${f.state}`)}
      </Text>
    </Box>
  );
}

interface UploadState {
  open: boolean;
  name: string;
  kind: GeoSetKind;
  file: File | null;
}

/**
 * Загрузка своего файла.
 *
 * Имя и вид спрашиваются ЗДЕСЬ, а не выводятся из файла: `geoip.dat` может
 * оказаться списком доменов, и угадывать вид значит однажды подсунуть правилу
 * не тот набор. Имя подставляется из имени файла, потому что это хорошая
 * догадка, но её видно и её можно поправить.
 */
function UploadPanel({
  state,
  onState,
  onSubmit,
  onCancel,
  busy,
}: {
  state: UploadState;
  onState: (next: UploadState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 12,
        padding: '14px 16px',
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Label>{t('geoSets.uploadName')}</Label>
        <TextInput value={state.name} onChange={(e) => onState({ ...state, name: e.currentTarget.value })} />
      </Stack>
      <Stack gap={4} style={{ width: 160 }}>
        <Label>{t('geoSets.uploadKind')}</Label>
        <Select
          data={['geosite', 'geoip']}
          value={state.kind}
          allowDeselect={false}
          onChange={(v) => v && onState({ ...state, kind: v as GeoSetKind })}
        />
      </Stack>
      <Stack gap={4} style={{ width: 260 }}>
        <Label>{t('geoSets.uploadFile')}</Label>
        <input
          type="file"
          accept=".dat,.srs,.db,.mmdb"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0] ?? null;
            onState({
              ...state,
              file,
              name: state.name || (file ? file.name.replace(/\.[^.]+$/, '') : ''),
            });
          }}
          style={{ fontFamily: MONO, fontSize: 11, color: MIST }}
        />
      </Stack>
      <GhostButton onClick={onCancel}>{t('common.cancel')}</GhostButton>
      <GhostButton disabled={!state.file || state.name.trim() === '' || busy} onClick={onSubmit}>
        {busy ? t('geoSets.uploading') : t('geoSets.uploadAction')}
      </GhostButton>
    </Box>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}

/** Тихая кнопка. Своя, а не из чужого контура: линт это стережёт. */
function GhostButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 32,
        paddingInline: 12,
        borderRadius: 8,
        border: `1px solid ${HAIRLINE}`,
        backgroundColor: CARD,
        color: disabled ? DIM : SNOW,
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        cursor: disabled ? 'default' : 'pointer',
        flexShrink: 0,
      }}
    >
      {children}
    </UnstyledButton>
  );
}

function sourceWords(set: GeoSet, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (set.source.type === 'builtin') return t('geoSets.sourceBuiltin', { tag: set.source.tag });
  if (set.source.type === 'url') return t('geoSets.sourceUrl', { url: set.source.url });
  return t('geoSets.sourceUpload', { filename: set.source.filename });
}
