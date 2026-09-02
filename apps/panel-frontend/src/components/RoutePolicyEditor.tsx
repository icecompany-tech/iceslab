import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Menu, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ROUTE_POLICY_WRITES_LIVE,
  apiErrorMessage,
  createRoutePolicy,
  deleteRoutePolicy,
  policyConflict,
  toPolicyInput,
  updateRoutePolicy,
  type RouteAction,
  type RoutePolicy,
  type RouteRule,
  type Squad,
} from '../lib/api';

/**
 * The "on the node" editor: a policy's rules in the order they are evaluated.
 *
 * Traffic has already reached us here, so every rule decides which door it
 * leaves by. The first and last rows are not rules and cannot be moved: the
 * panel always puts its own hygiene rules first, and whatever matched nothing
 * has to leave somewhere.
 *
 * The rule model (ordered, four actions, per-rule note) is what the design
 * needs and what `RoutePolicyInput` describes. The API stores two flat domain
 * arrays and has no write route yet, so a policy loaded today is DERIVED from
 * those arrays and Save reports the 404 rather than pretending. Everything
 * else on this screen is live.
 */

const HAIRLINE = '#1C2A3D';
const EDGE = '#2C3A4E';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const RAISED = '#152233';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';
const VIOLET = '#A78BFA';

/** The warm ground and muted ink a shadowed row wears. */
const SHADOW_BG = '#1A1512';
const SHADOW_INK = '#6E6257';
const SHADOW_NOTE = '#C08A5A';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/** Only the dropdown needs a number; the columns themselves are sized in CSS
 *  (.routes-rule-match / .routes-rule-action) so they can shrink together. */
const ACTION_W = 230;

export const ACTION_TONE: Record<RouteAction, string> = {
  block: RED,
  direct: MOSS,
  warp: VIOLET,
  proxy: CYAN,
};
/** Everything a node can do with traffic it has already received. */
const ACTIONS: RouteAction[] = ['block', 'direct', 'warp', 'proxy'];

/** A draft rule carries a key so reordering does not remount its input. */
interface DraftRule extends RouteRule {}

