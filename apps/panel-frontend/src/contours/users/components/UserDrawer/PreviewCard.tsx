import { IconAlertTriangle, IconEye } from '@tabler/icons-react';
import type { TrafficLimitStrategy } from '@/lib/domain/users';
import { Box, Stack, Text } from '@mantine/core';
import { AMBER, CARD, CYAN, DIM, DISPLAY, HAIRLINE, MIST, MONO, MOSS, SNOW, WELL } from '@/contours/users/lib/colors';
import { Count, PreviewRow } from '@/contours/users/components/UserDrawer/PreviewRow';
import { LABEL } from '@/contours/users/lib/userForm';
import { ProtocolChip } from '@/contours/users/components/UserDrawer/ProtocolChip';
import { useTranslation } from 'react-i18next';
export interface PreviewRowData {
  key: string;
  /** What the client will show for this line. */
  title: string;
  protocol: string;
  /** Country for the estimate, port for the real thing. */
  note: string | null;
  online: boolean;
}

export interface PreviewData {
  rows: PreviewRowData[];
  configs: number;
  /** Distinct nodes behind those configs. */
  places: number;
  protocols: number;
  online: number;
  /** Guessed from bindings because the user has no id yet. */
  estimate: boolean;
}

/**
 * The answer to "what did I just build for this person". Derived, never
 * entered: for an existing user it is the subscription itself, for a draft it
 * is a guess that says so.
 */
export function PreviewCard({
  preview,
  trafficGb,
  strategy,
  expiresAt,
  expireDays,
  routingPreset,
  routingClash,
  routingSource,
  isEdit,
  onEditTraffic,
}: {
  preview: PreviewData;
  trafficGb: number | '';
  strategy: TrafficLimitStrategy;
  expiresAt: Date | null;
  expireDays: number | '';
  routingPreset: string;
  /** "basic asks for ru-split, premium asks for proxy-all", or null when the
   *  member squads agree. Read from the squads themselves, not from the
   *  subscription: what the panel hands out instead is not exposed here. */
  routingClash: string | null;
  /** Which squad decides the routing, when exactly one does. */
  routingSource: { preset: string; squad: string } | null;
  /** Only an existing account has fields worth jumping back to. */
  isEdit: boolean;
  onEditTraffic: () => void;
}) {
  const { t } = useTranslation();
  const shown = preview.rows.slice(0, 3);

  return (
    <Box
      style={{
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
        padding: 16,
      }}
    >
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconEye size={16} stroke={1.8} color={CYAN} />
          <Text style={{ ...LABEL, letterSpacing: '0.16em' }}>{t('userDrawer.previewTitle')}</Text>
        </Box>
        {preview.configs > 0 && (
          <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: MOSS }} />
            <Text style={{ fontFamily: MONO, fontSize: 10, color: MOSS }}>
              {preview.online}/{preview.configs} {t('userDrawer.online')}
            </Text>
          </Box>
        )}
      </Box>

      {/* Each label is pluralised on its own number: "1 конфиг" against
          "4 конфига" against "6 конфигов". */}
      <Box style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <Count
          value={preview.configs}
          label={t('userDrawer.configs', { count: preview.configs })}
        />
        <Text style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>·</Text>
        <Count value={preview.places} label={t('userDrawer.nodes', { count: preview.places })} />
        <Text style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>·</Text>
        <Count
          value={preview.protocols}
          label={t('userDrawer.protocols', { count: preview.protocols })}
        />
      </Box>

      <Stack gap={6}>
        {shown.length === 0 && (
          <Text style={{ fontSize: 12, color: MIST }}>{t('userDrawer.previewEmpty')}</Text>
        )}
        {shown.map((r) => (
          <Box
            key={r.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 10px',
              borderRadius: 6,
              backgroundColor: WELL,
            }}
          >
            <Box
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: r.online ? MOSS : MIST,
                flexShrink: 0,
              }}
            />
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: DISPLAY,
                fontSize: 12,
                color: SNOW,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.title}
            </Text>
            <ProtocolChip protocol={r.protocol} />
            {r.note && (
              <Text style={{ fontFamily: MONO, fontSize: 10, color: MIST }}>{r.note}</Text>
            )}
          </Box>
        ))}
        {preview.rows.length > shown.length && (
          <Text style={{ fontFamily: MONO, fontSize: 10, color: MIST }}>
            {t('userDrawer.andMore', { count: preview.rows.length - shown.length })}
          </Text>
        )}
        {/* A guess has to admit it. Presented as fact, this block was believed
            over the subscription it disagreed with. */}
        {preview.estimate && (
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: MIST }}>
            {t('userDrawer.previewEstimate')}
          </Text>
        )}
      </Stack>

      <Box style={{ height: 1, backgroundColor: HAIRLINE, margin: '14px 0 12px' }} />

      <Stack gap={8}>
        {/* The pencils are an edit affordance: while creating, the fields they
            point at are two rows away and already open. */}
        <PreviewRow
          label={t('userDrawer.traffic')}
          value={trafficGb === '' ? '∞' : `${trafficGb} GiB`}
          note={t(`userDrawer.resets.${strategy}`)}
          onEdit={isEdit ? onEditTraffic : undefined}
        />
        <PreviewRow
          label={t('userDrawer.expires')}
          value={
            expiresAt
              ? expiresAt.toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : '∞'
          }
          note={expireDays === '' ? undefined : t('userDrawer.inDays', { count: Number(expireDays) })}
          onEdit={isEdit ? onEditTraffic : undefined}
        />
        {/* The format is decided per client by the delivery rules, so the panel
            cannot name one here from the account alone. Drawn as a row with no
            value rather than guessed: the effective format is a backend field
            that does not exist yet. */}
        <PreviewRow
          label={t('userDrawer.format')}
          value="-"
          note={t('userDrawer.formatFromRules')}
        />
        {/* Naming the squad turns "inherits" from a shrug into an address. */}
        <PreviewRow
          label={t('userDrawer.routing')}
          value={routingPreset || routingSource?.preset || t('userDrawer.inheritsSquad')}
          note={
            routingClash
              ? t('userDrawer.routingClashChip')
              : routingSource
                ? t('userDrawer.routingFromSquad', { squad: routingSource.squad })
                : undefined
          }
        />
      </Stack>

      {routingClash && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            marginTop: 12,
            padding: '12px 14px',
            borderRadius: 8,
            backgroundColor: `${AMBER}12`,
            border: `1px solid ${AMBER}33`,
          }}
        >
          <IconAlertTriangle size={14} stroke={2} color={AMBER} style={{ flexShrink: 0, marginTop: 1 }} />
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 600, lineHeight: '16px', color: AMBER }}>
              {t('userDrawer.routingClashTitle')}
            </Text>
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: MIST }}>
              {t('userDrawer.routingClashBody', { pairs: routingClash })}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
