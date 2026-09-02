import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Box, Stack, Switch, Text, TextInput, UnstyledButton } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, deleteSrrRule, listSrrRules, updateSrrRule, type SrrRule } from '../lib/api';
import { SRR_FORMATS, formatTone } from '../lib/srrFormats';
import { compilePattern, matchingRules } from '../lib/srrMatch';
import { usePageMeta } from '../hooks/usePageMeta';

/**
 * Delivery rules: which config FORMAT each client app gets. One regex over the
 * User-Agent per rule, walked in priority order, first match wins.
 *
 * The table is the page, because the order of these rows IS the behaviour. The
 * tester underneath answers the only question an operator ever has about a rule
 * set this shape: given this client, which rule catches it.
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

const DISPLAY = "'Space Grotesk Variable', 'Space Grotesk', 'Inter Variable', Inter, sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

export function SrrPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const rulesQuery = useQuery({ queryKey: ['srr'], queryFn: listSrrRules });
  const rules = useMemo(
    () => [...(rulesQuery.data?.rules ?? [])].sort((a, b) => a.priority - b.priority),
    [rulesQuery.data],
  );

  usePageMeta([]);

  const onError = (err: unknown) =>
    notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) });

  // Optimistic so rapid on/off feels instant; rolls back on failure. No success
  // toast: the switch position is the confirmation.
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateSrrRule(id, { enabled }),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: ['srr'] });
      const prev = qc.getQueryData<{ rules: SrrRule[] }>(['srr']);
      if (prev) {
        qc.setQueryData<{ rules: SrrRule[] }>(['srr'], {
          rules: prev.rules.map((r) => (r.id === id ? { ...r, enabled } : r)),
        });
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['srr'], ctx.prev);
      onError(err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['srr'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSrrRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['srr'] });
      notifications.show({ color: 'green', message: t('delivery.deleted') });
    },
    onError,
  });

  function confirmDelete(rule: SrrRule) {
    modals.openConfirmModal({
      title: t('delivery.deleteTitle', { name: rule.name }),
      children: <Text size="sm">{t('delivery.deleteBody')}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(rule.id),
    });
  }

  // ─── Tester ───
  const [testUa, setTestUa] = useState('');
  const [tested, setTested] = useState<string | null>(null);
  const hits = useMemo(() => (tested ? matchingRules(rules, tested) : []), [rules, tested]);
  const winner = hits[0] ?? null;

  const enabledCount = rules.filter((r) => r.enabled).length;

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
            <FunnelIcon size={18} color={CYAN} />
          </Box>
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {t('delivery.title')}
          </Text>
        </Box>

        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box className="page-bar-facts">
          <Fact value={rules.length} label={t('delivery.factRules')} />
          <Dot />
          <Fact value={enabledCount} label={t('delivery.factEnabled')} accent={MOSS} />
          <Dot soft />
          <Text
            className="page-bar-fact-soft"
            style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}
          >
            {t('delivery.subtitle')}
          </Text>
          <Box style={{ flex: 1, minWidth: 0 }} />
        </Box>

        <Box className="page-bar-actions">
          <IconAction
            title={t('common.refresh')}
            onClick={() => qc.invalidateQueries({ queryKey: ['srr'] })}
          >
            <RefreshIcon size={16} color={rulesQuery.isFetching ? CYAN : MIST} />
          </IconAction>
          <BarButton primary icon="plus" onClick={() => navigate('/subscription/delivery/new')}>
            {t('delivery.create')}
          </BarButton>
        </Box>
      </Box>

      <Box className="page-columns">
        <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0, width: '100%' }}>
          {/* The rules, in evaluation order */}
          <Box
            style={{
              borderRadius: 10,
              backgroundColor: CARD,
              border: `1px solid ${HAIRLINE}`,
              overflow: 'hidden',
              width: '100%',
            }}
          >
            <Box
              className="delivery-row"
              style={{
                height: 38,
                paddingInline: 18,
                backgroundColor: WELL,
                borderBottom: `1px solid ${HAIRLINE}`,
              }}
            >
              <ColHead width={64}>{t('delivery.colPriority')}</ColHead>
              <ColHead width={200}>{t('delivery.colName')}</ColHead>
              <ColHead flex>{t('delivery.colPattern')}</ColHead>
              <ColHead width={170}>{t('delivery.colFormat')}</ColHead>
              <ColHead width={70}>{t('delivery.colEnabled')}</ColHead>
              <ColHead width={66}>{t('common.actions')}</ColHead>
            </Box>

            {rules.length === 0 && (
              <Box style={{ padding: '28px 18px' }}>
                <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: MIST, textAlign: 'center' }}>
                  {rulesQuery.isLoading ? t('common.loading') : t('delivery.empty')}
                </Text>
              </Box>
            )}

            {rules.map((rule, i) => {
              const off = !rule.enabled;
              const catchAll = isCatchAll(rule.uaPattern);
              // The rule the tester just landed on gets the raised surface, so
              // the answer is visible in the list rather than only under it.
              const highlight = winner?.id === rule.id;
              return (
                <Box
                  key={rule.id}
                  className="delivery-row"
                  style={{
                    paddingBlock: 12,
                    paddingInline: 18,
                    backgroundColor: highlight ? RAISED : 'transparent',
                    borderBottom: i === rules.length - 1 ? undefined : `1px solid ${HAIRLINE}`,
                  }}
                >
                  <Box style={{ width: 64, flexShrink: 0, display: 'flex' }}>
                    <Box
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 22,
                        paddingInline: 8,
                        borderRadius: 6,
                        backgroundColor: catchAll ? `${AMBER}14` : WELL,
                        border: `1px solid ${catchAll ? `${AMBER}2E` : HAIRLINE}`,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: MONO,
                          fontSize: 11,
                          lineHeight: '14px',
                          color: catchAll ? AMBER : off ? FAINT : SNOW,
                        }}
                      >
                        {rule.priority}
                      </Text>
                    </Box>
                  </Box>

                  <Box
                    style={{
                      width: 200,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: DISPLAY,
                        fontSize: 13,
                        fontWeight: 500,
                        lineHeight: '17px',
                        color: off ? FAINT : SNOW,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {rule.name}
                    </Text>
                    {catchAll && (
                      <Box
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          height: 18,
                          paddingInline: 6,
                          borderRadius: 5,
                          flexShrink: 0,
                          backgroundColor: WELL,
                          border: `1px solid ${HAIRLINE}`,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: MONO,
                            fontSize: 9,
                            letterSpacing: '0.08em',
                            lineHeight: '11px',
                            textTransform: 'uppercase',
                            color: FAINT,
                          }}
                        >
                          {t('delivery.catchAll')}
                        </Text>
                      </Box>
                    )}
                  </Box>

                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      lineHeight: '16px',
                      color: off ? FAINT : MIST,
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {rule.uaPattern}
                  </Text>

                  <Box style={{ width: 170, flexShrink: 0, display: 'flex' }}>
                    <FormatChip format={rule.format} muted={off} />
                  </Box>

                  <Box style={{ width: 70, flexShrink: 0 }}>
                    <Switch
                      checked={rule.enabled}
                      onChange={(e) =>
                        toggleMutation.mutate({ id: rule.id, enabled: e.currentTarget.checked })
                      }
                      aria-label={t('delivery.colEnabled')}
                    />
                  </Box>

                  <Box style={{ width: 66, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <UnstyledButton
                      type="button"
                      title={t('common.edit')}
                      onClick={() => navigate(`/subscription/delivery/${rule.id}`)}
                      style={{ display: 'flex' }}
                    >
                      <PencilIcon size={15} color={MIST} />
                    </UnstyledButton>
                    <UnstyledButton
                      type="button"
                      title={t('common.delete')}
                      onClick={() => confirmDelete(rule)}
                      style={{ display: 'flex' }}
                    >
                      <TrashIcon size={15} color={RED} />
                    </UnstyledButton>
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Tester */}
          <Stack
            gap={14}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
              <BoltIcon size={15} color={CYAN} />
              <CardCaption>{t('delivery.testTitle')}</CardCaption>
              <Text
                style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT, flex: 1, minWidth: 0 }}
              >
                {t('delivery.testHint')}
              </Text>
            </Box>

            <Box style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
              <TextInput
                style={{ flex: 1, minWidth: 0 }}
                placeholder="Happ/1.42.0 (iPhone; iOS 18.2)"
                value={testUa}
                onChange={(e) => setTestUa(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && setTested(testUa.trim() || null)}
                styles={{ input: { fontFamily: MONO, fontSize: 12, height: 38 } }}
              />
              <BarButton
                disabled={testUa.trim().length === 0}
                onClick={() => setTested(testUa.trim() || null)}
              >
                {t('delivery.testButton')}
              </BarButton>
            </Box>

            {tested !== null &&
              (winner ? (
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 14px',
                    width: '100%',
                    borderRadius: 10,
                    backgroundColor: `${MOSS}0F`,
                    border: `1px solid ${MOSS}2E`,
                  }}
                >
                  <TickIcon size={14} color={MOSS} />
                  <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MOSS }}>
                    {t('delivery.testMatch', { priority: winner.priority, name: winner.name })}
                  </Text>
                  <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: FAINT }}>
                    {'->'}
                  </Text>
                  <FormatChip format={winner.format} />
                  <Box style={{ flex: 1, minWidth: 0 }} />
                  {/* Everything below the winner never runs for this client. */}
                  {hits.length > 1 && (
                    <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>
                      {t('delivery.testShadowed', { count: hits.length - 1 })}
                    </Text>
                  )}
                </Box>
              ) : (
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 14px',
                    width: '100%',
                    borderRadius: 10,
                    backgroundColor: `${AMBER}0D`,
                    border: `1px solid ${AMBER}29`,
                  }}
                >
                  <WarnIcon size={14} color={AMBER} />
                  <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: AMBER }}>
                    {t('delivery.testNoMatch')}
                  </Text>
                </Box>
              ))}
          </Stack>
        </Box>

        <Box className="page-rail">
          <Stack
            gap={12}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <InfoIcon size={15} color={MIST} />
              <CardCaption>{t('delivery.howTitle')}</CardCaption>
            </Box>
            <Rule>{t('delivery.how1')}</Rule>
            <Rule>{t('delivery.how2')}</Rule>
            <Rule tone={AMBER}>{t('delivery.how3')}</Rule>
          </Stack>

          <Stack
            gap={12}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileIcon size={15} color={CYAN} />
              <CardCaption>{t('delivery.formatsTitle')}</CardCaption>
            </Box>
            <Box
              style={{
                borderRadius: 10,
                backgroundColor: WELL,
                border: `1px solid ${HAIRLINE}`,
                overflow: 'hidden',
                width: '100%',
              }}
            >
              {SRR_FORMATS.map((f, i) => (
                <Box
                  key={f}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 13px',
                    width: '100%',
                    borderTop: i === 0 ? undefined : `1px solid ${HAIRLINE}`,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      lineHeight: '14px',
                      color: formatTone(f),
                      width: 118,
                      flexShrink: 0,
                    }}
                  >
                    {f}
                  </Text>
                  <Text
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 11,
                      lineHeight: '15px',
                      color: MIST,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {t(`delivery.format.${f}`)}
                  </Text>
                </Box>
              ))}
            </Box>
          </Stack>
        </Box>
      </Box>
    </Stack>
  );
}

