import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Box, Loader, Stack, Text, UnstyledButton } from '@mantine/core';
import { getInsights, type Insights } from '../lib/api';

/**
 * Two questions the panel can answer from data it already stores: who is
 * fetching the subscription and with what, and how many physical devices sit
 * behind each account.
 *
 * Nothing here is a live poll. The endpoint aggregates on demand, which is why
 * the window picker sits in the bar rather than a refresh button.
 */

const HAIRLINE = '#1C2A3D';
const EDGE = '#2C3A4E';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const VIOLET = '#A78BFA';

const DISPLAY = "'Space Grotesk Variable', 'Space Grotesk', 'Inter Variable', Inter, sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

const WINDOWS = [7, 30, 90];

export function InsightsPage() {
  const { t } = useTranslation();
  const [days, setDays] = useState(7);

  const { data, isLoading } = useQuery<Insights>({
    queryKey: ['insights', days],
    queryFn: () => getInsights(days),
    staleTime: 60_000,
  });

  return (
    <Stack gap={20}>
      {/* Page bar */}
      <Box className="page-bar">
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 16, flexShrink: 0 }}>
          <Box
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: `${CYAN}1A`,
              border: `1px solid ${CYAN}33`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ChartIcon size={18} color={CYAN} />
          </Box>
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {t('insights.title')}
          </Text>
        </Box>

        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box className="page-bar-facts">
          <Text
            className="page-bar-fact-soft"
            style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}
          >
            {t('insights.subtitle')}
          </Text>
          <Box style={{ flex: 1, minWidth: 0 }} />
        </Box>

        <Box className="page-bar-actions">
          {/* The window is the only control on this page, so it is the bar. */}
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: 3,
              borderRadius: 9,
              backgroundColor: WELL,
              border: `1px solid ${HAIRLINE}`,
              flexShrink: 0,
            }}
          >
            {WINDOWS.map((d) => {
              const active = d === days;
              return (
                <UnstyledButton
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 30,
                    paddingInline: 14,
                    borderRadius: 7,
                    backgroundColor: active ? CARD : 'transparent',
                    border: `1px solid ${active ? EDGE : 'transparent'}`,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      lineHeight: '14px',
                      color: active ? SNOW : MIST,
                    }}
                  >
                    {t('insights.window', { days: d })}
                  </Text>
                </UnstyledButton>
              );
            })}
          </Box>
        </Box>
      </Box>

      {isLoading || !data ? (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 240,
            borderRadius: 10,
            backgroundColor: CARD,
            border: `1px solid ${HAIRLINE}`,
          }}
        >
          <Loader color={CYAN} />
        </Box>
      ) : (
        <Box className="insights-columns">
          <RequestsCard data={data} days={days} />
          <DevicesCard data={data} />
        </Box>
      )}
    </Stack>
  );
}

/* ───── Subscription requests ───────────────────────────────────────────── */

function RequestsCard({ data, days }: { data: Insights; days: number }) {
  const { t } = useTranslation();
  const { total, uniqueUsers, byClient, byHourUtc } = data.subRequests;
  // How hard one account polls: the number that separates a normal client from
  // a script. Undefined rather than Infinity when nobody fetched at all.
  const perUserPerDay = uniqueUsers > 0 ? total / uniqueUsers / days : null;
  const top = byClient[0]?.count ?? 1;

  return (
    <Stack
      gap={18}
      style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
    >
      <CardHead
        tone={CYAN}
        icon={<BroadcastIcon size={16} color={CYAN} />}
        title={t('insights.requestsTitle')}
        hint={t('insights.requestsHint')}
      />

      <Box style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
        <Stat value={total.toLocaleString()} label={t('insights.statRequests')} accent={CYAN} />
        <Stat value={uniqueUsers.toLocaleString()} label={t('insights.statUsers')} />
        <Stat
          value={perUserPerDay === null ? '-' : perUserPerDay.toFixed(1)}
          label={t('insights.statPerUserDay')}
        />
      </Box>

      {total === 0 ? (
        <Empty>{t('insights.noRequests')}</Empty>
      ) : (
        <>
          <Stack gap={10}>
            <Caption icon={<MonitorIcon size={13} color={MIST} />}>{t('insights.byClient')}</Caption>
            {byClient.slice(0, 8).map((c) => (
              <Bar
                key={c.client}
                label={c.client}
                value={c.count.toLocaleString()}
                frac={c.count / top}
                tone={CYAN}
              />
            ))}
          </Stack>

          <Stack gap={10}>
            <Caption icon={<ClockIcon size={13} color={MIST} />}>{t('insights.byHour')}</Caption>
            <HourHistogram data={byHourUtc} />
          </Stack>
        </>
      )}
    </Stack>
  );
}

