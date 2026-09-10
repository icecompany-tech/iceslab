import { ACTION_TONE, ACTION_W, DEVICE_ACTIONS } from '@/contours/traffic/lib/routeActions';
import { AMBER, DIM, DISPLAY, EDGE, FAINT, HAIRLINE, MIST, MONO, RAISED, RULE_EDGE, SHADOW_BG, SHADOW_INK, SHADOW_NOTE, SNOW, WARN_BG, WARN_EDGE, WELL } from '@/contours/traffic/lib/colors';
import { ActionSelect } from '@/contours/traffic/components/RoutePolicy/ActionSelect';
import { Box, Text, TextInput, UnstyledButton } from '@mantine/core';
import { ColHead } from '@/contours/traffic/components/RoutePolicy/ColHead';
import { GripIcon, PlusIcon, TrashIcon } from '@/contours/traffic/components/RoutePolicy/icons';
import { IconAction } from '@/contours/traffic/components/RoutePolicy/IconAction';
import { WarnIcon } from '@/contours/traffic/components/DevicePreset/icons';
import { splitMatch } from '@/contours/traffic/lib/routeRules';
import { useTranslation } from 'react-i18next';
import type { DevicePresetForm } from '@/contours/traffic/components/DevicePreset/useDevicePresetForm';

/**
 * The rules of a device preset, in order. A built-in preset renders the same
 * rows read-only, which is why the lock lives on the row and not on the list.
 *
 * Э3 grows a row here: a country split reads as one more match kind, and WARP
 * as a destination is one more entry in the device action list.
 */