/**
 * A pattern that matches every User-Agent. An unanchored regex matching the
 * empty string matches any input, since the empty match can be found anywhere;
 * the second probe rules out anchored `^$`, which matches only the empty one.
 */
export function isCatchAll(pattern: string): boolean {
  // An empty field is not a catch-all, it is an unfinished rule, even though
  // the empty regex would technically match anything.
  if (pattern.length === 0) return false;
  const re = compilePattern(pattern);
  return re !== null && re.test('') && re.test('Mozilla/5.0');
}

/* ───── Pieces ──────────────────────────────────────────────────────────── */

export function FormatChip({ format, muted }: { format: string; muted?: boolean }) {
  const tone = muted ? FAINT : formatTone(format);
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 22,
        paddingInline: 8,
        borderRadius: 6,
        flexShrink: 0,
        backgroundColor: muted ? WELL : `${tone}1A`,
        border: `1px solid ${muted ? EDGE : `${tone}33`}`,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', lineHeight: '12px', color: tone }}>
        {format}
      </Text>
    </Box>
  );
}

function ColHead({ children, width, flex }: { children: ReactNode; width?: number; flex?: boolean }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.12em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
        width,
        flex: flex ? 1 : undefined,
        minWidth: flex ? 0 : undefined,
        flexShrink: flex ? 1 : 0,
      }}
    >
      {children}
    </Text>
  );
}

