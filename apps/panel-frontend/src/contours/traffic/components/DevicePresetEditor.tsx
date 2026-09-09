import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ROUTING_PRESET_WRITES_LIVE,
  createRoutingPreset,
  deleteRoutingPreset,
  updateRoutingPreset,
  type RouteAction,
  type RouteRule,
  type RoutingPreset,
} from '@/lib/domain/routePolicies';
import { apiErrorMessage } from '@/lib/net/client';
import { ACTION_TONE, ActionSelect } from '@/contours/traffic/components/RoutePolicyEditor';

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

const HAIRLINE = '#1C2A3D';
const EDGE = '#2C3A4E';
const WELL = '#0B1420';
const RAISED = '#152233';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const AMBER = '#F5B14C';
const RED = '#E07A5F';
const VIOLET = '#A78BFA';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/** Only the dropdown needs a number; the columns themselves are sized in CSS
 *  (.routes-rule-match / .routes-rule-action) so they can shrink together. */
const ACTION_W = 230;

/** Rule rows carry one edge colour, not the action's: on the device the list is
 *  read as a sequence, and the dot already says what each row does. */
const RULE_EDGE = '#4E8FB8';
const DEFAULT_EDGE = '#4ADE80';
const WARN_BG = '#1A1512';
const WARN_EDGE = '#3A2320';

/** What a client can do before the traffic leaves it. */
const DEVICE_ACTIONS: RouteAction[] = ['direct', 'block', 'proxy'];

export const NEW_PRESET_ID = '__new__';

export function blankPreset(): RoutingPreset {
  return { id: NEW_PRESET_ID, name: '', builtIn: false, rules: [] };
}

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
  const qc = useQueryClient();
  const nextKey = useRef(0);

  const initial = useMemo(
    () => preset.rules.map((r) => ({ ...r, id: r.id || `d${nextKey.current++}` })),
    [preset],
  );
  const [name, setName] = useState(preset.name);
  const [rules, setRules] = useState<RouteRule[]>(initial);
  const [loadedFor, setLoadedFor] = useState(preset.id);
  const [dragging, setDragging] = useState<number | null>(null);

  if (loadedFor !== preset.id) {
    setLoadedFor(preset.id);
    setName(preset.name);
    setRules(preset.rules.map((r) => ({ ...r, id: r.id || `d${nextKey.current++}` })));
    setDragging(null);
  }

  const locked = preset.builtIn;
  // A preset that has never been saved is dirty by definition, even straight
  // out of an imported file where nothing has been typed yet.
  const dirty =
    !locked &&
    (preset.id === NEW_PRESET_ID ||
      name !== preset.name ||
      JSON.stringify(strip(rules)) !== JSON.stringify(strip(initial)));
  const shadows = useMemo(() => findShadows(rules), [rules]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = { name: name.trim() || preset.name, rules: strip(rules) };
      return preset.id === NEW_PRESET_ID
        ? createRoutingPreset(input)
        : updateRoutingPreset(preset.id, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing-presets'] });
      notifications.show({ color: 'green', message: t('routes.presetSaved') });
      onSaved?.();
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRoutingPreset(preset.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing-presets'] });
      notifications.show({ color: 'green', message: t('routes.presetDeleted') });
      onSaved?.();
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.deleteError'), message: apiErrorMessage(err) }),
  });

  function setRule(i: number, patch: Partial<RouteRule>) {
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addRule() {
    setRules((prev) => [...prev, { id: `d${nextKey.current++}`, match: [], action: 'direct', note: '' }]);
  }
  function removeRule(i: number) {
    setRules((prev) => prev.filter((_, j) => j !== i));
  }
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
      title: t('routes.presetDeleteTitle', { name: preset.name }),
      children: <Text size="sm">{t('routes.presetDeleteBody')}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(),
    });
  }

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

const SHADOW_BG = '#1A1512';
const SHADOW_INK = '#6E6257';
const SHADOW_NOTE = '#C08A5A';

/* ───── Model ───────────────────────────────────────────────────────────── */

function strip(rules: RouteRule[]) {
  return rules.map((r) => ({ match: r.match, action: r.action, note: r.note }));
}

function splitMatch(value: string): string[] {
  return value
    .split(/[\s·,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Exact matcher collisions only, for the same reason as the node editor: real
 *  subsumption needs the geosite database, which the panel does not have. */
function findShadows(rules: RouteRule[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Set<string>();
  for (const rule of rules) {
    if (rule.match.length === 0) continue;
    const hit = rule.match.find((m) => seen.has(m));
    if (hit !== undefined) {
      out.set(rule.id, hit);
      continue;
    }
    for (const m of rule.match) seen.add(m);
  }
  return out;
}

/* ───── Pieces ──────────────────────────────────────────────────────────── */

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
      <path
        d="M10.3 4.3l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7 -3l-8 -14a2 2 0 0 0 -3.4 0"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M12 9h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M11 12h1v4h1"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}
