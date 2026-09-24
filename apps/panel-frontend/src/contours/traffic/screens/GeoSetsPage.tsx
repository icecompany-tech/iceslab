import { useRef, useState } from 'react';
import { GEO_SET_KINDS } from '@iceslab/shared';
import { useTranslation } from 'react-i18next';
import { Box, NumberInput, SegmentedControl, Select, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage } from '@/lib/net/client';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { relativeTime } from '@/lib/ui/relativeTime';
import {
  createGeoSet,
  deleteGeoSet,
  geoSetRefusal,
  isNotImplemented,
  listGeoSets,
  nodeGeoFacts,
  refreshGeoSet,
  replaceGeoSetFile,
  uploadGeoSet,
  type GeoSet,
  type GeoSetKind,
} from '@/lib/domain/geoSets';
import { listNodes } from '@/lib/domain/nodes';
import { nodeFieldKnown } from '@/lib/domain/nodeFields';
import {
  geoAttention,
  geoNameProblem,
  geoScreenFacts,
  geoSetActions,
  geoSetState,
  uploadProblem,
  usesWords,
} from '@/contours/traffic/lib/geoFacts';
import { GeoRolloutModal } from '@/contours/traffic/components/GeoRolloutModal';
import {
  AMBER,
  CARD,
  DIM,
  DISPLAY,
  FAINT,
  HAIRLINE,
  MIST,
  MONO,
  MOSS,
  RED,
  SNOW,
  WELL,
} from '@/contours/traffic/lib/colors';

/**
 * Гео-наборы (Ф9.5, контракт `docs/plan/geo-contract.md`): списки доменов и
 * адресов, которыми правила нод решают судьбу трафика.
 *
 * Строка отвечает сразу на три вопроса: ЧТО это (имя, вид, формат, источник),
 * КАКАЯ проверенная версия у панели и чем кончилась последняя попытка, и
 * СКОЛЬКО нод и правил на набор завязано. Два действия разведены намеренно:
 * «Обновить сейчас» тянет и проверяет новую версию на панели, «Разослать на
 * ноды» двигает пины нод и перезапускает xray. Совместить их значило бы рвать
 * сессии при каждом обновлении списка.
 *
 * ⚠ До бэкенда фазы 9 запросы отвечают 404: экран говорит «появится с фазой 9».
 */
