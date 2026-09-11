import { useTranslation } from 'react-i18next';
import { Box, Stack, Text } from '@mantine/core';
import type { HostFreshness } from '@/lib/domain/hosts';

/**
 * Who is still on the previous link.
 *
 * Editing a host rewrites what every subscriber's client is supposed to dial,
 * and a client that has not refetched keeps dialling the old one. Nothing
 * errors: those people simply stop connecting and find out on their own. This
 * card is the only place the panel says so before it happens.
 *
 * It counts PEOPLE. One person with four devices is one number here, because
 * the question is how many humans are affected, not how many configs exist.
 */

const CARD = '#0F1A28';
const WELL = '#0B1420';
const HAIRLINE = '#1C2A3D';
const TRACK = '#16202E';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const CURRENT = '#4E8FB8';
const STALE = '#E07A5F';
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

export function HostFreshnessCard({ data }: { data: HostFreshness | undefined }) {
  const { t } = useTranslation();
  if (!data) return null;

  const { current, stale, total, neverFetched, retentionDays } = data;
  // A host nobody is subscribed to has nothing to be stale about, and a bar
  // divided by zero is a bar that lies.
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <Stack
      gap={20}
      style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%' }}>
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: FAINT,
          }}
        >
          {t('hostEdit.freshTitle')}
        </Text>
        <Box style={{ flex: 1, minWidth: 0 }} />
        <Text style={{ fontSize: 13, lineHeight: '17px', color: MIST }}>
          {t('hostEdit.freshLead')}
        </Text>
      </Box>

      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          flexWrap: 'wrap',
          padding: 20,
          borderRadius: 10,
          backgroundColor: WELL,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Stack gap={6} style={{ width: 300, flexShrink: 0 }}>
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: FAINT,
            }}
          >
            {t('hostEdit.freshCurrentLabel')}
          </Text>
          <Box style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <Text style={{ fontSize: 34, fontWeight: 600, lineHeight: '40px', color: SNOW }}>
              {current.toLocaleString()}
            </Text>
            <Text style={{ fontSize: 13, lineHeight: '17px', color: MIST }}>
              {t('hostEdit.freshOfTotal', { total, pct })}
            </Text>
          </Box>
        </Stack>

        <Stack gap={9} style={{ flex: 1, minWidth: 260 }}>
          <Box
            style={{
              display: 'flex',
              height: 6,
              width: '100%',
              borderRadius: 3,
              backgroundColor: TRACK,
              overflow: 'clip',
            }}
          >
            <Box style={{ height: 6, width: `${pct}%`, backgroundColor: CURRENT }} />
            <Box style={{ height: 6, width: `${100 - pct}%`, backgroundColor: STALE }} />
          </Box>

          <Box style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: STALE, flexShrink: 0 }} />
            <Text style={{ fontSize: 13, lineHeight: '17px', color: STALE, flexShrink: 0 }}>
              {t('hostEdit.freshStale', { count: stale })}
            </Text>
            <Text style={{ fontSize: 12, lineHeight: '16px', color: FAINT, flex: 1, minWidth: 0 }}>
              {t('hostEdit.freshChanged', { at: when(data.configChangedAt) })}
            </Text>
          </Box>

          {/* Two different silences under one count, so they are named apart. */}
          {neverFetched > 0 && (
            <Text style={{ fontSize: 12, lineHeight: '16px', color: MIST }}>
              {t('hostEdit.freshNever', { count: neverFetched })}
            </Text>
          )}

          {/* How far the evidence reaches. Said out loud rather than baked in:
              a quiet subscriber older than the window is indistinguishable
              from one who never came, and the operator should know which
              question the number is actually answering. */}
          <Text style={{ fontSize: 11, lineHeight: '15px', color: FAINT }}>
            {t('hostEdit.freshRetention', { days: retentionDays })}
          </Text>
        </Stack>
      </Box>
    </Stack>
  );
}

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
