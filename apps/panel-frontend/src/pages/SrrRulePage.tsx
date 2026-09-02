import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, NumberInput, Stack, Switch, Text, TextInput, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiErrorMessage,
  createSrrRule,
  listSrrRules,
  updateSrrRule,
  type SubscriptionFormat,
} from '../lib/api';
import { CASCADE_AWARE_FORMATS, SRR_FORMATS, formatTone } from '../lib/srrFormats';
import { compilePattern, patternCompiles, shadowedBy } from '../lib/srrMatch';
import { usePageMeta } from '../hooks/usePageMeta';
import { BarButton, BoltIcon, FormatChip, InfoIcon, TickIcon, WarnIcon, isCatchAll } from './SrrPage';

/**
 * One delivery rule: a regex over the User-Agent, a priority, and the format it
 * hands back. Create and edit are the same page.
 *
 * The rail is what makes this worth a page: a rule that never fires looks
 * exactly like a rule that works, so the draft is tested against a sample
 * User-Agent live, and any earlier rule that would beat it is named.
 */

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';

const DISPLAY = "'Space Grotesk Variable', 'Space Grotesk', 'Inter Variable', Inter, sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

interface Draft {
  name: string;
  uaPattern: string;
  priority: number | '';
  format: SubscriptionFormat;
  enabled: boolean;
}

const BLANK: Draft = {
  name: '',
  uaPattern: '',
  priority: 100,
  format: 'plain',
  enabled: true,
};

