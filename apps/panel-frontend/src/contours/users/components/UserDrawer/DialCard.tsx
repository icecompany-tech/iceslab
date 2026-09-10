import { IconCopy, IconList } from '@tabler/icons-react';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { CARD, CYAN, DIM_TEXT, DISPLAY, HAIRLINE, MIST, MONO, MOSS, SNOW, WELL } from '@/contours/users/lib/colors';
import { LABEL } from '@/contours/users/lib/userForm';
import { copyToClipboard } from '@/lib/ui/clipboard';
import { protocolLabel } from '@/lib/domain/protocols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserEndpoint } from '@/lib/domain/users';

/**
 * The lines this person can actually dial, one protocol at a time.
 *
 * The preview above answers "how much did I just hand out"; this answers "give
 * me the one line for the client that is on the phone right now". They are
 * different questions, which is why the subscription link and a single URI
 * both have a place here.
 */
export function DialCard({ endpoints }: { endpoints: UserEndpoint[] }) {
  const { t } = useTranslation();

  const protocols = useMemo(
    () => [...new Set(endpoints.map((e) => e.protocol))],
    [endpoints],
  );
  const [active, setActive] = useState<string | null>(null);
  const current = active && protocols.includes(active) ? active : (protocols[0] ?? null);
  const shown = endpoints.filter((e) => e.protocol === current);

  if (endpoints.length === 0) return null;

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconList size={13} stroke={1.7} color={CYAN} />
        <Text style={{ ...LABEL, letterSpacing: '0.14em' }}>{t('userDrawer.dialTitle')}</Text>
        <Box style={{ flex: 1 }} />
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM_TEXT }}>
          {t('userDrawer.configs', { count: endpoints.length })}
        </Text>
      </Box>

      <Box style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {protocols.map((p) => {
          const on = p === current;
          return (
            <UnstyledButton
              key={p}
              onClick={() => setActive(p)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 24,
                paddingInline: 12,
                borderRadius: 6,
                backgroundColor: on ? `${CYAN}24` : WELL,
                border: `1px solid ${on ? `${CYAN}55` : HAIRLINE}`,
              }}
            >
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: on ? CYAN : MIST,
                }}
              >
                {protocolLabel(p as never)}
              </Text>
            </UnstyledButton>
          );
        })}
      </Box>

      {shown.map((e, i) => (
        <Box
          key={`${e.nodeId}-${e.port}-${i}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 10px',
            borderRadius: 6,
            backgroundColor: WELL,
          }}
        >
          <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: MOSS, flexShrink: 0 }} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: DISPLAY,
              fontSize: 12,
              color: SNOW,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {e.label}
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 10, color: MIST, flexShrink: 0 }}>
            {e.port}
          </Text>
          <UnstyledButton
            onClick={() => copyToClipboard(e.uri)}
            title={t('userDrawer.copyUri')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              height: 26,
              paddingInline: 8,
              borderRadius: 6,
              border: `1px solid ${HAIRLINE}`,
              color: MIST,
            }}
          >
            <IconCopy size={12} stroke={1.8} />
            <Text style={{ fontFamily: DISPLAY, fontSize: 11, color: MIST }}>
              {t('userDrawer.copy')}
            </Text>
          </UnstyledButton>
        </Box>
      ))}

      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: DIM_TEXT }}>
        {t('userDrawer.dialHint', { configs: endpoints.length, nodes: new Set(endpoints.map((e) => e.nodeId)).size })}
      </Text>
    </Box>
  );
}
