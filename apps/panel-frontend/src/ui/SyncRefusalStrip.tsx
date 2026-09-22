import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import type { SyncRefusal } from '@/lib/domain/syncRefusal';
import { MIST, RED, SNOW, WELL } from '@/lib/ui/tokens';

// Краски из общих токенов, локальной копии больше нет: `lib/ui/tokens.ts` это
// законный источник и для `ui/`, и для контуров (сведение 2026-09-22).
const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/**
 * «Нода отвергла конфиг», словами самого ядра.
 *
 * Первой строкой причина, потому что в двух случаях из трёх её достаточно,
 * чтобы понять, какую галочку вернуть назад. Полный ответ под раскрытием: он
 * несёт баннер ядра и служебные строки, нужные, когда причина непонятна, и
 * мешающие, когда понятна.
 *
 * Полоса не говорит «исправьте и нажмите повтор»: кнопки повтора здесь нет, а
 * состояние снимается само, как только нода примет конфиг.
 */
export function SyncRefusalStrip({
  refusal,
  compact = false,
  tag,
  title,
  note,
}: {
  refusal: SyncRefusal;
  compact?: boolean;
  /** Чем подписан отказ. По умолчанию это отказ ядра принять конфиг; процесс
   *  цепи ломается по-своему и называет себя сам. */
  tag?: string;
  title?: string;
  /** Подпись внизу. `null` убирает её: у процесса цепи состояние снимается по
   *  другому событию, и чужая формулировка врала бы про причину. */
  note?: string | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 6 : 12,
        width: '100%',
        padding: compact ? '10px 12px' : '16px 18px',
        borderRadius: 10,
        backgroundColor: `${RED}0F`,
        border: `1px solid ${RED}33`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%' }}>
        <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: RED, flexShrink: 0 }} />
        <Text
          style={{
            fontFamily: MONO,
            fontSize: compact ? 10 : 11,
            letterSpacing: '0.14em',
            lineHeight: '14px',
            color: RED,
          }}
        >
          {tag ?? t('syncRefusal.tag')}
        </Text>
        <Box style={{ flex: 1, minWidth: 0 }} />
        <Text
          style={{
            fontFamily: MONO,
            fontSize: compact ? 10 : 11,
            lineHeight: '14px',
            color: MIST,
            flexShrink: 0,
          }}
        >
          {when(refusal.at)}
        </Text>
      </Box>

      <Stack gap={compact ? 4 : 6}>
        {!compact && (
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '19px', color: SNOW }}>
            {title ?? t('syncRefusal.title')}
          </Text>
        )}
        {/* Причина моноширинным: это дословный текст чужой программы, и в нём
            значимы кавычки, скобки и имя поля.

            В списке она обрезается тремя строками. Ядро отвечает и без цепочки
            «>», и тогда правило хвоста отдаёт весь абзац: живой отказ «Cascade
            topology is broken...» это 292 символа, одиннадцать строк, и
            карточка уезжала вниз, утаскивая метрики за край экрана. Три строки
            говорят, что случилось; остальное за раскрытием, оно рядом. */}
        <Text
          style={{
            fontFamily: MONO,
            fontSize: compact ? 11 : 12,
            lineHeight: compact ? '16px' : '18px',
            color: SNOW,
            wordBreak: 'break-word',
            ...(compact && !open
              ? {
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical' as const,
                  WebkitLineClamp: 3,
                  overflow: 'hidden',
                }
              : {}),
          }}
        >
          {refusal.reason}
        </Text>

        <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UnstyledButton type="button" onClick={() => setOpen((v) => !v)}>
            <Text
              style={{
                fontFamily: DISPLAY,
                fontSize: compact ? 11 : 12,
                lineHeight: '16px',
                color: MIST,
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              {open ? t('syncRefusal.hideFull') : t('syncRefusal.showFull')}
            </Text>
          </UnstyledButton>
        </Box>

        {open && (
          <Box
            style={{
              maxHeight: 260,
              overflow: 'auto',
              padding: '10px 12px',
              borderRadius: 8,
              backgroundColor: WELL,
              border: `1px solid ${RED}22`,
            }}
          >
            {/* `pre-wrap`: в ответе ядра есть свои переводы строк, и они несут
                структуру, которую склейка в абзац уничтожает. */}
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 11,
                lineHeight: '16px',
                color: MIST,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {refusal.full}
            </Text>
          </Box>
        )}

        {!compact && note !== null && (
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: MIST }}>
            {note ?? t('syncRefusal.selfClears')}
          </Text>
        )}
      </Stack>
    </Box>
  );
}

/** Время суток: отказ либо случился только что, либо висит с прошлой правки,
 *  и день с минутами отвечают на оба вопроса. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
