import { Box, Collapse, Text, UnstyledButton } from '@mantine/core';
import { CheckCircle } from '@/contours/nodes/components/NodeCreate/CheckCircle';
import { Chip } from '@/contours/nodes/components/NodeCreate/Chip';
import { DISPLAY, FAINT, HAIRLINE, MIST, MONO, SNOW, WELL } from '@/contours/nodes/lib/colors';
export function HostGroup({
  accent,
  chip,
  chipColor,
  hint,
  count,
  open,
  onToggleOpen,
  allChecked,
  onToggleAll,
  children,
}: {
  accent: string;
  chip: string;
  chipColor: string;
  hint: string;
  count: string;
  open: boolean;
  onToggleOpen: () => void;
  allChecked?: boolean;
  onToggleAll?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Box
      style={{
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${accent}`,
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', width: '100%' }}>
        <UnstyledButton type="button" onClick={onToggleOpen} style={{ display: 'flex', flexShrink: 0 }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 120ms' }}
          >
            <path
              d="M6 9l6 6l6 -6"
              fill="none"
              stroke={MIST}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </UnstyledButton>
        <Chip color={chipColor}>{chip}</Chip>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT, flex: 1, minWidth: 0 }}>
          {hint}
        </Text>
        <Chip edge>{count}</Chip>
        <CheckCircle checked={!!allChecked} onClick={onToggleAll} />
      </Box>
      <Collapse in={open}>{children}</Collapse>
    </Box>
  );
}

/** One host row. Selected rows lift to the raised well so the eye can count. */
export function HostRow({
  selectable,
  checked,
  onClick,
  name,
  meta,
  trailing,
}: {
  selectable?: boolean;
  checked: boolean;
  onClick?: () => void;
  name: string;
  meta: string;
  trailing?: React.ReactNode;
}) {
  return (
    <Box
      onClick={selectable ? onClick : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 14px 11px 38px',
        borderTop: `1px solid ${HAIRLINE}`,
        backgroundColor: checked ? '#152233' : 'transparent',
        cursor: selectable ? 'pointer' : 'default',
        width: '100%',
      }}
    >
      <CheckCircle checked={checked} />
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '16px',
          color: checked ? SNOW : MIST,
          flex: 1,
          minWidth: 0,
        }}
      >
        {name}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: checked ? MIST : FAINT }}>{meta}</Text>
      {trailing}
    </Box>
  );
}

/** 14px ring that fills with a cyan tick when on. */
