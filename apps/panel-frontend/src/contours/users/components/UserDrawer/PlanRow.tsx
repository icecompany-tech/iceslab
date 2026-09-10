import { EXPIRY_SPANS, expiryDate, formatExpiryDate, spanOfDays } from '@/contours/users/lib/userExpiry';
import { IconChevronDown } from '@tabler/icons-react';
import { Box, Menu, Text, UnstyledButton } from '@mantine/core';
import { CARD, CYAN, DIM_TEXT, DISPLAY, FIELD_EDGE, HAIRLINE, MIST, MONO, SNOW, WELL } from '@/contours/users/lib/colors';
import { STRATEGY_VALUES } from '@/contours/users/lib/userForm';
import { expireRelative } from '@/contours/users/lib/userFormat';
import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';
import type { UserForm } from '@/contours/users/components/UserDrawer/useUserForm';

/**
 * The one control shape both halves of the row wear.
 *
 * Quieter than the username field above it: that one is SUNK inside
 * BORDER_INPUT, this one a shade lighter inside a much darker edge. Reusing
 * the louder pair here, which is what the first cut did, made the plan row
 * compete with the one field that is actually required.
 */
const CONTROL = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 38,
  padding: '0 12px',
  borderRadius: 8,
  backgroundColor: WELL,
  border: `1px solid ${FIELD_EDGE}`,
};

/** Dimmer and wider-tracked than a section label elsewhere in the form. */
const PLAN_LABEL = {
  fontFamily: MONO,
  fontSize: 10,
  lineHeight: '12px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
  color: DIM_TEXT,
};

const DROPDOWN = {
  backgroundColor: CARD,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: 10,
  padding: 5,
  boxShadow: '0 20px 48px #000000A6',
};

/**
 * What the person is buying: how much traffic, and until when. Both used to
 * live inside Advanced, which put the two numbers an operator changes on every
 * single account behind a disclosure they had to open every single time.
 */
export function PlanRow({
  form,
  now,
  expiresAt,
  setExpiry,
  trafficRef,
}: Pick<UserForm, 'form' | 'now' | 'expiresAt' | 'setExpiry'> & {
  trafficRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();

  const gb = form.values.trafficLimitGb;
  const shown = gb === '' ? '' : String(gb);
  // The number keeps its own width so the unit sits against it, the way it
  // reads on paper, instead of drifting to the far edge of the control.
  const numberWidth = `${Math.max(2, shown.length || 1)}ch`;

  const chosen = form.values.expirySet ? spanOfDays(form.values.expireDays, now) : null;
  const expiryLabel = form.values.expirySet
    ? chosen
      ? t(`userDrawer.expiry.${chosen}`)
      : t('userDrawer.expiryDays', { count: Number(form.values.expireDays) })
    : expiresAt
      ? formatExpiryDate(expiresAt)
      : t('userDrawer.expiry.never');
  // No date, no aside: "no expiry / never ends" says one thing twice and steals
  // the width the label needs. An untouched edit shows how far off the stored
  // date is, and a date already behind us says so rather than reading "in 0
  // days", which is what an expired account looked like.
  const daysLeft = expiresAt
    ? Math.round((expiresAt.getTime() - now.getTime()) / 86_400_000)
    : null;
  const expiryAside = !expiresAt
    ? null
    : form.values.expirySet
      ? formatExpiryDate(expiresAt)
      : daysLeft! > 0
        ? t('userDrawer.inDays', { count: daysLeft! })
        : expireRelative(expiresAt.toISOString(), t).text;

  return (
    <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Box style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Text style={PLAN_LABEL}>{t('userDrawer.traffic')}</Text>
          <Box style={CONTROL}>
            <input
              ref={trafficRef}
              inputMode="numeric"
              value={shown}
              placeholder="∞"
              onChange={(e) => {
                const raw = e.currentTarget.value.replace(/\D/g, '');
                form.setFieldValue('trafficLimitGb', raw === '' ? '' : Number(raw));
              }}
              style={{
                width: numberWidth,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: SNOW,
                fontFamily: MONO,
                fontSize: 13,
                lineHeight: '16px',
                padding: 0,
              }}
            />
            <Text style={{ fontFamily: MONO, fontSize: 13, lineHeight: '16px', color: MIST }}>
              {t('userDrawer.trafficUnit')}
            </Text>
            <Box style={{ flex: 1 }} />
            <Menu position="bottom-end" width={200} styles={{ dropdown: DROPDOWN }}>
              <Menu.Target>
                <UnstyledButton
                  style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
                >
                  <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '14px', color: MIST }}>
                    {t(`users.strategyShort.${form.values.trafficLimitStrategy}`)}
                  </Text>
                  <IconChevronDown size={12} stroke={2} color={DIM_TEXT} />
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                {STRATEGY_VALUES.map((v) => (
                  <MenuRow
                    key={v}
                    label={t(`users.strategyShort.${v}`)}
                    active={form.values.trafficLimitStrategy === v}
                    onClick={() => form.setFieldValue('trafficLimitStrategy', v)}
                  />
                ))}
              </Menu.Dropdown>
            </Menu>
          </Box>
        </Box>
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        <Box style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Text style={PLAN_LABEL}>{t('userDrawer.expires')}</Text>
          <Menu position="bottom-start" width="target" styles={{ dropdown: DROPDOWN }}>
            <Menu.Target>
              <UnstyledButton style={{ ...CONTROL, width: '100%' }}>
                <Text
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: MONO,
                    fontSize: 13,
                    lineHeight: '16px',
                    color: SNOW,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {expiryLabel}
                </Text>
                {expiryAside && (
                  <Text
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 11,
                      lineHeight: '14px',
                      color: DIM_TEXT,
                      flexShrink: 0,
                    }}
                  >
                    {expiryAside}
                  </Text>
                )}
                <IconChevronDown size={12} stroke={2} color={MIST} style={{ flexShrink: 0 }} />
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              {EXPIRY_SPANS.map((span) => {
                const at = expiryDate(span, now);
                return (
                  <MenuRow
                    key={span}
                    label={t(`userDrawer.expiry.${span}`)}
                    aside={at ? formatExpiryDate(at) : t('userDrawer.expiryNeverEnds')}
                    active={chosen === span}
                    onClick={() => setExpiry(span)}
                  />
                );
              })}
            </Menu.Dropdown>
          </Menu>
        </Box>
      </Box>
    </Box>
  );
}

function MenuRow({
  label,
  aside,
  active,
  onClick,
}: {
  label: string;
  aside?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Menu.Item
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 11px',
        borderRadius: 7,
        backgroundColor: active ? `${CYAN}14` : 'transparent',
        border: `1px solid ${active ? `${CYAN}33` : 'transparent'}`,
      }}
    >
      {/* Mantine wraps item children in a block label, so the two halves need
          their own flex row to sit on one line. */}
      <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: MONO,
            fontSize: 12,
            lineHeight: '16px',
            color: active ? CYAN : SNOW,
          }}
        >
          {label}
        </Text>
        {aside && (
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '14px', color: MIST }}>
            {aside}
          </Text>
        )}
      </Box>
    </Menu.Item>
  );
}
