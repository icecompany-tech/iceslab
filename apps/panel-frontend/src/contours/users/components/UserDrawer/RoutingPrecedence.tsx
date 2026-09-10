import { Box, Text } from '@mantine/core';
import { AMBER, DIM_TEXT, DISPLAY, HAIRLINE, MONO, SNOW } from '@/contours/users/lib/colors';
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

  // Whichever tier speaks first wins. Marking it is the whole point: the
  // operator wants the line that decided the outcome, not the list.
  const winner = userPreset ? 2 : squads && !clash ? 3 : 4;

  const rows = [
    { n: 1, tier: t('userDrawer.tierQuery'), value: t('userDrawer.tierQueryHint') },
    { n: 2, tier: t('userDrawer.tierUser'), value: userPreset || t('userDrawer.tierNotSet') },
    { n: 3, tier: t('userDrawer.tierSquads'), value: squads ?? t('userDrawer.tierNotSet') },
    // What the panel falls back to is a setting this screen cannot read: the
    // user response does not carry it, so the tier is named without a value.
    { n: 4, tier: t('userDrawer.tierPanel'), value: t('userDrawer.tierPanelUnknown') },
  ];

  return (
    <Box style={{ borderRadius: 8, border: `1px solid ${HAIRLINE}`, overflow: 'hidden' }}>
      {rows.map((r, i) => {
        const hot = clash && r.n === 3;
        const won = !hot && r.n === winner;
        return (
          <Box
            key={r.n}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '9px 12px',
              borderTop: i === 0 ? undefined : `1px solid ${HAIRLINE}`,
              backgroundColor: hot ? `${AMBER}12` : undefined,
              boxShadow: hot ? `inset 2px 0 0 ${AMBER}` : undefined,
            }}
          >
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 11,
                lineHeight: '15px',
                color: hot ? AMBER : DIM_TEXT,
                width: 96,
                flexShrink: 0,
              }}
            >
              {r.n} · {r.tier}
            </Text>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: DISPLAY,
                fontSize: 11,
                lineHeight: '15px',
                color: hot ? AMBER : won ? SNOW : DIM_TEXT,
              }}
            >
              {r.value}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