export function RulesList({
  locked,
  shadows,
  setRule,
  addRule,
  removeRule,
  move,
  rules,
  dragging,
  setDragging,
}: Pick<DevicePresetForm, 'locked' | 'shadows' | 'setRule' | 'addRule' | 'removeRule' | 'move' | 'rules' | 'dragging' | 'setDragging'>) {
  const { t } = useTranslation();

  return (
    <>
      {/* The one thing to know before trusting this layer at all. The right end
          of this strip is where the reach belongs once Delivery can count users
          by resolved format ("5 812 получат · 992 на plain, не получат"): the
          number lands harder than the mechanic. It cannot be computed today,
          format resolution depends on the UA at fetch time. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          paddingBlock: 14,
          paddingInline: 24,
          backgroundColor: WARN_BG,
          borderTop: `1px solid ${WARN_EDGE}`,
          borderBottom: `1px solid ${WARN_EDGE}`,
        }}
      >
        <WarnIcon size={15} color={AMBER} />
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 12,
            fontWeight: 600,
            lineHeight: '16px',
            color: AMBER,
            width: 120,
            flexShrink: 0,
          }}
        >
          {t('routes.notEveryoneTitle')}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, flex: 1, minWidth: 0 }}>
          {t('routes.notEveryoneBody')}
        </Text>
      </Box>

      <Box
        className="routes-rule"
        style={{ paddingTop: 12, paddingBottom: 10, paddingInline: 24 }}
      >
        <Box style={{ width: 22, flexShrink: 0 }} />
        <ColHead className="routes-rule-match">{t('routes.colMatch')}</ColHead>
        <ColHead className="routes-rule-action">{t('routes.colDo')}</ColHead>
        <ColHead flex>{t('routes.colNote')}</ColHead>
      </Box>

      {rules.length === 0 && (
        <Box style={{ paddingBlock: 6, paddingInline: 24 }}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: MIST }}>
            {t('routes.presetNoRules')}
          </Text>
        </Box>
      )}

      {rules.map((rule, i) => {
        const shadowedBy = shadows.get(rule.id);
        return (
          <Box
            key={rule.id}
            className="routes-rule"
            onDragOver={(e) => {
              if (locked) return;
              e.preventDefault();
              if (dragging !== null && dragging !== i) {
                move(dragging, i);
                setDragging(i);
              }
            }}
            style={{
              // A read-only matcher wraps instead of truncating, so its row
              // aligns to the top rather than centring a two-line cell.
              alignItems: locked ? 'flex-start' : 'center',
              paddingBlock: locked ? 9 : 11,
              paddingInline: 24,
              borderLeft: `3px solid ${shadowedBy ? SHADOW_NOTE : RULE_EDGE}`,
              backgroundColor: shadowedBy ? SHADOW_BG : dragging === i ? RAISED : 'transparent',
            }}
          >
            {/* Only the grip drags. A draggable row swallows clicks and text
                selection inside its own fields. */}
            <Box
              draggable={!locked}
              onDragStart={() => setDragging(i)}
              onDragEnd={() => setDragging(null)}
              style={{
                width: 22,
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'center',
                cursor: locked ? 'default' : 'grab',
              }}
              title={locked ? undefined : t('routes.dragHint')}
            >
              <GripIcon size={12} color={DIM} />
            </Box>

            {/* Read-only rows are flat text on purpose: a bordered field next to
                the operator's own editable card reads as editable, and the hand
                reaches the field before the eye reaches the footnote. */}
            {locked ? (
              <Text
                className="routes-rule-match"
                style={{ fontFamily: MONO, fontSize: 12, lineHeight: '18px', color: SNOW }}
              >
                {rule.match.join(' · ')}
              </Text>
            ) : (
              <TextInput
                className="routes-rule-match"
                value={rule.match.join(' ')}
                placeholder={t('routes.matchPlaceholder')}
                onChange={(e) => setRule(i, { match: splitMatch(e.currentTarget.value) })}
                styles={{
                  input: {
                    fontFamily: MONO,
                    fontSize: 12,
                    height: 34,
                    minHeight: 34,
                    borderRadius: 6,
                    paddingInline: 10,
                    backgroundColor: WELL,
                    borderColor: HAIRLINE,
                    color: shadowedBy ? SHADOW_INK : SNOW,
                    textDecoration: shadowedBy ? 'line-through' : undefined,
                  },
                }}
              />
            )}

            {locked ? (
              <Box
                className="routes-rule-action"
                style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 18 }}
              >
                <Box
                  style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: ACTION_TONE[rule.action], flexShrink: 0 }}
                />
                <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '18px', color: SNOW }}>
                  {t(`routes.deviceAction.${rule.action}`)}
                </Text>
              </Box>
            ) : (
              <ActionSelect
                value={rule.action}
                muted={Boolean(shadowedBy)}
                choices={DEVICE_ACTIONS}
                labelKey="routes.deviceAction"
                width={ACTION_W}
                height={34}
                className="routes-rule-action"
                onChange={(a) => setRule(i, { action: a })}
              />
            )}

            {shadowedBy ? (
              <Text
                style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: SHADOW_NOTE, flex: 1, minWidth: 0 }}
              >
                {t('routes.shadowedBy', { match: shadowedBy })}
              </Text>
            ) : locked ? (
              <Text
                style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '18px', color: FAINT, flex: 1, minWidth: 0 }}
              >
                {rule.note}
              </Text>
            ) : (
              <TextInput
                style={{ flex: 1, minWidth: 0 }}
                value={rule.note}
                placeholder={t('routes.notePlaceholder')}
                onChange={(e) => setRule(i, { note: e.currentTarget.value })}
                styles={{
                  input: {
                    fontFamily: DISPLAY,
                    fontSize: 12,
                    height: 34,
                    minHeight: 34,
                    borderRadius: 6,
                    paddingInline: 10,
                    backgroundColor: 'transparent',
                    borderColor: 'transparent',
                    color: FAINT,
                  },
                }}
              />
            )}

            {!locked && (
              <IconAction title={t('common.delete')} onClick={() => removeRule(i)}>
                <TrashIcon size={14} color={DIM} />
              </IconAction>
            )}
          </Box>
        );
      })}

      {!locked && (
        <Box style={{ paddingTop: 14, paddingBottom: 18, paddingInline: 24 }}>
          <UnstyledButton
            type="button"
            onClick={addRule}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              paddingBlock: 8,
              paddingInline: 14,
              borderRadius: 6,
              border: `1px dashed ${EDGE}`,
            }}
          >
            <PlusIcon size={10} color={MIST} />
            <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '16px', color: MIST }}>
              {t('routes.addRule')}
            </Text>
          </UnstyledButton>
        </Box>
      )}
    </>
  );
}
