import { Box, Text, UnstyledButton } from '@mantine/core';
import { useTranslation } from 'react-i18next';

const CARD = '#0F1A28';
const HAIRLINE = '#1C2A3D';
const BORDER_INPUT = '#2C3A4E';
const CYAN = '#7DD3FC';
const MIST = '#7A8BA3';
const SNOW = '#C8D4E3';
const DISPLAY =
  "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * The library before anything is in it.
 *
 * Deliberately not the roster's empty state: a profile is not an account
 * waiting to be typed in, it is a protocol with a dozen fields that decide
 * whether a connection survives DPI. So the card says what a profile is, and
 * offers the safe road first: a recipe fills the fields that are easy to get
 * wrong. A blank profile stays available for someone who knows what they want.
 *
 * The dashed edge is the difference between "nothing here yet" and "something
 * failed to load", which a solid card cannot make.
 */
export function ProfilesEmpty({
  onRecipe,
  onBlank,
}: {
  onRecipe: () => void;
  onBlank: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '72px 40px',
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px dashed ${HAIRLINE}`,
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 500, lineHeight: '24px', color: SNOW }}>
        {t('profiles.emptyTitle')}
      </Text>

      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          lineHeight: '19px',
          color: MIST,
          maxWidth: 480,
          textAlign: 'center',
        }}
      >
        {t('profiles.emptyBody')}
      </Text>

      <Box style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
        <UnstyledButton
          onClick={onRecipe}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 34,
            paddingInline: 15,
            borderRadius: 8,
            backgroundColor: `${CYAN}14`,
            border: `1px solid ${CYAN}33`,
          }}
        >
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, color: CYAN }}>
            {t('profiles.emptyFromRecipe')}
          </Text>
        </UnstyledButton>

        <UnstyledButton
          onClick={onBlank}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 34,
            paddingInline: 15,
            borderRadius: 8,
            border: `1px solid ${BORDER_INPUT}`,
          }}
        >
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, color: MIST }}>
            {t('profiles.emptyBlank')}
          </Text>
        </UnstyledButton>
      </Box>
    </Box>
  );
}
