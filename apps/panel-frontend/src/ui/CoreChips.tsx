import { useTranslation } from 'react-i18next';
import { Box, Text } from '@mantine/core';
import { coreChipText, type CoreChip } from '@/lib/domain/cascadeChips';
import { engineAccent } from '@/lib/ui/protocolAccent';
import { FAINT } from '@/lib/ui/tokens';

const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/**
 * The cores a cascade uses on a node, one chip each (cascadeNodeChips), for
 * the cascade card and the cascade editor alike, so the two cannot drift.
 *
 * One line and never more: the row wraps inside a one-chip-high box and what
 * does not fit is clipped, not pushed out of the card. The full list, with
 * «also on the node» for the cores the cascade does not use, rides the title.
 */
export function CoreChips({ shown, others }: { shown: CoreChip[]; others: CoreChip[] }) {
  const { t } = useTranslation();
  if (shown.length === 0) return null;
  const title = [
    shown.map(coreChipText).join(' · '),
    others.length > 0 ? t('cascades.coresAlso', { list: others.map(coreChipText).join(', ') }) : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <Box
      title={title}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        minWidth: 0,
        maxHeight: 22,
        overflow: 'hidden',
      }}
    >
      {shown.map((c) => {
        const accent = engineAccent(c.engine);
        return (
          <Text
            key={c.engine}
            style={{
              fontFamily: MONO,
              fontSize: 11,
              lineHeight: '20px',
              height: 22,
              padding: '0 8px',
              borderRadius: 6,
              color: accent,
              backgroundColor: `${accent}14`,
              border: `1px solid ${accent}33`,
              whiteSpace: 'nowrap',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {coreChipText(c)}
          </Text>
        );
      })}
      {others.length > 0 && (
        <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '22px', color: FAINT, whiteSpace: 'nowrap' }}>
          +{others.length}
        </Text>
      )}
    </Box>
  );
}
