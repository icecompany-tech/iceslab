import { AMBER, CYAN, DEFAULT_EDGE, DIM, DISPLAY, FAINT, HAIRLINE, MIST, MONO, RED, SNOW, VIOLET, WELL } from '@/contours/traffic/lib/colors';
import { Action } from '@/contours/traffic/components/RoutePolicy/Action';
import { Chip } from '@/contours/traffic/components/RoutePolicy/Chip';
import { IconAction } from '@/contours/traffic/components/RoutePolicy/IconAction';
import { InfoIcon } from '@/contours/traffic/components/DevicePreset/icons';
import { NEW_PRESET_ID } from '@/contours/traffic/lib/devicePresets';
import { NoEntryIcon, TrashIcon } from '@/contours/traffic/components/RoutePolicy/icons';
import { RulesList } from '@/contours/traffic/components/DevicePreset/RulesList';
import { useDevicePresetForm } from '@/contours/traffic/components/DevicePreset/useDevicePresetForm';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, TextInput } from '@mantine/core';
import { ROUTING_PRESET_WRITES_LIVE, type RoutingPreset } from '@/lib/domain/routePolicies';

/**
 * The "on the device" editor: the rules written into the client's own config.
 *
 * Traffic has not left the phone yet, so the vocabulary is narrower than the
 * node's: past the tunnel, blocked, or into the tunnel. There is no WARP here,
 * that is a node egress.
 *
 * Built-in presets are read-only because they are compiled into the
 * subscription builder rather than stored; an operator's own preset is a normal
 * editable row once the API can hold one. See `RoutingPreset` in lib/api.
 */

export function DevicePresetEditor({
  preset,
  isDefault,
  dns,
  onSaved,
}: {
  preset: RoutingPreset;
  isDefault: boolean;
  /** Clean resolver the built-in split presets point local domains at. */
  dns?: string;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const {
    locked,
    dirty,
    shadows,
    saveMutation,
    setRule,
    addRule,
    removeRule,
    move,
    confirmDelete,
    name,
    setName,
    rules,
    dragging,
    setDragging,
  } = useDevicePresetForm(preset, onSaved);

  return (
    <Stack gap={0} className="routes-detail">
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingTop: 20,
          paddingBottom: 18,
          paddingInline: 24,
          width: '100%',
        }}
      >
        {locked ? (
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {name}
          </Text>
        ) : (
          <TextInput
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder={t('routes.presetNamePlaceholder')}
            style={{ width: 260, flexShrink: 0 }}
            styles={{
              input: {
                fontFamily: DISPLAY,
                fontSize: 17,
                fontWeight: 600,
                height: 32,
                minHeight: 32,
                paddingInline: 10,
                backgroundColor: 'transparent',
                borderColor: 'transparent',
                color: SNOW,
              },
            }}
          />
        )}
        {isDefault && <Chip tone={CYAN}>{t('routes.isDefault')}</Chip>}
        {locked && <Chip tone={MIST}>{t('routes.builtIn')}</Chip>}
        {dirty && <Chip tone={AMBER}>{t('routes.unsaved')}</Chip>}
        <Box style={{ flex: 1, minWidth: 0 }} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
          {t('routes.firstMatchWins')}
        </Text>
        {!locked && preset.id !== NEW_PRESET_ID && ROUTING_PRESET_WRITES_LIVE && (
          <IconAction title={t('common.delete')} onClick={confirmDelete}>
            <TrashIcon size={15} color={RED} />
          </IconAction>
        )}
        {!locked && (
          <Action
            disabled={!ROUTING_PRESET_WRITES_LIVE || !dirty || saveMutation.isPending}
            title={ROUTING_PRESET_WRITES_LIVE ? undefined : t('routes.writesDisabledPresets')}
            onClick={() => saveMutation.mutate()}
          >
            {t('common.save')}
          </Action>
        )}
      </Box>

      <RulesList locked={locked} shadows={shadows} setRule={setRule} addRule={addRule} removeRule={removeRule} move={move} rules={rules} dragging={dragging} setDragging={setDragging} />

      {/* The fallback. Always there, always the tunnel. */}
      <Box
        className="routes-rule"
        style={{
          paddingBlock: 16,
          paddingInline: 24,
          backgroundColor: WELL,
          borderTop: `1px solid ${HAIRLINE}`,
          borderLeft: `3px solid ${DEFAULT_EDGE}`,
        }}
      >
        <Box style={{ width: 22, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          <NoEntryIcon size={13} color={DIM} />
        </Box>
        <Text
          className="routes-rule-match"
          style={{
            fontFamily: DISPLAY,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: '16px',
            color: SNOW,
          }}
        >
          {t('routes.everythingElse')}
        </Text>
        {/* Flat like the read-only rules: this row can never be touched, in an
            editable preset either. */}
        <Box className="routes-rule-action" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Box style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: CYAN, flexShrink: 0 }} />
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '18px', color: SNOW }}>
            {t('routes.intoTunnel')}
          </Text>
        </Box>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, flex: 1, minWidth: 0 }}>
          {t('routes.intoTunnelNote')}
        </Text>
      </Box>

      {/* Not a rule: a property of the preset, so it sits under the table with
          its own label rather than reading as one more row. */}
      {dns && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            paddingBlock: 12,
            paddingInline: 24,
            borderTop: `1px solid ${HAIRLINE}`,
          }}
        >
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.12em',
              lineHeight: '12px',
              textTransform: 'uppercase',
              color: MIST,
              width: 120,
              flexShrink: 0,
            }}
          >
            {t('routes.extra')}
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: VIOLET }}>DNS</Text>
          <Text style={{ fontFamily: MONO, fontSize: 12, lineHeight: '16px', color: SNOW }}>{dns}</Text>
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT, flex: 1, minWidth: 0 }}>
            {t('routes.dnsNote')}
          </Text>
        </Box>
      )}

      <Box
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          paddingBlock: 12,
          paddingInline: 24,
          borderTop: `1px solid ${HAIRLINE}`,
          backgroundColor: locked ? undefined : `${AMBER}0A`,
        }}
      >
        <InfoIcon size={13} color={locked ? FAINT : AMBER} />
        <Text
          style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: locked ? FAINT : AMBER, flex: 1 }}
        >
          {locked ? t('routes.presetReadOnly') : t('routes.presetWritesNotLive')}
        </Text>
      </Box>
    </Stack>
  );
}

