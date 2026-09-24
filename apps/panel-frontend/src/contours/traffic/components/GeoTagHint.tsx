import { useTranslation } from 'react-i18next';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { getGeoTags } from '@/lib/domain/geoSets';
import { geoTagQuery, withGeoTag } from '@/contours/traffic/lib/geoTagHint';
import { useGeoSets } from '@/contours/traffic/lib/useGeoSets';
import { CARD, DIM, DISPLAY, EDGE, FAINT, HAIRLINE, MIST, MONO, SNOW, WELL } from '@/contours/traffic/lib/colors';

/**
 * Выпадающая подсказка тегов под полем правила (Ф9.5).
 *
 * Появляется, пока последний токен строки это `geosite:…`, `geoip:…` или
 * `ext:<name>:…`, и поле в фокусе. Теги спрашиваются у сервера по набору
 * (GET /api/geo-sets/:id/tags?q=), список хранится у панели после проверки.
 * Без проверенной версии тегов нет, и подсказка так и говорит: сервер в этом
 * случае тег не проверяет (geo-contract §6), значит и экран не выдумывает.
 * Щелчок заменяет набираемый токен; mousedown не отнимает фокус у поля.
 */
export function GeoTagHint({ line, open, onPick }: { line: string; open: boolean; onPick: (line: string) => void }) {
  const { t } = useTranslation();
  const { byName } = useGeoSets();
  const query = open ? geoTagQuery(line) : null;
  const set = query ? byName.get(query.setName) : undefined;
  const tagsQuery = useQuery({
    queryKey: ['geo-tags', set?.id, query?.q],
    queryFn: () => getGeoTags(set!.id, query!.q, 8),
    enabled: !!set && !!set.current,
    staleTime: 60_000,
  });

  if (!query || byName.size === 0) return null;

  const note = !set
    ? t('geoSets.hint.unknownSet', { name: query.setName })
    : !set.current
      ? t('geoSets.hint.noCurrent', { name: set.name })
      : tagsQuery.data && tagsQuery.data.tags.length === 0
        ? t('geoSets.hint.noTags', { q: query.q })
        : null;

  return (
    <Box
      style={{
        position: 'absolute',
        top: 36,
        left: 0,
        right: 0,
        zIndex: 20,
        borderRadius: 8,
        backgroundColor: CARD,
        border: `1px solid ${EDGE}`,
        overflow: 'hidden',
      }}
    >
      {note ? (
        <Text style={{ padding: '8px 10px', fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: MIST }}>{note}</Text>
      ) : (
        (tagsQuery.data?.tags ?? []).map((tag, i) => (
          <UnstyledButton
            key={tag.name}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(withGeoTag(line, query, tag.name));
            }}
            style={{
              display: 'flex',
              width: '100%',
              alignItems: 'center',
              gap: 10,
              padding: '6px 10px',
              borderTop: i === 0 ? undefined : `1px solid ${HAIRLINE}`,
              backgroundColor: WELL,
            }}
          >
            <Text style={{ fontFamily: MONO, fontSize: 12, color: SNOW, flex: 1, minWidth: 0 }}>
              {query.prefix}
              {tag.name}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, color: FAINT }}>{t('geoSets.hint.entries', { count: tag.entries })}</Text>
          </UnstyledButton>
        ))
      )}
      {!note && tagsQuery.data && tagsQuery.data.total > tagsQuery.data.tags.length && (
        <Text style={{ padding: '6px 10px', fontFamily: DISPLAY, fontSize: 10, color: DIM, borderTop: `1px solid ${HAIRLINE}` }}>
          {t('geoSets.hint.more', { shown: tagsQuery.data.tags.length, total: tagsQuery.data.total })}
        </Text>
      )}
    </Box>
  );
}
