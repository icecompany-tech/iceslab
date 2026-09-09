import type { ReactNode } from 'react';
import { Badge } from '@mantine/core';

// Canonical selectable filter / toggle / view-switch chip for the dark theme.
//
// Why this exists: Mantine's `variant="filled"` selected state renders a bright
// solid accent block that "glows" on the dark page and sinks the label contrast
// (hard to read which one is active). The readable pattern is the inverse: keep
// the chip transparent, and on select show a SUBTLE accent tint + an accent
// border + bright text. The accent lives in the border/tint, the label stays
// legible. Every filter/toggle chip should use this component so the look is
// consistent and we never reintroduce the glow.
//
// `accent` is the color used for the active border + tint (defaults to cyan).
// Pass a different accent to color-code a family (e.g. violet for cascade).

const HAIRLINE = '#1C2A3D';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';

export interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  accent?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  'aria-label'?: string;
}

export function FilterChip({
  active,
  onClick,
  children,
  accent = CYAN,
  size = 'lg',
  'aria-label': ariaLabel,
}: FilterChipProps) {
  return (
    <Badge
      component="button"
      type="button"
      size={size}
      aria-pressed={active}
      aria-label={ariaLabel}
      style={{
        cursor: 'pointer',
        textTransform: 'none',
        fontWeight: active ? 600 : 500,
        backgroundColor: active ? `${accent}1F` : 'transparent',
        color: active ? SNOW : MIST,
        border: `1px solid ${active ? accent : HAIRLINE}`,
      }}
      onClick={onClick}
    >
      {children}
    </Badge>
  );
}
