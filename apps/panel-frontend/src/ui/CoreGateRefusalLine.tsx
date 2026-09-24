import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Box, Stack, Text } from '@mantine/core';
import type { CoreGateRefusal } from '@/lib/domain/nodeCoreFit';
import { CopyButton } from '@/ui/CopyButton';
import { AMBER, FAINT, GROUND, HAIRLINE, RED, SNOW } from '@/lib/ui/tokens';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/**
 * The server's core refusal (CORE_NOT_ON_NODE / CORE_VERSION_REFUSED), under
 * the node it names, the way refusedLinkPorts sits under its field: the fix is
 * on that node, so the answer stays where the operator is looking.
 *
 * No core: the server's own howToInstall line with a copy button, and when
 * the line could not be pinned, why (the script then installs its default).
 * A refused version: the manifest's reason and the way to the node's "Cores",
 * where the update line is.
 */
export function CoreGateRefusalLine({
  refusal,
  nodeId,
  arch,
}: {
  refusal: CoreGateRefusal;
  /** The node it names, found by name on this screen; null: no link. */
  nodeId: string | null;
  /** The node's reported arch, for the "no build for <arch>" sentence. */
  arch?: string;
}) {
  const { t } = useTranslation();
  const core = refusal.engine === 'singbox' ? 'sing-box' : refusal.engine;
  return (
    <Stack
      gap={8}
      style={{ padding: '10px 12px', borderRadius: 8, backgroundColor: `${RED}14`, border: `1px solid ${RED}40` }}
    >
      {refusal.kind === 'missing' ? (
        <>
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: RED, fontWeight: 500 }}>
            {t('nodeCore.gateMissing', { node: refusal.nodeName, core })}
          </Text>
          {refusal.command && (
            <Box
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '9px 11px',
                borderRadius: 8,
                backgroundColor: GROUND,
                border: `1px solid ${HAIRLINE}`,
              }}
            >
              <Text
                style={{ fontFamily: MONO, fontSize: 11, lineHeight: '16px', color: SNOW, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
              >
                {refusal.command}
              </Text>
              <CopyButton text={refusal.command} label={t('common.copy')} />
            </Box>
          )}
          {!refusal.pinned && (
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: AMBER }}>
              {t(`nodeCore.unpinnedInstall.${refusal.why ?? 'unpinned'}`, { arch: arch ?? '' })}
            </Text>
          )}
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: FAINT }}>
            {t('nodeCore.gateAfterInstall')}
          </Text>
        </>
      ) : (
        <>
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: RED, fontWeight: 500 }}>
            {t('nodeCore.gateRefused', { node: refusal.nodeName, core, version: refusal.version })}
            {nodeId && (
              <>
                {' '}
                <Link
                  to={`/nodes/${nodeId}#cores`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: RED, textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  {t('nodeCore.updateLink')}
                </Link>
              </>
            )}
          </Text>
          {refusal.reason && (
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: SNOW }}>{refusal.reason}</Text>
          )}
        </>
      )}
    </Stack>
  );
}