export function GeoSetsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  usePageMeta([]);

  const setsQuery = useQuery({
    queryKey: ['geo-sets'],
    queryFn: listGeoSets,
    retry: (count, err) => !isNotImplemented(err) && count < 2,
    // Скачивание и проверка идут фоном (ответ 202): пока хоть один набор в
    // проверке, список переспрашивается, иначе «проверяется» висело бы вечно.
    refetchInterval: (q) => (q.state.data?.geoSets.some((s) => s.status === 'checking') ? 3000 : false),
  });
  const facts = geoScreenFacts({
    sets: setsQuery.data?.geoSets,
    notImplemented: isNotImplemented(setsQuery.error),
  });

  // Что требует внимания: битые наборы и ноды, у которых гео отстаёт. Ноды
  // считаются по факту карточек (nodeGeoFacts), тем же ключом кэша, что у
  // списка нод. Отдельного ящика внимания в панели пока нет.
  const nodesQuery = useQuery({ queryKey: ['nodes', 'all'], queryFn: () => listNodes({ limit: 100 }) });
  const geoKnown = nodeFieldKnown(nodesQuery.data, 'geo');
  const nodesBehind = (nodesQuery.data?.nodes ?? []).filter((n) => nodeGeoFacts(n, geoKnown)?.state === 'behind').length;
  const attention = facts.state === 'list' ? geoAttention(facts.sets, nodesBehind) : null;

  const [adding, setAdding] = useState<'url' | 'upload' | null>(null);
  const [rolloutFor, setRolloutFor] = useState<GeoSet | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['geo-sets'] });

  function showRefusal(err: unknown, title: string) {
    if (isNotImplemented(err)) {
      notifications.show({ color: 'yellow', title, message: t('geoSets.soonBody') });
      return;
    }
    const r = geoSetRefusal(err);
    const message =
      r?.code === 'GEO_SET_IN_USE'
        ? t('geoSets.inUse', { uses: usesWords(r.uses, t) })
        : r?.code === 'GEO_SET_INVALID' && r.reason
          ? t(`geoSets.invalid.${r.reason}`, { defaultValue: r.message ?? r.reason })
          : r?.code === 'GEO_SET_NAME_TAKEN'
            ? t('geoSets.nameTaken')
            : r?.code === 'GEO_SET_BUILTIN'
              ? t('geoSets.builtinNoDelete')
              : (r?.message ?? apiErrorMessage(err));
    notifications.show({ color: 'red', title, message, autoClose: 12000 });
  }

  const refresh = useMutation({
    mutationFn: (id: string) => refreshGeoSet(id),
    onSuccess: invalidate,
    onError: (err) => showRefusal(err, t('geoSets.refreshFailed')),
  });
  const replace = useMutation({
    mutationFn: (p: { id: string; file: File }) => replaceGeoSetFile(p.id, p.file),
    onSuccess: invalidate,
    onError: (err) => showRefusal(err, t('geoSets.uploadFailed')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteGeoSet(id),
    onSuccess: () => {
      invalidate();
      notifications.show({ color: 'green', message: t('geoSets.deleted') });
    },
    onError: (err) => showRefusal(err, t('common.deleteError')),
  });

  function confirmDelete(set: GeoSet) {
    modals.openConfirmModal({
      title: t('geoSets.deleteTitle', { name: set.name }),
      children: (
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '19px', color: SNOW }}>
          {set.usedByRules > 0 ? t('geoSets.deleteBodyUsed', { count: set.usedByRules }) : t('geoSets.deleteBody')}
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
        <Text style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 500, color: SNOW }}>{t('geoSets.title')}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: MIST }}>
          {facts.state === 'list' ? t('geoSets.count', { n: facts.total }) : ''}
        </Text>
        <Box style={{ flex: 1 }} />
        <GhostButton disabled={facts.state === 'unavailable'} onClick={() => setAdding(adding === 'url' ? null : 'url')}>
          {t('geoSets.addUrl')}
        </GhostButton>
        <GhostButton
          disabled={facts.state === 'unavailable'}
          onClick={() => setAdding(adding === 'upload' ? null : 'upload')}
        >
          {t('geoSets.upload')}
        </GhostButton>
      </Box>

      {attention && (
        <Box style={{ padding: '10px 16px', borderRadius: 10, border: `1px solid ${AMBER}55`, backgroundColor: `${AMBER}12` }}>
          {attention.broken.length > 0 && (
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '18px', color: RED }}>
              {t('geoSets.attention.broken', { count: attention.broken.length, names: attention.broken.join(', ') })}
            </Text>
          )}
          {attention.nodesBehind > 0 && (
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '18px', color: AMBER }}>
              {t('geoSets.attention.behind', { count: attention.nodesBehind })}
            </Text>
          )}
        </Box>
      )}

      {facts.state === 'unavailable' && (
        <Placeholder
          title={setsQuery.isLoading ? t('common.loading') : t('geoSets.soonTitle')}
          body={setsQuery.isLoading ? '' : t('geoSets.soonBody')}
        />
      )}
      {facts.state === 'empty' && <Placeholder title={t('geoSets.emptyTitle')} body={t('geoSets.emptyBody')} />}

      {adding === 'url' && (
        <AddUrlPanel
          onDone={() => {
            setAdding(null);
            invalidate();
          }}
          onCancel={() => setAdding(null)}
          onRefusal={(err) => showRefusal(err, t('geoSets.addFailed'))}
        />
      )}
      {adding === 'upload' && (
        <UploadPanel
          onDone={() => {
            setAdding(null);
            invalidate();
          }}
          onCancel={() => setAdding(null)}
          onRefusal={(err) => showRefusal(err, t('geoSets.uploadFailed'))}
        />
      )}

      {facts.state === 'list' &&
        facts.sets.map((s) => (
          <GeoSetRow
            key={s.id}
            set={s}
            refreshing={refresh.isPending && refresh.variables === s.id}
            onRefresh={() => refresh.mutate(s.id)}
            onReplace={(file) => replace.mutate({ id: s.id, file })}
            onRollout={() => setRolloutFor(s)}
            onDelete={() => confirmDelete(s)}
          />
        ))}

      <GeoRolloutModal set={rolloutFor} onClose={() => setRolloutFor(null)} />
    </Stack>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <Box style={{ padding: '28px 22px', borderRadius: 12, backgroundColor: CARD, border: `1px dashed ${HAIRLINE}` }}>
      <Stack gap={8}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 14, color: SNOW }}>{title}</Text>
        {body && (
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '18px', color: MIST, maxWidth: 680 }}>{body}</Text>
        )}
      </Stack>
    </Box>
  );
}