function Fact({ value, label, accent }: { value: number; label: string; accent?: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
      <Text
        style={{ fontFamily: MONO, fontSize: 15, fontWeight: 500, lineHeight: '18px', color: accent ?? SNOW }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.12em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color: MIST,
        }}
      >
        {label}
      </Text>
    </Box>
  );
}

function Dot({ soft }: { soft?: boolean }) {
  return (
    <Text
      className={soft ? 'page-bar-fact-soft' : undefined}
      style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM, flexShrink: 0 }}
    >
      ·
    </Text>
  );
}

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

function Rule({ children, tone = CYAN }: { children: ReactNode; tone?: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 9, width: '100%' }}>
      <Box style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: tone, marginTop: 6, flexShrink: 0 }} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: MIST, flex: 1, minWidth: 0 }}>
        {children}
      </Text>
    </Box>
  );
}

export function BarButton({
  children,
  primary,
  icon,
  disabled,
  onClick,
}: {
  children: ReactNode;
  primary?: boolean;
  icon?: 'plus' | 'tick';
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 38,
        paddingInline: 16,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {icon === 'plus' && <PlusIcon size={14} color={CYAN} />}
      {icon === 'tick' && <TickIcon size={14} color={CYAN} />}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '16px',
          color: primary ? SNOW : MIST,
        }}
      >
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
  onClick?: () => void;
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
        width: 38,
        height: 38,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
      }}
    >
      {children}
    </UnstyledButton>
  );
}

/* ───── Icons ───────────────────────────────────────────────────────────── */

export function FunnelIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M4 4h16l-6 8v6l-4 2v-8z"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BoltIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M13 3l-9 10.5h7l-1 7.5l9 -10.5h-7z"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TickIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M5 12l5 5L20 7"
        fill="none"
        stroke={color}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WarnIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 9v4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

export function InfoIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
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

function RefreshIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M20 11a8 8 0 1 0 -2.3 6"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M20 5v6h-6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
