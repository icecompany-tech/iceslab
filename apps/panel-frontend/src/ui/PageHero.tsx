import { Box, Text } from '@mantine/core';
import type { ReactNode } from 'react';

const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';

interface PageHeroProps {
  /** Mono uppercase eyebrow above headline; rendered with a leading cyan dot. */
  eyebrow: string;
  /** Big display headline, e.g. "Users." */
  title: string;
  /** Optional subhead paragraph in mist. */
  subtitle?: ReactNode;
  /** Optional right-aligned action area (button row / segmented control). */
  right?: ReactNode;
}

export function PageHero({ eyebrow, title, subtitle, right }: PageHeroProps) {
  return (
    <Box
      style={{
        display: 'flex',
        gap: 24,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 32,
      }}
    >
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: CYAN,
              boxShadow: `0 0 6px ${CYAN}99`,
            }}
          />
          <Text
            style={{
              fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: MIST,
            }}
          >
            {eyebrow}
          </Text>
        </Box>
        <Text
          style={{
            fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            fontSize: 64,
            fontWeight: 500,
            letterSpacing: '-0.025em',
            lineHeight: 1,
            color: SNOW,
            marginBottom: subtitle ? 16 : 0,
          }}
        >
          {title}
        </Text>
        {subtitle && (
          <Text
            style={{
              color: MIST,
              fontSize: 15,
              lineHeight: 1.55,
              maxWidth: 720,
            }}
          >
            {subtitle}
          </Text>
        )}
      </Box>
      {right && <Box style={{ flexShrink: 0 }}>{right}</Box>}
    </Box>
  );
}