function GeoSetRow({
  set,
  refreshing,
  onRefresh,
  onReplace,
  onRollout,
  onDelete,
}: {
  set: GeoSet;
  refreshing: boolean;
  onRefresh: () => void;
  onReplace: (file: File) => void;
  onRollout: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const state = geoSetState(set);
  const actions = geoSetActions(set);
  const fileInput = useRef<HTMLInputElement>(null);
  const tone = state === 'verified' ? MOSS : state === 'checking' ? AMBER : RED;

  return (
    <Stack
      gap={8}
      style={{
        padding: '12px 16px',
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${state.startsWith('broken') ? `${RED}44` : HAIRLINE}`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: SNOW }}>{set.name}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', color: MIST }}>
              {set.kind} · {set.format}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, color: tone }}>{t(`geoSets.status.${state}`)}</Text>
          </Box>
          <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '14px', color: DIM }}>{sourceWords(set, t)}</Text>
        </Stack>

        {/* Проверенная версия: то, что можно разослать. Нет её - так и сказано. */}
        <Stack gap={2} style={{ flexShrink: 0, alignItems: 'flex-end', width: 170 }}>
          <Text
            // Сумма файла, как он пришёл (sourceSha256): её оператор сверяет со
            // своим файлом. У .dat она та же, что у файла на нодах.
            title={
              set.current
                ? set.current.sourceSha256 && set.current.sourceSha256 !== set.current.sha256
                  ? `sha256 ${set.current.sourceSha256} (.dat ${set.current.sha256})`
                  : `sha256 ${set.current.sha256}`
                : undefined
            }
            style={{ fontFamily: MONO, fontSize: 11, color: set.current ? SNOW : DIM }}
          >
            {set.current ? set.current.version : t('geoSets.noCurrent')}
          </Text>
          {set.current && (
            <Text style={{ fontFamily: MONO, fontSize: 10, color: FAINT }}>
              {t('geoSets.fetched', { when: relativeTime(set.current.fetchedAt, t).text })} ·{' '}
              {t('geoSets.tags', { count: set.current.tagCount })}
            </Text>
          )}
        </Stack>

        {/* Что на набор завязано: правила и ноды, и сколько нод на старом пине. */}
        <Stack gap={2} style={{ flexShrink: 0, alignItems: 'flex-end', width: 150 }}>
          <Text style={{ fontFamily: MONO, fontSize: 11, color: set.usedByRules ? SNOW : DIM }}>
            {t('geoSets.usedByRules', { count: set.usedByRules })}
          </Text>
          <Text
            title={set.nodes.behind > 0 ? t('geoSets.nodesBehindHint') : undefined}
            style={{ fontFamily: MONO, fontSize: 10, color: set.nodes.behind > 0 ? AMBER : FAINT }}
          >
            {set.nodes.behind > 0
              ? t('geoSets.nodesBehind', { behind: set.nodes.behind, total: set.nodes.total })
              : t('geoSets.nodesTotal', { count: set.nodes.total })}
          </Text>
        </Stack>

        {actions.refresh && (
          <GhostButton disabled={refreshing} onClick={onRefresh}>
            {refreshing ? t('geoSets.refreshing') : t('geoSets.refresh')}
          </GhostButton>
        )}
        {actions.replaceFile && (
          <>
            <GhostButton onClick={() => fileInput.current?.click()}>{t('geoSets.replaceFile')}</GhostButton>
            <input
              ref={fileInput}
              type="file"
              hidden
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file && uploadProblem(file) === 'too-large') {
                  notifications.show({ color: 'red', title: t('geoSets.uploadFailed'), message: t('geoSets.tooLarge') });
                } else if (file) {
                  onReplace(file);
                }
                e.currentTarget.value = '';
              }}
            />
          </>
        )}
        <GhostButton disabled={!actions.rollout} onClick={onRollout}>
          {t('geoSets.rolloutAction')}
        </GhostButton>
        <GhostButton
          disabled={!actions.delete}
          title={actions.deleteBlocked ? t(`geoSets.deleteBlocked.${actions.deleteBlocked}`, { count: set.usedByRules }) : undefined}
          onClick={onDelete}
        >
          {t('common.delete')}
        </GhostButton>
      </Box>

      {/* Битый это два разных текста: нечего слать вовсе, или обновление не
          прошло, а на нодах по-прежнему проверенная версия. */}
      {state === 'broken-empty' && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: RED, paddingLeft: 20 }}>
          {t('geoSets.brokenEmpty', { error: set.error ?? t('geoSets.noError') })}
        </Text>
      )}
      {state === 'broken-update' && set.current && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: RED, paddingLeft: 20 }}>
          {t('geoSets.brokenUpdate', { error: set.error ?? t('geoSets.noError'), version: set.current.version })}
        </Text>
      )}
      {state === 'checking' && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: FAINT, paddingLeft: 20 }}>
          {set.current ? t('geoSets.checkingOver', { version: set.current.version }) : t('geoSets.checkingFirst')}
        </Text>
      )}
    </Stack>
  );
}

const KIND_OPTIONS: GeoSetKind[] = [...GEO_SET_KINDS];

/** sha256 файла в браузере, hex. Для сверки оператором с тем, что он скачал. */
async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Свой набор по ссылке: sha256 из соседнего файла или руками, интервал в часах. */
function AddUrlPanel({
  onDone,
  onCancel,
  onRefusal,
}: {
  onDone: () => void;
  onCancel: () => void;
  onRefusal: (err: unknown) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<GeoSetKind>('geosite');
  const [url, setUrl] = useState('');
  const [shaSource, setShaSource] = useState<'sidecar' | 'manual'>('sidecar');
  const [sha, setSha] = useState('');
  const [hours, setHours] = useState<number | ''>(24);
  const nameProblem = geoNameProblem(name.trim());
  const shaBad = shaSource === 'manual' && !/^[0-9a-f]{64}$/i.test(sha.trim());

  const create = useMutation({
    mutationFn: () =>
      createGeoSet({
        name: name.trim(),
        kind,
        source: {
          type: 'url',
          url: url.trim(),
          sha256Source: shaSource,
          ...(shaSource === 'manual' ? { sha256: sha.trim().toLowerCase() } : {}),
          ...(hours === '' ? {} : { refreshHours: hours }),
        },
      }),
    onSuccess: onDone,
    onError: onRefusal,
  });

  return (
    <Stack gap={10} style={{ padding: '14px 16px', borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
      <Box style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <Stack gap={4} style={{ width: 200 }}>
          <Label>{t('geoSets.uploadName')}</Label>
          <TextInput
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            error={name && nameProblem ? t(`geoSets.name.${nameProblem}`) : undefined}
          />
        </Stack>
        <Stack gap={4} style={{ width: 130 }}>
          <Label>{t('geoSets.uploadKind')}</Label>
          <Select data={KIND_OPTIONS} value={kind} allowDeselect={false} onChange={(v) => v && setKind(v as GeoSetKind)} />
        </Stack>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Label>{t('geoSets.url')}</Label>
          <TextInput value={url} placeholder="https://…/geosite.dat" onChange={(e) => setUrl(e.currentTarget.value)} />
        </Stack>
        <Stack gap={4} style={{ width: 110 }}>
          <Label>{t('geoSets.refreshHours')}</Label>
          <NumberInput value={hours} min={1} onChange={(v) => setHours(typeof v === 'number' ? v : '')} />
        </Stack>
      </Box>
      <Box style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <Stack gap={4}>
          <Label>{t('geoSets.shaSource')}</Label>
          <SegmentedControl
            size="xs"
            value={shaSource}
            onChange={(v) => setShaSource(v as 'sidecar' | 'manual')}
            data={[
              { value: 'sidecar', label: t('geoSets.shaSidecar') },
              { value: 'manual', label: t('geoSets.shaManual') },
            ]}
          />
        </Stack>
        {shaSource === 'manual' && (
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <Label>sha256</Label>
            <TextInput value={sha} onChange={(e) => setSha(e.currentTarget.value)} error={sha && shaBad ? t('geoSets.shaBad') : undefined} />
          </Stack>
        )}
        <Box style={{ flex: shaSource === 'manual' ? 0 : 1 }} />
        <GhostButton onClick={onCancel}>{t('common.cancel')}</GhostButton>
        <GhostButton
          disabled={nameProblem !== null || url.trim() === '' || shaBad || create.isPending}
          onClick={() => create.mutate()}
        >
          {t('geoSets.addAction')}
        </GhostButton>
      </Box>
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: FAINT }}>{t('geoSets.addHint')}</Text>
    </Stack>
  );
}

/**
 * Загрузка своего файла. Имя и вид спрашиваются здесь, а не выводятся из
 * файла: `geoip.dat` может оказаться списком доменов. Имя подставляется из
 * имени файла как догадка, её видно и её можно поправить.
 */
function UploadPanel({
  onDone,
  onCancel,
  onRefusal,
}: {
  onDone: () => void;
  onCancel: () => void;
  onRefusal: (err: unknown) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<GeoSetKind>('geosite');
  const [file, setFile] = useState<File | null>(null);
  // sha256 выбранного файла, посчитанный здесь же: у загрузки нет соседнего
  // файла с суммой, и это единственное место, где оператор может сверить её
  // сам. Считается для текущего файла; сменили файл, старая сумма не видна.
  const [sha, setSha] = useState<{ file: File; hex: string } | null>(null);
  // Сумма, которую публикует источник (необязательно). Сервер сверит её с
  // файлом в том же запросе; не совпала, набор будет broken словами.
  const [expected, setExpected] = useState('');
  const expectedHex = expected.trim().toLowerCase();
  const expectedBad = expectedHex !== '' && !/^[0-9a-f]{64}$/.test(expectedHex);
  const nameProblem = geoNameProblem(name.trim());
  const fileProblem = uploadProblem(file);

  const upload = useMutation({
    mutationFn: () =>
      uploadGeoSet({ file: file!, name: name.trim(), kind, ...(expectedHex ? { sha256: expectedHex } : {}) }),
    onSuccess: (set) => {
      // Проверка шла в самом запросе: итог сразу, словами сервера.
      notifications.show(
        set.status === 'verified'
          ? { color: 'green', message: t('geoSets.uploadVerified', { name: set.name }) }
          : { color: 'red', title: t('geoSets.uploadBroken', { name: set.name }), message: set.error ?? t('geoSets.noError'), autoClose: 15000 },
      );
      onDone();
    },
    onError: onRefusal,
  });

  return (
    <Stack gap={8} style={{ padding: '14px 16px', borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
      <Box style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <Stack gap={4} style={{ width: 200 }}>
          <Label>{t('geoSets.uploadName')}</Label>
          <TextInput
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            error={name && nameProblem ? t(`geoSets.name.${nameProblem}`) : undefined}
          />
        </Stack>
        <Stack gap={4} style={{ width: 130 }}>
          <Label>{t('geoSets.uploadKind')}</Label>
          <Select data={KIND_OPTIONS} value={kind} allowDeselect={false} onChange={(v) => v && setKind(v as GeoSetKind)} />
        </Stack>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Label>{t('geoSets.uploadFile')}</Label>
          <input
            type="file"
            accept=".dat,.json,.mmdb"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0] ?? null;
              setFile(f);
              if (f && !name) setName(f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 32));
              if (f && uploadProblem(f) === null) {
                fileSha256(f).then((hex) => setSha({ file: f, hex })).catch(() => setSha(null));
              }
            }}
            style={{ fontFamily: MONO, fontSize: 11, color: MIST }}
          />
        </Stack>
        <Stack gap={4} style={{ width: 260 }}>
          <Label>{t('geoSets.expectedSha')}</Label>
          <TextInput
            value={expected}
            placeholder={t('geoSets.expectedShaPlaceholder')}
            onChange={(e) => setExpected(e.currentTarget.value)}
            error={expectedBad ? t('geoSets.shaBad') : undefined}
          />
        </Stack>
        <GhostButton onClick={onCancel}>{t('common.cancel')}</GhostButton>
        <GhostButton
          disabled={fileProblem !== null || nameProblem !== null || expectedBad || upload.isPending}
          onClick={() => upload.mutate()}
        >
          {upload.isPending ? t('geoSets.uploading') : t('geoSets.uploadAction')}
        </GhostButton>
      </Box>
      {fileProblem === 'too-large' && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: RED }}>{t('geoSets.tooLarge')}</Text>
      )}
      {file && sha?.file === file && (
        <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '16px', color: MIST, overflowWrap: 'anywhere' }}>
          {t('geoSets.fileSha', { sha: sha.hex })}
        </Text>
      )}
      {/* Сверка до отправки: посчитанная сумма против той, что ввели. Решает
          сервер, это только предупреждение. */}
      {file && sha?.file === file && expectedHex && !expectedBad && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: expectedHex === sha.hex ? MOSS : AMBER }}>
          {expectedHex === sha.hex ? t('geoSets.expectedMatch') : t('geoSets.expectedMismatch')}
        </Text>
      )}
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: FAINT }}>{t('geoSets.uploadHint')}</Text>
    </Stack>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: MIST }}>
      {children}
    </Text>
  );
}

/** Тихая кнопка. Своя, а не из чужого контура: линт это стережёт. */
function GhostButton({
  children,
  disabled,
  title,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      title={title}
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
  if (set.source.type === 'url')
    return t(set.source.sha256Source === 'manual' ? 'geoSets.sourceUrlManual' : 'geoSets.sourceUrl', {
      url: set.source.url,
      hours: set.source.refreshHours,
    });
  return t('geoSets.sourceUpload', { filename: set.source.filename });
}
