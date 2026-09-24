import { useTranslation } from 'react-i18next';
import { Box, Select, Stack, Text, UnstyledButton } from '@mantine/core';
import { ENGINE_NAMES, type EngineName } from '@iceslab/shared';
import type { NodeProtocol } from '@/lib/domain/nodes';
import { engineAccent } from '@/lib/ui/protocolAccent';
import { PROTOCOL_OPTIONS } from '@/contours/nodes/lib/nodeProtocols';
import { FIELD } from '@/contours/nodes/lib/fieldStyles';
import {
  makePrimary,
  primaryProtocols,
  protocolForPrimary,
  toggleEngine,
} from '@/contours/nodes/lib/nodeCreateForm';
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
 * per engine, ticked or not, the first ticked is the primary and says so. The
 * primary's protocol is chosen under the chips, and only where it has a choice
 * (xray: xray or shadowsocks; sing-box: tuic, anytls or shadowtls). The old
 * protocol select and sing-box switch are what an older server gets instead.
 *
 * All the decisions are the pure functions of nodeCreateForm; this paints.
 */
export function EngineChips({
  engines,
  protocol,
  onChange,
  error,
}: {
  engines: EngineName[];
  protocol: NodeProtocol;
  onChange: (next: { engines: EngineName[]; protocol: NodeProtocol }) => void;
  /** The server's INVALID_ENGINES sentence, under the chips. */
  error?: string | null;
}) {
  const { t } = useTranslation();
  const primary = engines[0]!;
  const options = primaryProtocols(primary);
  const set = (next: EngineName[]) => onChange({ engines: next, protocol: protocolForPrimary(protocol, next[0]!) });

  return (
    <Stack gap={8}>
      <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 500, color: SNOW }}>{t('nodes.form.enginesTitle')}</Text>
      <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ENGINE_NAMES.map((e) => {
          const on = engines.includes(e);
          const isPrimary = e === primary;
          const accent = engineAccent(e);
          return (
            <Box
              key={e}
              style={{
                display: 'flex',
                alignItems: 'center',
                height: 32,
                borderRadius: 8,
                backgroundColor: on ? `${accent}14` : WELL,
                border: `1px solid ${on ? `${accent}66` : HAIRLINE}`,
                overflow: 'hidden',
              }}
            >
              <UnstyledButton
                type="button"
                aria-pressed={on}
                title={on && engines.length === 1 ? t('nodes.form.enginesLastOne') : undefined}
                onClick={() => set(toggleEngine(engines, e))}
                style={{ display: 'flex', alignItems: 'center', gap: 7, height: '100%', padding: '0 11px' }}
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
              {on &&
                (isPrimary ? (
                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: accent,
                      padding: '0 10px 0 2px',
                    }}
                  >
                    {t('nodes.form.enginesPrimary')}
                  </Text>
                ) : (
                  <UnstyledButton
                    type="button"
                    onClick={() => set(makePrimary(engines, e))}
                    title={t('nodes.form.enginesMakePrimaryHint')}
                    style={{
                      height: '100%',
                      padding: '0 10px',
                      borderLeft: `1px solid ${accent}33`,
                      fontFamily: MONO,
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: FAINT,
                    }}
                  >
                    {t('nodes.form.enginesMakePrimary')}
                  </UnstyledButton>
                ))}
            </Box>
          );
        })}
      </Box>

      {/* The primary's protocol: the install label of the node. Only where the
          engine has more than one; elsewhere it is the engine itself. */}
      {options.length > 1 && (
        <Select
          {...FIELD}
          style={{ maxWidth: 360 }}
          label={t('nodes.form.enginesProtocol', { engine: ENGINE_LABEL[primary] })}
          data={PROTOCOL_OPTIONS.filter((p) => options.includes(p.value))}
          value={protocol}
          allowDeselect={false}
          onChange={(v) => v && onChange({ engines, protocol: v as NodeProtocol })}
        />
      )}

      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
        {t('nodes.form.enginesHint')}
      </Text>
      {error && <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: RED }}>{error}</Text>}
    </Stack>
  );
}
