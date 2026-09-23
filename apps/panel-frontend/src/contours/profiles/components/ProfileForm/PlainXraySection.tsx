import { useTranslation } from 'react-i18next';
import { Box, Group, Stack, Text } from '@mantine/core';
import type { PlainSubprotocol } from '@/contours/profiles/lib/plainSubprotocol';
import { AMBER, CYAN, HAIRLINE, MIST, RED, SNOW, WELL } from '@/contours/profiles/lib/colors';

const DISPLAY =
  "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/**
 * The xray form for SOCKS5 and HTTP. There is nothing to pick here: no TLS,
 * REALITY or transport (the server refuses them for these two), no auth
 * choice (always the users' own accounts), and the port belongs to the
 * binding, not the profile. What is left is saying so, once, in lines an
 * operator reads before deploying a proxy with no obfuscation.
 */
export function PlainXraySection({ subprotocol }: { subprotocol: PlainSubprotocol }) {
  const { t } = useTranslation();
  const p = (k: string) => t(`profiles.form.plain.${k}`);

  return (
    <Stack gap={12}>
      <Group gap={10} wrap="nowrap">
        <Text style={{ fontFamily: MONO, fontSize: 12, color: SNOW }}>
          {subprotocol === 'socks' ? 'SOCKS5' : 'HTTP'}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: MIST }}>{p('onXray')}</Text>
      </Group>

      <Line tone={CYAN}>{p('fixed')}</Line>
      <Line tone={CYAN}>{p('auth')}</Line>
      {subprotocol === 'http' && <Line tone={CYAN}>{p('digest')}</Line>}
      <Line tone={CYAN}>{p(subprotocol === 'socks' ? 'portSocks' : 'portHttp')}</Line>
      {subprotocol === 'socks' && <Line tone={MIST}>{p('udp')}</Line>}
      {subprotocol === 'http' && <Line tone={AMBER}>{p('httpClients')}</Line>}
      <Line tone={RED}>{p('noObfs')}</Line>
    </Stack>
  );
}

function Line({ tone, children }: { tone: string; children: string }) {
  return (
    <Group
      gap={10}
      align="flex-start"
      wrap="nowrap"
      style={{ padding: '10px 12px', borderRadius: 8, backgroundColor: WELL, border: `1px solid ${HAIRLINE}` }}
    >
      <Box style={{ width: 5, height: 5, marginTop: 6, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: SNOW, minWidth: 0 }}>
        {children}
      </Text>
    </Group>
  );
}
