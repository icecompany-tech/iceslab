import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { ENGINE_NAMES, type EngineName } from '@iceslab/shared';
import { engineAccent } from '@/lib/ui/protocolAccent';
import { toggleEngine, type NodeEnginesRefusal } from '@/contours/nodes/lib/nodeCreateForm';
import { DISPLAY, FAINT, HAIRLINE, MIST, MONO, RED, SNOW, WELL } from '@/contours/nodes/lib/colors';

const ENGINE_LABEL: Record<EngineName, string> = {
  xray: 'Xray',
  hysteria: 'Hysteria 2',
  singbox: 'sing-box',
  amneziawg: 'AmneziaWG',
  naive: 'NaiveProxy',
  mieru: 'Mieru',
  mtproto: 'MTProto',
};

/**
 * Which engines the node is set up to carry (intendedEngines, 64d7078): a chip
 * per engine, ticked or not. A set (owner's decision 25.09): no chip leads,
 * the order is not kept, and which protocol sing-box or xray serves is the
 * host's business at binding, not the node's. Every chip unticks: a node with
 * no core is the agent alone (owner, 25.09). The old protocol select and
 * sing-box switch are what an older server gets instead.
 *
 * The decision is the pure toggleEngine of nodeCreateForm; this paints.
 */
export function EngineChips({
  engines,
  onChange,
  error,
}: {
  engines: EngineName[];
  onChange: (next: EngineName[]) => void;
  /** The server's INVALID_ENGINES or LAST_CORE refusal, under the chips: its
   *  sentence, then the code and the field it names. */
  error?: NodeEnginesRefusal | null;
}) {
  const { t } = useTranslation();

  return (
    <Stack gap={8}>
      <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 500, color: SNOW }}>{t('nodes.form.enginesTitle')}</Text>
      <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ENGINE_NAMES.map((e) => {
          const on = engines.includes(e);
          const accent = engineAccent(e);
          return (
            <UnstyledButton
              key={e}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(toggleEngine(engines, e))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                height: 32,
                padding: '0 11px',
                borderRadius: 8,
                backgroundColor: on ? `${accent}14` : WELL,
                border: `1px solid ${on ? `${accent}66` : HAIRLINE}`,
              }}
            >
              <Box
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  border: `1px solid ${on ? accent : FAINT}`,
                  backgroundColor: on ? accent : 'transparent',
                }}
              />
              <Text style={{ fontFamily: MONO, fontSize: 12, color: on ? SNOW : MIST }}>{ENGINE_LABEL[e]}</Text>
            </UnstyledButton>
          );
        })}
      </Box>

      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
        {t('nodes.form.enginesHint')}
      </Text>
      {/* Пустой набор допустим (владелец, 25.09): это не ошибка, а нода с
          одним агентом, поэтому краска спокойная. */}
      {engines.length === 0 && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: MIST }}>
          {t('nodes.form.enginesNone')}
        </Text>
      )}
      {error && (
        <Stack gap={2}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: RED }}>
            {error.code === 'LAST_CORE' ? t('nodes.form.enginesLastCoreRefused') : t('nodes.form.enginesRefusedLine')}
            {error.message ? ` ${error.message}` : ''}
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '14px', color: FAINT }}>
            {error.code} · {error.field}
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
