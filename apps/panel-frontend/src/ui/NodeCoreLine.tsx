import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Box, Text } from '@mantine/core';
import { nodeCoreFitText, type NodeCoreFit } from '@/lib/domain/nodeCoreFit';
import { AMBER, FAINT, RED } from '@/lib/ui/tokens';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const TONE = { amber: AMBER, red: RED, grey: FAINT } as const;

/**
 * The profile's core on one node, under the node's row: whether it is there
 * and which version it runs (nodeCoreFit). Where the fix is on the node (no
 * core, a refused version), a link to its "Cores" section, where the command
 * is: cores are managed at the node and only there.
 */
export function NodeCoreLine({ fit, nodeId, compact = false }: { fit: NodeCoreFit; nodeId: string; compact?: boolean }) {
  const { t } = useTranslation();
  const { tone, text, blockWhy } = nodeCoreFitText(fit, t);
  const color = TONE[tone];
  const link = fit.kind === 'missing' ? t('nodeCore.installLink') : fit.kind === 'refused' ? t('nodeCore.updateLink') : null;
  return (
    <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }} title={blockWhy ?? undefined}>
      <Box
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, flexShrink: 0, marginTop: compact ? 5 : 6 }}
      />
      <Text style={{ fontFamily: DISPLAY, fontSize: compact ? 11 : 12, lineHeight: compact ? '15px' : '17px', color }}>
        {text}
        {link && (
          <>
            {' · '}
            <Link
              to={`/nodes/${nodeId}#cores`}
              onClick={(e) => e.stopPropagation()}
              style={{ color, textDecoration: 'underline', textUnderlineOffset: 2 }}
            >
              {link}
            </Link>
          </>
        )}
      </Text>
    </Box>
  );
}