/* ───── Devices ─────────────────────────────────────────────────────────── */

function DevicesCard({ data }: { data: Insights }) {
  const { t } = useTranslation();
  const { totalDevices, usersWithDevices, avgDevicesPerUser, distribution, atOrOverLimit } = data.hwid;
  const maxUsers = Math.max(1, ...distribution.map((d) => d.users));

  return (
    <Stack
      gap={18}
      style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
    >
      <CardHead
        tone={VIOLET}
        icon={<DevicesIcon size={16} color={VIOLET} />}
        title={t('insights.devicesTitle')}
        hint={t('insights.devicesHint')}
      />

      <Box className="insights-tiles">
        <Tile value={totalDevices.toLocaleString()} label={t('insights.statTracked')} accent={VIOLET} />
        <Tile value={usersWithDevices.toLocaleString()} label={t('insights.statWithDevices')} />
        <Tile value={avgDevicesPerUser.toFixed(2)} label={t('insights.statAvgDevices')} accent={MOSS} />
        <Tile
          value={atOrOverLimit.toLocaleString()}
          label={t('insights.statAtLimit')}
          accent={atOrOverLimit > 0 ? AMBER : SNOW}
          outline={atOrOverLimit > 0 ? AMBER : undefined}
        />
      </Box>

      {totalDevices === 0 ? (
        <Empty>{t('insights.noDevices')}</Empty>
      ) : (
        <Stack gap={10}>
          <Caption>{t('insights.perUser')}</Caption>
          {distribution.map((d, i) => (
            <Bar
              key={d.bucket}
              label={bucketLabel(d.bucket, t)}
              value={t('insights.usersCount', { count: d.users })}
              frac={d.users / maxUsers}
              // The top bucket is the folded tail: everyone with that many
              // devices or more, which is where sharing shows up.
              tone={i === distribution.length - 1 ? AMBER : VIOLET}
            />
          ))}
        </Stack>
      )}

      {atOrOverLimit > 0 && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 14px',
            width: '100%',
            borderRadius: 10,
            backgroundColor: `${AMBER}0D`,
            border: `1px solid ${AMBER}29`,
          }}
        >
          <WarnIcon size={14} color={AMBER} />
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: AMBER }}>
              {t('insights.atLimitWarn', { count: atOrOverLimit })}
            </Text>
            {/* No list, because there is no way to ask for one: the user list
                has no device-count filter, and the device endpoint answers per
                user. Saying so beats a button that opens 10 000 rows. */}
            <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
              {t('insights.atLimitNote')}
            </Text>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

/**
 * The buckets arrive as strings ("1" .. "4", "5+"), so the plural form is
 * chosen from the label rather than from a count. Russian needs three forms and
 * the tail bucket has no number at all, which is why i18next's `count` cannot
 * do this on its own.
 */
function bucketLabel(bucket: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (bucket === '1') return t('insights.bucketOne');
  if (/^[2-4]$/.test(bucket)) return t('insights.bucketFew', { bucket });
  return t('insights.bucket', { bucket });
}

/* ───── Pieces ──────────────────────────────────────────────────────────── */

function CardHead({
  tone,
  icon,
  title,
  hint,
}: {
  tone: string;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Box
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          backgroundColor: `${tone}1A`,
          border: `1px solid ${tone}33`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 600, lineHeight: '18px', color: SNOW }}>
          {title}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: MIST }}>{hint}</Text>
      </Stack>
    </Box>
  );
}

