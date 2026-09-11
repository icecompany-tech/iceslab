import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import {
  createNodePolicy,
  deleteNodePolicy,
  policyRefusal,
  toRuleInput,
  updateNodePolicy,
  type NodePolicy,
  type PolicyRule,
} from '@/lib/domain/nodePolicies';
import {
  CARD,
  CYAN,
  DISPLAY,
  EDGE,
  FAINT,
  HAIRLINE,
  MIST,
  MONO,
  MOSS,
  RED,
  SNOW,
  WELL,
} from '@/contours/traffic/lib/colors';
import { LockIcon, PlusIcon, TickIcon } from '@/contours/traffic/components/Routes/icons';
import { GlobeIcon, TrashIcon } from '@/contours/traffic/components/NodePolicy/icons';
import {
  ACTION_W,
  MATCH_W,
  RuleRow,
  SLOT,
  type DirectionOption,
} from '@/contours/traffic/components/NodePolicy/RuleRow';

/**
 * One node policy, as the three stages it really is, in one list, top down.
 *
 *   Защита          - the panel's own first rule. Shown, never moved.
 *   Политика        - the operator's rules, in their order.
 *   Дверь наружу    - what is left goes out the node's own way. Always there.
 *
 * The middle band is the only one that is data. The other two are drawn as
 * rows because the list is read as one sequence and hiding either end would
 * make the operator reason about a list that is not the one being evaluated.
 */

const LOCAL_PREFIX = 'new-';
let seq = 0;

