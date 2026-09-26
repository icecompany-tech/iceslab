import { ActionSelect } from '@/contours/traffic/components/RoutePolicy/ActionSelect';
import { Box, Text, TextInput, UnstyledButton } from '@mantine/core';
import { CYAN, DIM, DISPLAY, EDGE, FAINT, HAIRLINE, MONO, RED, ROW, SHADOW_BG, SHADOW_INK, SHADOW_NOTE, SNOW, WELL } from '@/contours/traffic/lib/colors';
import { GripIcon, PlusIcon, TrashIcon } from '@/contours/traffic/components/RoutePolicy/icons';
import { IconAction } from '@/contours/traffic/components/RoutePolicy/IconAction';
import { splitMatch } from '@/contours/traffic/lib/routeRules';
import { useTranslation } from 'react-i18next';
import { Fragment, useState } from 'react';
import { unknownInMatch } from '@/lib/domain/routePolicies';
import { GeoTagHint } from '@/contours/traffic/components/GeoTagHint';
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
  unknownEntries,
}: Pick<RoutePolicyForm, 'shadows' | 'setRule' | 'addRule' | 'removeRule' | 'move' | 'rules' | 'dragging' | 'setDragging' | 'unknownEntries'>) {
  const { t } = useTranslation();
  // Какое поле правила в фокусе: подсказка тегов открыта только у него.
  const [focused, setFocused] = useState<string | null>(null);

  return (
    <>
      {/* The rules themselves */}
      {rules.map((rule, i) => {
        const shadowedBy = shadows.get(rule.id);
        // Записи этой строки, которые сервер не принял (ROUTE_POLICY_ENTRY_UNKNOWN).
        const bad = unknownInMatch(rule.match, unknownEntries);
        return (
          <Fragment key={rule.id}>
          <Box
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
              backgroundColor: shadowedBy ? SHADOW_BG : dragging === i ? ROW : 'transparent',
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

            {/* Поле и подсказка тегов гео-набора под ним (Ф9.5). */}
            <Box className="routes-rule-match" style={{ position: 'relative' }}>
              <TextInput
                value={rule.match.join(' ')}
                placeholder={t('routes.matchPlaceholder')}
                onChange={(e) => setRule(i, { match: splitMatch(e.currentTarget.value) })}
                onFocus={() => setFocused(rule.id)}
                onBlur={() => setFocused((f) => (f === rule.id ? null : f))}
                styles={{
                  input: {
                    fontFamily: MONO,
                    fontSize: 12,
                    height: 32,
                    minHeight: 32,
                    borderRadius: 7,
                    paddingInline: 10,
                    backgroundColor: WELL,
                    borderColor: bad.length > 0 ? RED : EDGE,
                    color: shadowedBy ? SHADOW_INK : SNOW,
                    textDecoration: shadowedBy ? 'line-through' : undefined,
                  },
                }}
              />
              <GeoTagHint
                line={rule.match.join(' ')}
                open={focused === rule.id}
                onPick={(line) => setRule(i, { match: splitMatch(line) })}
              />
            </Box>

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
          {bad.length > 0 && (
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: RED, padding: '0 20px 10px 62px' }}>
              {t('routes.entryUnknownRow', { entries: bad.join(', ') })}
            </Text>
          )}
          </Fragment>
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
        {/* Что сервер принимает в поле правила (265e93e): имя или адрес. */}
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT, marginTop: 8, marginLeft: 36 }}>
          {t('routes.entryGrammar')}
        </Text>
      </Box>
    </>
  );
}
