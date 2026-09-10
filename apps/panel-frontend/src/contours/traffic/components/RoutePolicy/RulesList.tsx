import { ActionSelect } from '@/contours/traffic/components/RoutePolicy/ActionSelect';
import { Box, Text, TextInput, UnstyledButton } from '@mantine/core';
import { CYAN, DIM, DISPLAY, EDGE, FAINT, HAIRLINE, MONO, RAISED, SHADOW_BG, SHADOW_INK, SHADOW_NOTE, SNOW, WELL } from '@/contours/traffic/lib/colors';
import { GripIcon, PlusIcon, TrashIcon } from '@/contours/traffic/components/RoutePolicy/icons';
import { IconAction } from '@/contours/traffic/components/RoutePolicy/IconAction';
import { splitMatch } from '@/contours/traffic/lib/routeRules';
import { useTranslation } from 'react-i18next';
import type { RoutePolicyForm } from '@/contours/traffic/components/RoutePolicy/useRoutePolicyForm';

/**
 * The editable rules of a policy, in order: what each row matches, what it does
 * with the traffic, and whether an earlier row already swallowed it.
 *
 * This is where a rule grows: a new kind (ip, protocol) adds fields to a row,
 * a new destination adds an entry to the action list in lib/routeActions.
 */
export function RulesList({
  shadows,
  setRule,
  addRule,
  removeRule,
  move,
  rules,
  dragging,
  setDragging,
}: Pick<RoutePolicyForm, 'shadows' | 'setRule' | 'addRule' | 'removeRule' | 'move' | 'rules' | 'dragging' | 'setDragging'>) {
  const { t } = useTranslation();

  return (
    <>
      {/* The rules themselves */}
      {rules.map((rule, i) => {
        const shadowedBy = shadows.get(rule.id);
        return (
          <Box
            key={rule.id}
            className="routes-rule"
            onDragOver={(e) => {
              e.preventDefault();
              if (dragging !== null && dragging !== i) {
                move(dragging, i);
                setDragging(i);
              }
            }}
            style={{
              paddingBlock: 12,
              paddingInline: 20,
              borderTop: `1px solid ${HAIRLINE}`,
              backgroundColor: shadowedBy ? SHADOW_BG : dragging === i ? RAISED : 'transparent',
            }}
          >
            {/* Only the grip drags. A draggable row swallows clicks and text
                selection inside its own fields. */}
            <Box
              draggable
              onDragStart={() => setDragging(i)}
              onDragEnd={() => setDragging(null)}
              style={{
                width: 22,
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'center',
                cursor: 'grab',
              }}
              title={t('routes.dragHint')}
            >
              <GripIcon size={12} color={DIM} />
            </Box>

            <TextInput
              className="routes-rule-match"
              value={rule.match.join(' ')}
              placeholder={t('routes.matchPlaceholder')}
              onChange={(e) => setRule(i, { match: splitMatch(e.currentTarget.value) })}
              styles={{
                input: {
                  fontFamily: MONO,
                  fontSize: 12,
                  height: 32,
                  minHeight: 32,
                  borderRadius: 7,
                  paddingInline: 10,
                  backgroundColor: WELL,
                  borderColor: EDGE,
                  color: shadowedBy ? SHADOW_INK : SNOW,
                  textDecoration: shadowedBy ? 'line-through' : undefined,
                },
              }}
            />

            <ActionSelect
              value={rule.action}
              muted={Boolean(shadowedBy)}
              className="routes-rule-action"
              onChange={(a) => setRule(i, { action: a })}
            />

            {shadowedBy ? (
              <Text
                style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: SHADOW_NOTE, flex: 1, minWidth: 0 }}
              >
                {t('routes.shadowedBy', { match: shadowedBy })}
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
                    height: 32,
                    minHeight: 32,
                    borderRadius: 7,
                    paddingInline: 10,
                    backgroundColor: 'transparent',
                    borderColor: 'transparent',
                    color: FAINT,
                  },
                }}
              />
            )}

            <IconAction title={t('common.delete')} onClick={() => removeRule(i)}>
              <TrashIcon size={14} color={DIM} />
            </IconAction>
          </Box>
        );
      })}

      <Box style={{ padding: '12px 20px', borderTop: `1px solid ${HAIRLINE}` }}>
        <UnstyledButton
          type="button"
          onClick={addRule}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 32,
            paddingInline: 12,
            marginLeft: 36,
            borderRadius: 8,
            backgroundColor: WELL,
            border: `1px dashed ${EDGE}`,
          }}
        >
          <PlusIcon size={13} color={CYAN} />
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
            {t('routes.addRule')}
          </Text>
        </UnstyledButton>
      </Box>
    </>
  );
}
