import { Box, Text } from '@mantine/core';
import { AMBER, DIM_TEXT, DISPLAY, MONO, SNOW } from '@/contours/users/lib/colors';
import { useTranslation } from 'react-i18next';

/**
 * Why this person ends up on the routing they end up on.
 *
 * Four tiers decide it and the winner is whichever speaks first: the query in
 * the subscription URL, then this user, then their squads, then the panel.
 * The chain is the answer to the support question "I set ru-split and they
 * still get everything through the tunnel", so it is written out rather than
 * left to be reconstructed from three screens.
 *
 * Mirrors the precedence pinned by `subscription.routing.test.ts`.
 */
export function RoutingPrecedence({
  userPreset,
  squads,
  clash,
}: {
  /** The override on this account, when it carries one. */
  userPreset: string | null;
  /** What the member squads ask for, in words, or null when none do. */
  squads: string | null;
  /** True when the squads disagree and cancel each other out. */
  clash: boolean;
}) {
  const { t } = useTranslation();

  const rows: { n: number; tier: string; value: string; hot?: boolean }[] = [
    { n: 1, tier: t('userDrawer.tierQuery'), value: t('userDrawer.tierQueryHint') },
    {
      n: 2,
      tier: t('userDrawer.tierUser'),
      value: userPreset || t('userDrawer.tierNotSet'),
      hot: Boolean(userPreset),
    },
    {
      n: 3,
      tier: t('userDrawer.tierSquads'),
      value: squads ?? t('userDrawer.tierNotSet'),
      hot: clash,
    },
    // What the panel falls back to is a setting this screen cannot read; the
    // list endpoint does not carry it, so the tier is named without a value.
    { n: 4, tier: t('userDrawer.tierPanel'), value: t('userDrawer.tierPanelUnknown') },
  ];

  return (
    <Box style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((r) => (
        <Box
          key={r.n}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '7px 10px',
            borderRadius: 6,
            backgroundColor: r.hot ? `${AMBER}12` : undefined,
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 10, color: DIM_TEXT, flexShrink: 0, width: 12 }}>
            {r.n}
          </Text>
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 11,
              lineHeight: '15px',
              color: r.hot ? AMBER : DIM_TEXT,
              width: 86,
              flexShrink: 0,
            }}
          >
            {r.tier}
          </Text>
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: DISPLAY,
              fontSize: 11,
              lineHeight: '15px',
              color: r.hot ? SNOW : DIM_TEXT,
            }}
          >
            {r.value}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
