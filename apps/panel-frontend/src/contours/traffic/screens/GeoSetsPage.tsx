import { useTranslation } from 'react-i18next';
import { Box, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { relativeTime } from '@/lib/ui/relativeTime';
import {
  getGeoRollout,
  isNotImplemented,
  listGeoSets,
  type GeoSet,
  type GeoRolloutNode,
} from '@/lib/domain/geoSets';
import { geoScreenFacts, rolloutSummary } from '@/contours/traffic/lib/geoFacts';
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

  const facts = geoScreenFacts({
    sets: setsQuery.data?.sets,
    notImplemented: isNotImplemented(setsQuery.error),
  });
  const rollout = rolloutQuery.data?.nodes ?? null;

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
      </Box>

      {facts.state === 'unavailable' && (
        <Placeholder title={t('geoSets.soonTitle')} body={t('geoSets.soonBody')} />
      )}
      {facts.state === 'empty' && (
        <Placeholder title={t('geoSets.emptyTitle')} body={t('geoSets.emptyBody')} />
      )}
      {facts.state === 'list' &&
        facts.sets.map((s) => <GeoSetRow key={s.id} set={s} rollout={rollout} />)}
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

function GeoSetRow({ set, rollout }: { set: GeoSet; rollout: GeoRolloutNode[] | null }) {
  const { t } = useTranslation();
  const sum = rollout ? rolloutSummary(set, rollout) : null;
  const tone = set.status === 'invalid' ? RED : set.status === 'fetching' ? AMBER : MOSS;

  return (
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
    </Box>
  );
}

function sourceWords(set: GeoSet, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (set.source.type === 'builtin') return t('geoSets.sourceBuiltin', { tag: set.source.tag });
  if (set.source.type === 'url') return t('geoSets.sourceUrl', { url: set.source.url });
  return t('geoSets.sourceUpload', { filename: set.source.filename });
}