export function SrrRulePage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === undefined;

  const rulesQuery = useQuery({ queryKey: ['srr'], queryFn: listSrrRules });
  const rules = useMemo(() => rulesQuery.data?.rules ?? [], [rulesQuery.data]);
  const existing = useMemo(() => rules.find((r) => r.id === id) ?? null, [rules, id]);

  const [draft, setDraft] = useState<Draft>(BLANK);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [testUa, setTestUa] = useState('');

  // A new rule lands after the existing ones but still ahead of the catch-all,
  // rather than colliding with whatever already sits at 100 or landing behind
  // the rule that matches everything. Seeded once; the operator can move it.
  if (isNew && loadedFor === null && rules.length > 0) {
    setLoadedFor('new');
    setDraft({ ...BLANK, priority: nextPriority(rules) });
  }

  // Seed once per rule. Re-seeding on every refetch would throw away an edit.
  if (existing && loadedFor !== existing.id) {
    setLoadedFor(existing.id);
    setDraft({
      name: existing.name,
      uaPattern: existing.uaPattern,
      priority: existing.priority,
      format: existing.format,
      enabled: existing.enabled,
    });
  }

  // The section is already in the breadcrumb prefix; this only adds the rule.
  usePageMeta([isNew ? t('delivery.crumbNew') : (existing?.name ?? '')]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const priority = typeof draft.priority === 'number' ? draft.priority : 100;
  const patternOk = patternCompiles(draft.uaPattern);
  const valid = draft.name.trim().length > 0 && patternOk;

  // A stored rule can hold a format this panel no longer offers, so keep it in
  // the list rather than silently rewriting it on the next save.
  const formats = useMemo<SubscriptionFormat[]>(
    () => (SRR_FORMATS.includes(draft.format) ? SRR_FORMATS : [...SRR_FORMATS, draft.format]),
    [draft.format],
  );

  // Live verdict on the sample User-Agent: does this draft catch it, and is
  // there an earlier rule that catches it first.
  const sample = testUa.trim();
  const draftMatches = useMemo(() => {
    if (!sample || !patternOk) return false;
    // Same truncation the endpoint applies before testing.
    return compilePattern(draft.uaPattern)?.test(sample.slice(0, 256)) ?? false;
  }, [draft.uaPattern, sample, patternOk]);
  const shadow = useMemo(
    () => shadowedBy(rules, { ...draft, priority }, sample, existing?.id),
    [rules, draft, priority, sample, existing],
  );

  // Two rules at the same priority have no defined order between them, so the
  // one that wins is whatever the database hands back first.
  const priorityClash = useMemo(
    () => rules.find((r) => r.id !== existing?.id && r.enabled && r.priority === priority) ?? null,
    [rules, priority, existing],
  );

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: draft.name.trim(),
        uaPattern: draft.uaPattern,
        format: draft.format,
        priority,
        enabled: draft.enabled,
      };
      return existing ? updateSrrRule(existing.id, payload) : createSrrRule(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['srr'] });
      notifications.show({
        color: 'green',
        message: existing ? t('delivery.updated') : t('delivery.created'),
      });
      navigate('/subscription/delivery');
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: existing ? t('common.saveError') : t('common.createError'),
        message: apiErrorMessage(err),
      }),
  });

  if (!isNew && !existing) {
    return (
      <Box style={{ padding: 40, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: MIST, textAlign: 'center' }}>
          {rulesQuery.isLoading ? t('common.loading') : t('delivery.gone')}
        </Text>
      </Box>
    );
  }

  return (
    <Stack gap={20}>
      {/* Page bar */}
      <Box className="page-bar">
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 16, flexShrink: 0 }}>
          <Box
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: `${CYAN}1A`,
              border: `1px solid ${CYAN}33`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {isNew ? <PlusIcon size={16} color={CYAN} /> : <PencilIcon size={16} color={CYAN} />}
          </Box>
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {draft.name.trim() || (isNew ? t('delivery.newTitle') : (existing?.name ?? ''))}
          </Text>
        </Box>

        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box className="page-bar-facts">
          <Text
            className="page-bar-fact-soft"
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.14em',
              lineHeight: '12px',
              textTransform: 'uppercase',
              color: MIST,
            }}
          >
            {t('delivery.newSubtitle')}
          </Text>
          <Box style={{ flex: 1, minWidth: 0 }} />
          {isCatchAll(draft.uaPattern) && (
            <Box
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
              }}
            >
              <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: AMBER }} />
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  lineHeight: '12px',
                  textTransform: 'uppercase',
                  color: AMBER,
                }}
              >
                {t('delivery.catchAllWarn')}
              </Text>
            </Box>
          )}
        </Box>

        <Box className="page-bar-actions">
          <BarButton onClick={() => navigate('/subscription/delivery')}>{t('common.cancel')}</BarButton>
          <BarButton
            primary
            icon="tick"
            disabled={!valid || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending
              ? t('delivery.saving')
              : isNew
                ? t('delivery.create')
                : t('common.save')}
          </BarButton>
        </Box>
      </Box>

      <Box className="page-columns">
        <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0, width: '100%' }}>
          {/* Who it catches */}
          <Stack
            gap={16}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TargetIcon size={15} color={CYAN} />
              <CardCaption>{t('delivery.whoTitle')}</CardCaption>
            </Box>

            <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
              <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                <FieldLabel required>{t('delivery.fieldName')}</FieldLabel>
                <TextInput
                  placeholder="Happ"
                  value={draft.name}
                  onChange={(e) => patch({ name: e.currentTarget.value })}
                />
                <Hint>{t('delivery.fieldNameHint')}</Hint>
              </Stack>
              <Stack gap={6} style={{ width: 180, flexShrink: 0 }}>
                <FieldLabel>{t('delivery.fieldPriority')}</FieldLabel>
                <NumberInput
                  min={0}
                  max={10000}
                  allowDecimal={false}
                  allowNegative={false}
                  value={draft.priority}
                  onChange={(v) => patch({ priority: typeof v === 'number' ? v : '' })}
                />
                <Hint>{t('delivery.fieldPriorityHint')}</Hint>
              </Stack>
            </Box>

            <Stack gap={6} style={{ width: '100%' }}>
              <FieldLabel required>{t('delivery.fieldPattern')}</FieldLabel>
              <TextInput
                placeholder="(?i)happ"
                value={draft.uaPattern}
                error={draft.uaPattern.length > 0 && !patternOk}
                onChange={(e) => patch({ uaPattern: e.currentTarget.value })}
                styles={{ input: { fontFamily: MONO, fontSize: 13 } }}
              />
              {draft.uaPattern.length > 0 && !patternOk ? (
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: RED }}>
                  {t('delivery.patternInvalid')}
                </Text>
              ) : (
                <Hint>{t('delivery.fieldPatternHint')}</Hint>
              )}
            </Stack>

            <Box
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 14px',
                width: '100%',
                borderRadius: 10,
                backgroundColor: WELL,
                border: `1px solid ${HAIRLINE}`,
              }}
            >
              <Switch
                checked={draft.enabled}
                onChange={(e) => patch({ enabled: e.currentTarget.checked })}
                style={{ flexShrink: 0 }}
              />
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '17px', color: SNOW }}
                >
                  {t('delivery.fieldEnabled')}
                </Text>
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
                  {t('delivery.fieldEnabledHint')}
                </Text>
              </Stack>
            </Box>
          </Stack>

          {/* What it serves */}
          <Stack
            gap={0}
            style={{
              padding: 0,
              borderRadius: 10,
              backgroundColor: CARD,
              border: `1px solid ${HAIRLINE}`,
              overflow: 'hidden',
            }}
          >
            <Box
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '20px 20px 14px',
                width: '100%',
              }}
            >
              <FileIcon size={15} color={CYAN} />
              <CardCaption>{t('delivery.whatTitle')}</CardCaption>
              <Box style={{ flex: 1, minWidth: 0 }} />
              <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
                {t('delivery.whatHint')}
              </Text>
            </Box>

            {formats.map((f) => {
              const selected = draft.format === f;
              return (
                <UnstyledButton
                  key={f}
                  type="button"
                  onClick={() => patch({ format: f })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '11px 20px',
                    width: '100%',
                    textAlign: 'left',
                    backgroundColor: selected ? `${CYAN}0D` : 'transparent',
                    borderTop: `1px solid ${HAIRLINE}`,
                  }}
                >
                  <Box
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      border: `1px solid ${selected ? CYAN : DIM}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {selected && <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: CYAN }} />}
                  </Box>
                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      lineHeight: '16px',
                      color: selected ? formatTone(f) : MIST,
                      width: 150,
                      flexShrink: 0,
                    }}
                  >
                    {f}
                  </Text>
                  <Text
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 12,
                      lineHeight: '16px',
                      color: selected ? MIST : FAINT,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {t(`delivery.format.${f}`)}
                  </Text>
                  {/* A balancer cascade only survives in a format that expands
                      one entry into a server per exit. */}
                  {CASCADE_AWARE_FORMATS.includes(f) && (
                    <Box
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 22,
                        paddingInline: 8,
                        borderRadius: 6,
                        flexShrink: 0,
                        backgroundColor: `${MOSS}14`,
                        border: `1px solid ${MOSS}2E`,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          lineHeight: '12px',
                          textTransform: 'uppercase',
                          color: MOSS,
                        }}
                      >
                        {t('delivery.keepsExits')}
                      </Text>
                    </Box>
                  )}
                </UnstyledButton>
              );
            })}
          </Stack>
        </Box>

        <Box className="page-rail">
          {/* Test it now */}
          <Stack
            gap={12}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BoltIcon size={15} color={CYAN} />
              <CardCaption>{t('delivery.tryTitle')}</CardCaption>
            </Box>
            <TextInput
              placeholder="Happ/1.42.0 (iPhone; iOS 18.2)"
              value={testUa}
              onChange={(e) => setTestUa(e.currentTarget.value)}
              styles={{ input: { fontFamily: MONO, fontSize: 12, height: 38 } }}
            />
            {sample.length > 0 && patternOk && (
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 13px',
                  width: '100%',
                  borderRadius: 10,
                  backgroundColor: draftMatches ? `${MOSS}0F` : `${WELL}`,
                  border: `1px solid ${draftMatches ? `${MOSS}2E` : HAIRLINE}`,
                }}
              >
                {draftMatches ? <TickIcon size={14} color={MOSS} /> : <SlashIcon size={14} color={FAINT} />}
                <Text
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: 12,
                    lineHeight: '16px',
                    color: draftMatches ? MOSS : FAINT,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {draftMatches ? t('delivery.tryHit') : t('delivery.tryMiss')}
                </Text>
                {draftMatches && <FormatChip format={draft.format} />}
              </Box>
            )}
          </Stack>

          {/* Overlap */}
          <Stack
            gap={12}
            style={{
              padding: 20,
              borderRadius: 10,
              backgroundColor: CARD,
              border: `1px solid ${shadow || priorityClash ? `${AMBER}29` : HAIRLINE}`,
            }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <WarnIcon size={15} color={shadow || priorityClash ? AMBER : MIST} />
              <CardCaption>{t('delivery.overlapTitle')}</CardCaption>
            </Box>

            {shadow ? (
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: AMBER }}>
                {t('delivery.overlapShadowed', {
                  priority: shadow.priority,
                  name: shadow.name,
                  pattern: shadow.uaPattern,
                })}
              </Text>
            ) : sample.length > 0 && draftMatches ? (
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: MIST }}>
                {t('delivery.overlapClear')}
              </Text>
            ) : (
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: MIST }}>
                {t('delivery.overlapIdle')}
              </Text>
            )}

            {priorityClash && (
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: AMBER }}>
                {t('delivery.overlapTie', { name: priorityClash.name, priority })}
              </Text>
            )}

            {/* The panel does not refuse a shadowed rule: two regexes can
                overlap on some User-Agents and not others, so only the operator
                knows whether this one is dead or deliberate. */}
            <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
              {t('delivery.overlapNote')}
            </Text>
          </Stack>

          <Box
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '14px 16px',
              width: '100%',
              borderRadius: 10,
              backgroundColor: CARD,
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            <InfoIcon size={14} color={FAINT} />
            <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: FAINT, flex: 1 }}>
              {t('delivery.scopeNote')}
            </Text>
          </Box>
        </Box>
      </Box>
    </Stack>
  );
}

/** Where a new rule should sit: a step past the last real rule, but never at or
 *  behind a catch-all, which would make it unreachable. */
function nextPriority(rules: { priority: number; uaPattern: string }[]): number {
  const catchAlls = rules.filter((r) => isCatchAll(r.uaPattern)).map((r) => r.priority);
  const others = rules.filter((r) => !isCatchAll(r.uaPattern)).map((r) => r.priority);
  const next = (others.length > 0 ? Math.max(...others) : 90) + 10;
  const ceiling = catchAlls.length > 0 ? Math.min(...catchAlls) : Infinity;
  return next < ceiling ? next : Math.max(0, ceiling - 1);
}

/* ───── Pieces ──────────────────────────────────────────────────────────── */

function CardCaption({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.16em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}

function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.12em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color: MIST,
        }}
      >
        {children}
      </Text>
      {required && <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: RED }}>*</Text>}
    </Box>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{children}</Text>
  );
}

/* ───── Icons ───────────────────────────────────────────────────────────── */

function TargetIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0 -8" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M12 11.4a.6 .6 0 1 0 0 1.2a.6 .6 0 0 0 0 -1.2" fill={color} stroke={color} strokeWidth="1.4" />
    </svg>
  );
}

function FileIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M6 4h9l5 5v11a1 1 0 0 1 -1 1h-13a1 1 0 0 1 -1 -1v-15a1 1 0 0 1 1 -1"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 4v5h6" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

function PencilIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M4 20h4l10.5 -10.5a2.1 2.1 0 0 0 -3 -3L5 17v3"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SlashIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M6 6l12 12" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