export function NodePolicyEditor({
  policy,
  directions,
  isDraft,
  onSaved,
  onDeleted,
}: {
  policy: NodePolicy;
  directions: DirectionOption[];
  isDraft: boolean;
  onSaved: (saved: NodePolicy) => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(policy.name);
  const [rules, setRules] = useState<PolicyRule[]>(policy.rules);
  /** The server's own sentence about why it refused, kept verbatim. */
  const [refusal, setRefusal] = useState<{ message: string; policies?: string[] } | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['node-policies'] });
    qc.invalidateQueries({ queryKey: ['nodes'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), rules: toRuleInput(rules) };
      return isDraft ? createNodePolicy(body) : updateNodePolicy(policy.id, body);
    },
    onSuccess: (saved) => {
      setRefusal(null);
      invalidate();
      notifications.show({ color: 'green', message: t('routes.nodeSaved') });
      onSaved(saved);
    },
    onError: (err) => {
      // Every refusal this API sends already names the node, the policy or the
      // reason. Showing it as written is the whole point: "could not save"
      // would throw away the only part the operator can act on.
      const r = policyRefusal(err);
      setRefusal(r ? { message: r.message, ...(r.policies ? { policies: r.policies } : {}) } : null);
      if (!r) {
        notifications.show({
          color: 'red',
          title: t('common.saveError'),
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteNodePolicy(policy.id),
    onSuccess: () => {
      invalidate();
      notifications.show({ color: 'green', message: t('routes.nodeDeleted') });
      onDeleted();
    },
    onError: (err) => {
      const r = policyRefusal(err);
      setRefusal(r ? { message: r.message } : null);
    },
  });

  /**
   * Grab a rule.
   *
   * Row midpoints are measured ONCE, before anything moves, and the list is
   * not reshuffled under the cursor: a dragged row keeps its place and a line
   * shows where it would land. Reordering live would invalidate the very
   * measurements the drag is steering by, and rows here are not a fixed height
   * (a shadow sentence wraps), so there is nothing to recompute them from.
   */
  function grab(index: number, e: React.PointerEvent) {
    e.preventDefault();
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-rule-row]') ?? []);
    const mids = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    const start = { from: index, to: index };
    dragRef.current = start;
    setDrag(start);

    const move = (ev: PointerEvent) => {
      let to = mids.findIndex((m) => ev.clientY < m);
      if (to === -1) to = mids.length - 1;
      const next = { from: index, to };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (d && d.to !== d.from) {
        setRules((cur) => {
          const next = [...cur];
          const [moved] = next.splice(d.from, 1);
          next.splice(d.to, 0, moved!);
          return next;
        });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /**
   * Who eats this rule, as a sentence.
   *
   * The API answers with an id and a position. A position alone sends the
   * operator counting rows; the name of the matcher that swallowed it is the
   * thing they recognise, so the row it points at is looked up and quoted.
   *
   * Only shown for rules as they came from the server: after a local edit the
   * verdict belongs to text that is no longer on screen, and re-deriving it
   * here would mean re-implementing a deliberately sound-not-complete rule.
   */
  function shadowNote(rule: PolicyRule): string | null {
    if (!rule.shadowedBy) return null;
    const culprit = rules.find((r) => r.id === rule.shadowedBy!.id);
    if (!culprit) return null;
    const tokens = [...culprit.match.domain, ...culprit.match.ip];
    return t('routes.nodeShadowed', {
      culprit: tokens.length > 0 ? tokens.join(', ') : t('routes.nodeAnything'),
    });
  }

  const nodeCount = policy.nodeCount ?? 0;

  return (
    <Stack
      gap={0}
      style={{
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 10,
        overflow: 'clip',
        flex: 1,
        minWidth: 0,
      }}
    >
      {/* Header: the name, how many machines run it, and the one sentence that
          explains the whole list below. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '18px 20px',
          backgroundColor: WELL,
          borderBottom: `1px solid ${HAIRLINE}`,
        }}
      >
        <TextInput
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={t('routes.nodePolicyNamePlaceholder')}
          styles={{
            root: { width: 280, flexShrink: 0 },
            input: {
              height: 34,
              minHeight: 34,
              paddingInline: 10,
              borderRadius: 7,
              backgroundColor: CARD,
              border: `1px solid ${EDGE}`,
              fontFamily: DISPLAY,
              fontSize: 17,
              fontWeight: 600,
              color: SNOW,
            },
          }}
        />

        {/* One policy on many nodes is ONE policy, and a save reaches all of
            them. The count is the sentence that says so. */}
        <Box
          title={t('routes.nodeCountHint')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '4px 9px',
            borderRadius: 5,
            border: `1px solid ${nodeCount > 0 ? `${CYAN}59` : EDGE}`,
            backgroundColor: nodeCount > 0 ? `${CYAN}14` : 'transparent',
            flexShrink: 0,
          }}
        >
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: nodeCount > 0 ? CYAN : MIST,
            }}
          >
            {nodeCount > 0
              ? t('routes.nodeOnNodes', { count: nodeCount })
              : t('routes.nodeOnNoNodes')}
          </Text>
        </Box>

        <Box style={{ flex: 1, minWidth: 0 }} />
        <Text
          style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, flexShrink: 0 }}
        >
          {t('routes.firstMatchWins')}
        </Text>
      </Box>

      {/* Column head */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '11px 20px',
          backgroundColor: WELL,
          borderBottom: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box style={{ width: SLOT, flexShrink: 0 }} />
        <ColLabel width={MATCH_W}>{t('routes.nodeColIf')}</ColLabel>
        <ColLabel width={ACTION_W}>{t('routes.nodeColThen')}</ColLabel>
        <ColLabel>{t('routes.nodeColNote')}</ColLabel>
      </Box>

      {/* Стадия 1: protection. Drawn, never moved. */}
      <Box style={{ borderLeft: `3px solid ${RED}` }}>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px' }}>
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: SLOT,
              flexShrink: 0,
            }}
          >
            <LockIcon size={12} color={FAINT} />
          </Box>
          <Text
            style={{ fontFamily: MONO, fontSize: 12, lineHeight: '16px', color: MIST, width: MATCH_W, flexShrink: 0 }}
          >
            {t('routes.nodeProtectionMatch')}
          </Text>
          <Text
            style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '16px', color: MIST, width: ACTION_W, flexShrink: 0 }}
          >
            {t('routes.nodeProtectionAction')}
          </Text>
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, flex: 1, minWidth: 0 }}>
            {t('routes.nodeProtectionNote')}
          </Text>
        </Box>
      </Box>

      {/* Стадия 2: the operator's own, in the operator's order. */}
      <Box ref={listRef} style={{ borderLeft: `3px solid ${CYAN}`, borderTop: `1px solid ${HAIRLINE}` }}>
        {rules.map((rule, i) => (
          <Box key={rule.id} style={{ position: 'relative', opacity: drag?.from === i ? 0.4 : 1 }}>
            {drag && drag.to === i && drag.from !== i && (
              <Box
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: drag.to > drag.from ? undefined : 0,
                  bottom: drag.to > drag.from ? 0 : undefined,
                  height: 2,
                  backgroundColor: CYAN,
                  zIndex: 2,
                }}
              />
            )}
            <RuleRow
              rule={rule}
              first={i === 0}
              shadowNote={shadowNote(rule)}
              directions={directions}
              onGrab={(e) => grab(i, e)}
              onChange={(next) => setRules((cur) => cur.map((r, j) => (j === i ? next : r)))}
              onRemove={() => setRules((cur) => cur.filter((_, j) => j !== i))}
            />
          </Box>
        ))}
        {rules.length === 0 && (
          <Box style={{ padding: '16px 20px' }}>
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: FAINT }}>
              {t('routes.nodeNoRules')}
            </Text>
          </Box>
        )}
      </Box>

      {/* Add */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '12px 20px',
          borderTop: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box style={{ width: SLOT, flexShrink: 0 }} />
        <UnstyledButton
          type="button"
          onClick={() =>
            setRules((cur) => [
              ...cur,
              {
                id: `${LOCAL_PREFIX}${seq++}`,
                position: cur.length,
                enabled: true,
                match: { domain: [], ip: [], port: null, protocol: [], network: null },
                action: { kind: 'block', directionId: null },
                shadowedBy: null,
              },
            ])
          }
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 32,
            paddingInline: 12,
            borderRadius: 7,
            border: `1px dashed ${EDGE}`,
          }}
        >
          <PlusIcon size={12} color={FAINT} />
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}>
            {t('routes.nodeAddRule')}
          </Text>
        </UnstyledButton>
      </Box>

      {/* Стадия 3: the door out. Belongs to the node, not to this policy, which
          is exactly what the note says: one policy can sit on many nodes and
          each of them leaves by its own. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '15px 20px',
          backgroundColor: WELL,
          borderLeft: `3px solid ${MOSS}`,
          borderTop: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: SLOT,
            flexShrink: 0,
          }}
        >
          <GlobeIcon size={12} color={MOSS} />
        </Box>
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: '16px',
            color: SNOW,
            width: MATCH_W,
            flexShrink: 0,
          }}
        >
          {t('routes.everythingElse')}
        </Text>
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            width: ACTION_W,
            flexShrink: 0,
            height: 32,
            paddingInline: 10,
            borderRadius: 7,
            backgroundColor: CARD,
            border: '1px solid #3A4A60',
          }}
        >
          <Box style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: CYAN, flexShrink: 0 }} />
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
            {t('routes.nodeDoor')}
          </Text>
        </Box>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, flex: 1, minWidth: 0 }}>
          {t('routes.nodeDoorNote')}
        </Text>
      </Box>

      {/* The server's refusal, word for word. */}
      {refusal && (
        <Box
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '12px 20px',
            backgroundColor: `${RED}14`,
            borderTop: `1px solid ${RED}40`,
          }}
        >
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: RED }}>
            {refusal.message}
          </Text>
          {refusal.policies && refusal.policies.length > 0 && (
            <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '15px', color: MIST }}>
              {refusal.policies.join(' · ')}
            </Text>
          )}
        </Box>
      )}

      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 20px',
          borderTop: `1px solid ${HAIRLINE}`,
        }}
      >
        {!isDraft && (
          <UnstyledButton
            type="button"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 4px' }}
          >
            <TrashIcon size={13} color={MIST} />
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: MIST }}>
              {t('common.delete')}
            </Text>
          </UnstyledButton>
        )}
        <Box style={{ flex: 1, minWidth: 0 }} />
        <UnstyledButton
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={!name.trim() || saveMutation.isPending}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 36,
            paddingInline: 16,
            borderRadius: 8,
            backgroundColor: `${CYAN}1F`,
            border: `1px solid ${CYAN}`,
            opacity: name.trim() ? 1 : 0.5,
          }}
        >
          <TickIcon size={13} color={CYAN} />
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, color: SNOW }}>
            {isDraft ? t('routes.nodeCreate') : t('common.save')}
          </Text>
        </UnstyledButton>
      </Box>
    </Stack>
  );
}

function ColLabel({ width, children }: { width?: number; children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: FAINT,
        ...(width ? { width, flexShrink: 0 } : { flex: 1, minWidth: 0 }),
      }}
    >
      {children}
    </Text>
  );
}
