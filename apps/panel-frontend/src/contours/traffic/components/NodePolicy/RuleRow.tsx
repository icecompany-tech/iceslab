import { useTranslation } from 'react-i18next';
import { Box, Menu, Text, TextInput, UnstyledButton } from '@mantine/core';
import type { PolicyActionKind, PolicyRule } from '@/lib/domain/nodePolicies';
import {
  CYAN,
  DISPLAY,
  EDGE,
  FAINT,
  HAIRLINE,
  MIST,
  MONO,
  SHADOW_BG,
  SHADOW_INK,
  SHADOW_NOTE,
  SNOW,
  WELL,
} from '@/contours/traffic/lib/colors';
import { ACTION_KEY, ACTION_ORDER, ACTION_TONE } from '@/contours/traffic/lib/nodePolicyActions';
import { extraMatchers, matchTokens, parseTokens } from '@/contours/traffic/lib/nodePolicyMatch';
import { GripIcon, SelectorIcon, TrashIcon } from '@/contours/traffic/components/NodePolicy/icons';

/** Lane widths come off the artboard and are shared by every row of the list,
 *  including the locked one above and the default one below. */
export const SLOT = 22;
export const MATCH_W = 340;
export const ACTION_W = 230;

export interface DirectionOption {
  id: string;
  label: string;
}

/**
 * One operator rule.
 *
 * A shadowed rule keeps every control it had. It is not broken and not
 * read-only, it simply never fires where it currently sits, and the fix is
 * usually to drag it above the rule eating it. Greying it out and taking the
 * controls away would hide the one action that helps.
 */
export function RuleRow({
  rule,
  first,
  shadowNote,
  directions,
  onChange,
  onRemove,
  onGrab,
}: {
  rule: PolicyRule;
  first: boolean;
  /** The sentence naming who eats this rule, or null. */
  shadowNote: string | null;
  directions: DirectionOption[];
  onChange: (next: PolicyRule) => void;
  onRemove: () => void;
  onGrab: (e: React.PointerEvent) => void;
}) {
  const { t } = useTranslation();
  const shadowed = shadowNote !== null;
  const tone = ACTION_TONE[rule.action.kind];
  const extras = extraMatchers(rule.match);

  const actionLabel =
    rule.action.kind === 'cascade'
      ? (rule.action.directionLabel ??
        directions.find((d) => d.id === rule.action.directionId)?.label ??
        t('routes.nodeAction.viaDirection'))
      : t(`routes.nodeAction.${ACTION_KEY[rule.action.kind]}`);

  function pick(kind: PolicyActionKind, directionId?: string, directionLabel?: string) {
    onChange({
      ...rule,
      action:
        kind === 'cascade'
          ? { kind, directionId: directionId ?? null, directionLabel: directionLabel ?? null }
          : { kind, directionId: null },
    });
  }

  return (
    <Box
      data-rule-row
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 20px',
        borderTop: first ? 'none' : `1px solid ${HAIRLINE}`,
        backgroundColor: shadowed ? SHADOW_BG : 'transparent',
      }}
    >
      <Box
        onPointerDown={onGrab}
        title={t('routes.nodeDragHint')}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: SLOT,
          flexShrink: 0,
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <GripIcon size={12} color="#3A4A60" />
      </Box>

      <TextInput
        value={matchTokens(rule.match).join(' · ')}
        onChange={(e) =>
          onChange({ ...rule, match: parseTokens(e.currentTarget.value, rule.match) })
        }
        placeholder={t('routes.nodeMatchPlaceholder')}
        styles={{
          root: { width: MATCH_W, flexShrink: 0 },
          input: {
            height: 32,
            minHeight: 32,
            paddingInline: 10,
            borderRadius: 7,
            backgroundColor: WELL,
            border: `1px solid ${EDGE}`,
            fontFamily: MONO,
            fontSize: 12,
            lineHeight: '16px',
            color: shadowed ? SHADOW_INK : SNOW,
            textDecoration: shadowed ? 'line-through' : 'none',
          },
        }}
      />

      <Menu position="bottom-start" offset={4} withinPortal>
        <Menu.Target>
          <UnstyledButton
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              width: ACTION_W,
              flexShrink: 0,
              height: 32,
              paddingInline: 10,
              borderRadius: 7,
              backgroundColor: WELL,
              border: `1px solid ${EDGE}`,
            }}
          >
            <Box
              style={{
                width: 5,
                height: 5,
                borderRadius: 999,
                backgroundColor: shadowed ? SHADOW_INK : tone,
                flexShrink: 0,
              }}
            />
            <Text
              style={{
                fontFamily: DISPLAY,
                fontSize: 13,
                lineHeight: '16px',
                color: shadowed ? SHADOW_INK : SNOW,
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'left',
              }}
            >
              {actionLabel}
            </Text>
            <SelectorIcon size={11} color={FAINT} />
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown style={{ backgroundColor: WELL, border: `1px solid ${HAIRLINE}` }}>
          {ACTION_ORDER.filter((k) => k !== 'cascade').map((k) => (
            <Menu.Item key={k} onClick={() => pick(k)}>
              <ActionItem tone={ACTION_TONE[k]} label={t(`routes.nodeAction.${ACTION_KEY[k]}`)} />
            </Menu.Item>
          ))}
          {/* A cascade rule cannot be picked without saying which way out, so
              the directions ARE the menu entries. With none built there is
              nothing to offer, and the group says that rather than showing an
              entry that opens onto nothing. */}
          <Menu.Label
            style={{
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: FAINT,
            }}
          >
            {t('routes.nodeAction.viaDirection')}
          </Menu.Label>
          {directions.length === 0 ? (
            <Menu.Item disabled>
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: FAINT }}>
                {t('routes.nodeNoDirections')}
              </Text>
            </Menu.Item>
          ) : (
            directions.map((d) => (
              <Menu.Item key={d.id} onClick={() => pick('cascade', d.id, d.label)}>
                <ActionItem tone={CYAN} label={d.label} />
              </Menu.Item>
            ))
          )}
        </Menu.Dropdown>
      </Menu>

      {/* The note lane. The API carries no operator note on a rule, so the lane
          holds what the panel actually knows: why this rule is dead, or the
          matchers that did not fit in the line to its left. */}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 12,
          lineHeight: '16px',
          color: shadowed ? SHADOW_NOTE : FAINT,
          flex: 1,
          minWidth: 0,
        }}
      >
        {shadowNote ?? (extras.length > 0 ? extras.join(' · ') : '')}
      </Text>

      <UnstyledButton
        type="button"
        onClick={onRemove}
        title={t('routes.nodeRemoveRule')}
        style={{ display: 'flex', alignItems: 'center', flexShrink: 0, padding: 4 }}
      >
        <TrashIcon size={13} color={MIST} />
      </UnstyledButton>
    </Box>
  );
}

function ActionItem({ tone, label }: { tone: string; label: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <Box style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '16px', color: SNOW }}>
        {label}
      </Text>
    </Box>
  );
}