export function RoutePolicyEditor({
  policy,
  squads,
  onCreated,
}: {
  policy: RoutePolicy;
  squads: Squad[];
  onCreated?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const nextKey = useRef(0);

  const initial = useMemo(() => toRules(policy, () => `r${nextKey.current++}`), [policy]);
  const [name, setName] = useState(policy.name);
  const [rules, setRules] = useState<DraftRule[]>(initial);
  const [loadedFor, setLoadedFor] = useState(policy.id);
  const [dragging, setDragging] = useState<number | null>(null);

  // Re-seed when the operator picks a different policy in the list.
  if (loadedFor !== policy.id) {
    setLoadedFor(policy.id);
    setName(policy.name);
    setRules(toRules(policy, () => `r${nextKey.current++}`));
    setDragging(null);
  }

  // A policy that has never been saved is dirty by definition, even straight
  // out of an imported file where nothing has been typed yet.
  const dirty =
    policy.id === NEW_POLICY_ID ||
    name !== policy.name ||
    JSON.stringify(strip(rules)) !== JSON.stringify(strip(initial));
  const shadows = useMemo(() => findShadows(rules), [rules]);
  const granted = squads.filter((s) => s.policyIds.includes(policy.id));

  const saveMutation = useMutation({
    mutationFn: () => {
      // The API keeps two flat domain lists, so the ordered rules fold down on
      // save. The band is never sent: it is the API's to assign, and on an
      // existing policy it cannot move at all.
      const input = toPolicyInput(name.trim() || policy.name, strip(rules));
      return policy.id === NEW_POLICY_ID ? createRoutePolicy(input) : updateRoutePolicy(policy.id, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['route-policies'] });
      notifications.show({ color: 'green', message: t('routes.policySaved') });
      onCreated?.();
    },
    onError: (err) => {
      // A name or band collision, or a policy with no domains at all: the API
      // says which, and the fix differs, so its sentence is the useful one.
      const named = policyConflict(err);
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: named ?? apiErrorMessage(err),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRoutePolicy(policy.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['route-policies'] });
      notifications.show({ color: 'green', message: t('routes.policyDeleted') });
      onCreated?.();
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.deleteError'), message: apiErrorMessage(err) }),
  });

  function setRule(i: number, patch: Partial<DraftRule>) {
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addRule() {
    setRules((prev) => [
      ...prev,
      { id: `r${nextKey.current++}`, match: [], action: 'direct', note: '' },
    ]);
  }
  function removeRule(i: number) {
    setRules((prev) => prev.filter((_, j) => j !== i));
  }
  /** Move `from` to `to`, the way a drop reads: the row lands where it hovers. */
  function move(from: number, to: number) {
    if (from === to) return;
    setRules((prev) => {
      const next = [...prev];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row!);
      return next;
    });
  }

  function confirmDelete() {
    modals.openConfirmModal({
      title: t('routes.policyDeleteTitle', { name: policy.name }),
      children: (
        <Text size="sm">
          {granted.length > 0
            ? t('routes.policyDeleteGranted', { count: granted.length })
            : t('routes.policyDeleteSafe')}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(),
    });
  }

  return (
    <Stack gap={0} className="routes-detail">
      {/* Header: the name is the field, because renaming is an edit like any
          other and a policy has nowhere else to be renamed. */}
      <Box style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', width: '100%' }}>
        <TextInput
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={t('routes.policyNamePlaceholder')}
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
          style={{ width: 260, flexShrink: 0 }}
        />
        {/* The band, read-only on purpose. It rides inside every subscriber's
            UUID, so moving it would reroute everyone already holding a link.
            The API assigns it and refuses to change it. */}
        {policy.id !== NEW_POLICY_ID && (
          <Box title={t('routes.bandFixed')}>
            <Chip tone={CYAN}>{t('routes.tag', { n: policy.ordinal })}</Chip>
          </Box>
        )}
        {dirty && <Chip tone={AMBER}>{t('routes.unsaved')}</Chip>}
        <Box style={{ flex: 1, minWidth: 0 }} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
          {t('routes.firstMatchWins')}
        </Text>
        {policy.id !== NEW_POLICY_ID && ROUTE_POLICY_WRITES_LIVE && (
          <IconAction title={t('common.delete')} onClick={confirmDelete}>
            <TrashIcon size={15} color={RED} />
          </IconAction>
        )}
        <Action
          disabled={!ROUTE_POLICY_WRITES_LIVE || !dirty || saveMutation.isPending}
          // Saving is not a local edit: the API re-pushes the config to every
          // enabled cascade entry, so it reaches live machines immediately.
          title={ROUTE_POLICY_WRITES_LIVE ? t('routes.saveReachesNodes') : t('routes.writesDisabledPolicies')}
          onClick={() => saveMutation.mutate()}
        >
          {t('common.save')}
        </Action>
      </Box>

      {/* Columns */}
      <Box
        className="routes-rule"
        style={{
          paddingBlock: 9,
          paddingInline: 20,
          backgroundColor: WELL,
          borderTop: `1px solid ${HAIRLINE}`,
          borderBottom: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box style={{ width: 22, flexShrink: 0 }} />
        <ColHead className="routes-rule-match">{t('routes.colMatch')}</ColHead>
        <ColHead className="routes-rule-action">{t('routes.colSend')}</ColHead>
        <ColHead flex>{t('routes.colNote')}</ColHead>
      </Box>

      {/* The panel's own hygiene rules. Not editable and not a lie: they are
          emitted ahead of everything an operator writes. */}
      <Box
        className="routes-rule"
        style={{ paddingBlock: 12, paddingInline: 20, borderLeft: `3px solid ${RED}` }}
      >
        <Box style={{ width: 22, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          <LockIcon size={12} color={FAINT} />
        </Box>
        <Text
          className="routes-rule-match"
          style={{ fontFamily: MONO, fontSize: 12, lineHeight: '16px', color: MIST }}
        >
          {t('routes.hygieneMatch')}
        </Text>
        <Text
          className="routes-rule-action"
          style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '16px', color: MIST }}
        >
          {t('routes.hygieneAction')}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, flex: 1, minWidth: 0 }}>
          {t('routes.hygieneNote')}
        </Text>
      </Box>

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

      {/* The row that always exists and always has a value. */}
      <Box
        className="routes-rule"
        style={{ paddingBlock: 14, paddingInline: 20, backgroundColor: WELL, borderTop: `1px solid ${HAIRLINE}` }}
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
        <Box
          className="routes-rule-action"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            height: 32,
            paddingInline: 10,
            borderRadius: 7,
            backgroundColor: CARD,
            border: `1px solid ${EDGE}`,
          }}
        >
          <Box style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: CYAN, flexShrink: 0 }} />
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '16px', color: SNOW }}>
            {t('routes.nodeDoor')}
          </Text>
        </Box>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, flex: 1, minWidth: 0 }}>
          {t('routes.nodeDoorNote')}
        </Text>
      </Box>

      {/* One line, always true today, and one line to delete when it stops
          being true. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          padding: '12px 20px',
          borderTop: `1px solid ${HAIRLINE}`,
          backgroundColor: `${AMBER}0A`,
        }}
      >
        <WarnIcon size={13} color={AMBER} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: AMBER, flex: 1 }}>
          {t('routes.writesNotLive')}
        </Text>
      </Box>
    </Stack>
  );
}

/** The id a policy that does not exist yet carries. */
export const NEW_POLICY_ID = '__new__';

/** A blank policy for the New-policy button to open. */
export function blankPolicy(): RoutePolicy {
  return { id: NEW_POLICY_ID, name: '', ordinal: 0, rules: [], directDomains: [], blockDomains: [] };
}

/* ───── Model ───────────────────────────────────────────────────────────── */

/**
 * The policy as an ordered rule list. When the API ships `rules` that is what
 * we use; until then the two flat arrays are unrolled into one rule per domain,
 * block first, which is the order the config generator emits them in.
 */
function toRules(policy: RoutePolicy, id: () => string): DraftRule[] {
  if (policy.rules) return policy.rules.map((r) => ({ ...r, id: r.id || id() }));
  return [
    ...policy.blockDomains.map((d) => ({ id: id(), match: [d], action: 'block' as const, note: '' })),
    ...policy.directDomains.map((d) => ({ id: id(), match: [d], action: 'direct' as const, note: '' })),
  ];
}

/** The payload shape, without the client-side keys. */
function strip(rules: DraftRule[]) {
  return rules.map((r) => ({ match: r.match, action: r.action, note: r.note }));
}

/** Matchers are entered as one line, separated by spaces or middots. */
function splitMatch(value: string): string[] {
  return value
    .split(/[\s·,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Which rules can never fire, and because of what.
 *
 * Only exact matcher collisions are reported: an earlier rule claiming the same
 * token always wins, which is provable from the strings alone. Real subsumption
 * (geosite:google swallowing geosite:youtube) needs the geosite database, which
 * the panel does not have, so those go unflagged rather than guessed at.
 */
function findShadows(rules: DraftRule[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const rule of rules) {
    if (rule.match.length === 0) continue;
    const hit = rule.match.find((m) => seen.has(m));
    if (hit !== undefined) {
      out.set(rule.id, hit);
      continue;
    }
    for (const m of rule.match) seen.set(m, rule.id);
  }
  return out;
}

/* ───── Pieces ──────────────────────────────────────────────────────────── */

export function ActionSelect({
  value,
  muted,
  choices = ACTIONS,
  labelKey = 'routes.action',
  width = ACTION_W,
  height = 32,
  className,
  onChange,
}: {
  value: RouteAction;
  muted?: boolean;
  /** Which actions this layer can actually take. A device cannot use WARP. */
  choices?: RouteAction[];
  labelKey?: string;
  width?: number;
  height?: number;
  /** Hands the column width to CSS, which can shrink it on narrow screens. */
  className?: string;
  onChange: (a: RouteAction) => void;
}) {
  const { t } = useTranslation();
  const tone = muted ? SHADOW_INK : ACTION_TONE[value];
  const ACTION_W = width;
  const ACTIONS = choices;
  return (
    <Menu position="bottom-start" width={ACTION_W} withinPortal>
      <Menu.Target>
        <UnstyledButton
          type="button"
          className={className}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            height,
            paddingInline: 10,
            width: className ? undefined : ACTION_W,
            flexShrink: 0,
            borderRadius: 7,
            backgroundColor: WELL,
            border: `1px solid ${EDGE}`,
          }}
        >
          <Box style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
          <Text
            style={{
              fontFamily: DISPLAY,
              fontSize: 13,
              lineHeight: '16px',
              color: muted ? SHADOW_INK : SNOW,
              flex: 1,
              minWidth: 0,
              textAlign: 'left',
            }}
          >
            {t(`${labelKey}.${value}`)}
          </Text>
          <ChevronIcon size={11} color={FAINT} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
        {ACTIONS.map((a) => (
          <Menu.Item key={a} onClick={() => onChange(a)} style={{ padding: '7px 10px' }}>
            <Box style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Box
                style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: ACTION_TONE[a], flexShrink: 0 }}
              />
              <Text
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 13,
                  lineHeight: '16px',
                  color: a === value ? SNOW : MIST,
                  flex: 1,
                }}
              >
                {t(`${labelKey}.${a}`)}
              </Text>
              {a === value && <TickIcon size={12} color={CYAN} />}
            </Box>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 22,
        paddingInline: 8,
        borderRadius: 6,
        flexShrink: 0,
        backgroundColor: `${tone}14`,
        border: `1px solid ${tone}2E`,
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.08em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color: tone,
        }}
      >
        {children}
      </Text>
    </Box>
  );
}

function ColHead({
  children,
  className,
  flex,
}: {
  children: ReactNode;
  className?: string;
  flex?: boolean;
}) {
  return (
    <Text
      className={className}
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.12em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
        flex: flex ? 1 : undefined,
        minWidth: flex ? 0 : undefined,
      }}
    >
      {children}
    </Text>
  );
}

function Action({
  children,
  disabled,
  title,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 34,
        paddingInline: 14,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <TickIcon size={14} color={CYAN} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
        {children}
      </Text>
    </UnstyledButton>
  );
}

function IconAction({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 32,
        borderRadius: 7,
        flexShrink: 0,
      }}
    >
      {children}
    </UnstyledButton>
  );
}

/* ───── Icons ───────────────────────────────────────────────────────────── */

function LockIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke={color} strokeWidth="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function GripIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M8 7h8M8 12h8M8 17h8" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function NoEntryIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="2" />
      <path d="M8 12h8" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M8 10l4-4 4 4M8 14l4 4 4-4"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TickIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M5 12l5 5L20 7"
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M4 7h16" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path
        d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2l1 -12"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 7v-2a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v2"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 5l0 14" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M5 12l14 0" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function WarnIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M12 9v4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}