/** A bare number and its caption. */
function Stat({ value, label, accent = SNOW }: { value: string; label: string; accent?: string }) {
  return (
    <Stack gap={4} style={{ minWidth: 0 }}>
      <Text style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 500, lineHeight: '30px', color: accent }}>
        {value}
      </Text>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.12em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color: MIST,
        }}
      >
        {label}
      </Text>
    </Stack>
  );
}

/** The same number in a box, for the row where one of them needs to raise a
 *  flag and a bare number could not. */
function Tile({
  value,
  label,
  accent = SNOW,
  outline,
}: {
  value: string;
  label: string;
  accent?: string;
  outline?: string;
}) {
  return (
    <Stack
      gap={4}
      style={{
        padding: '12px 14px',
        flex: '1 1 0',
        minWidth: 0,
        borderRadius: 10,
        backgroundColor: outline ? `${outline}0D` : WELL,
        border: `1px solid ${outline ? `${outline}33` : HAIRLINE}`,
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 500, lineHeight: '26px', color: accent }}>
        {value}
      </Text>
      {/* Wraps rather than truncates: the Russian captions are half again as
          long as the English ones, and a clipped label says nothing. */}
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.1em',
          lineHeight: '13px',
          textTransform: 'uppercase',
          color: MIST,
        }}
      >
        {label}
      </Text>
    </Stack>
  );
}

function Caption({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {icon}
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
    </Box>
  );
}

/** Labelled bar. `frac` is relative to the biggest row, so the leader fills the
 *  track and the rest read as a share of it. */
function Bar({ label, value, frac, tone }: { label: string; value: string; frac: number; tone: string }) {
  return (
    <Stack gap={5}>
      <Box style={{ display: 'flex', alignItems: 'baseline', gap: 10, width: '100%' }}>
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 12,
            lineHeight: '16px',
            color: SNOW,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST, flexShrink: 0 }}>
          {value}
        </Text>
      </Box>
      <Box style={{ height: 5, borderRadius: 3, backgroundColor: HAIRLINE, overflow: 'hidden', width: '100%' }}>
        <Box
          style={{
            height: '100%',
            width: `${Math.max(1.5, frac * 100)}%`,
            backgroundColor: tone,
            borderRadius: 3,
          }}
        />
      </Box>
    </Stack>
  );
}

/** 24 columns, one per hour, height relative to the busiest. An empty hour
 *  keeps a hairline stub so the shape of the day stays readable. */
function HourHistogram({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <Box>
      <Box style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 84, width: '100%' }}>
        {data.map((v, h) => (
          <Box
            key={h}
            title={`${String(h).padStart(2, '0')}:00 UTC - ${v}`}
            style={{
              flex: 1,
              minWidth: 4,
              height: `${Math.max(3, (v / max) * 100)}%`,
              borderRadius: 2,
              backgroundColor: v === 0 ? HAIRLINE : CYAN,
            }}
          />
        ))}
      </Box>
      <Box style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7 }}>
        {['00', '06', '12', '18', '23'].map((h) => (
          <Text
            key={h}
            style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', lineHeight: '11px', color: DIM }}
          >
            {h}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <Box
      style={{
        padding: '18px 14px',
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        width: '100%',
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, textAlign: 'center' }}>
        {children}
      </Text>
    </Box>
  );
}

/* ───── Icons ───────────────────────────────────────────────────────────── */

function ChartIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M4 20h16" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M7 20v-7" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M12 20v-11" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M17 20v-5" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function BroadcastIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M5 6a1 1 0 0 1 1 -1c8.3 0 15 6.7 15 15a1 1 0 0 1 -1 1"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M5 12a1 1 0 0 1 1 -1a8 8 0 0 1 8 8a1 1 0 0 1 -1 1"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="6" cy="18" r="1.6" fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

function DevicesIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="3" y="5" width="12" height="9" rx="1.5" fill="none" stroke={color} strokeWidth="1.8" />
      <rect x="14" y="10" width="7" height="10" rx="1.5" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M7 17h4" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MonitorIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="12" rx="1.5" fill="none" stroke={color} strokeWidth="1.9" />
      <path d="M9 20h6" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M12 16v4" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="1.9" />
      <path
        d="M12 7v5l3 2"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarnIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 9v4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}
