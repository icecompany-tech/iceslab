import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  NumberInput,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoutingPresetId } from '@iceslab/shared';
import { ROUTING_PRESET_IDS, presetKey } from '@/lib/domain/routing-presets';
import { apiErrorMessage } from '@/lib/net/client';
import { getSettings, updateSettings, type AdminSettings } from '@/lib/domain/settings';

/**
 * Everything `/sub/:token` says about itself, on one page: the headers a client
 * app reads alongside the config, the domain lists and raw rules that go into
 * the full-config formats, and the routing preset they sit on top of.
 *
 * One draft, one Save. The page used to carry four separate save buttons and two
 * save-on-change controls, which meant an operator could leave with half of an
 * edit applied and no way to tell which half.
 */

const HAIRLINE = '#1C2A3D';
const EDGE = '#2C3A4E';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const GROUND = '#08101A';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const CYAN2 = '#67E8F9';
const MOSS = '#A7D8B9';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

const PLACEHOLDERS = ['{{TRAFFIC_LEFT}}', '{{DAYS_LEFT}}', '{{SUPPORT_URL}}'] as const;

// Derived from the shared list rather than restated: the backend validates the
// saved value against the same array, so a preset added there shows up here
// without an edit, and one that is not there cannot be offered.
const PRESETS: { id: RoutingPresetId; title: string; hint: string }[] = ROUTING_PRESET_IDS.map(
  (id) => ({
    id,
    title: `metadata.preset${presetKey(id)}`,
    hint: `metadata.preset${presetKey(id)}Hint`,
  }),
);

/** The user the preview pretends to render for: a 50 GiB plan, part spent,
 *  expiring in under a fortnight. Fixed on purpose, so the preview shows the
 *  SHAPE of the headers rather than one real subscriber's numbers. */
const SAMPLE = { totalBytes: 53_687_091_200, usedBytes: 7_900_000_000, daysLeft: 12 };

interface Draft {
  profileTitle: string;
  intervalHours: number | '';
  supportUrl: string;
  announce: string;
  preset: RoutingPresetId;
  tlsFragment: boolean;
}

export function SubscriptionMetadataPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings', 'all'], queryFn: getSettings });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const announceRef = useRef<HTMLTextAreaElement>(null);

  // Seed once. Re-seeding on every refetch would throw away an edit in progress.
  if (!loaded && settingsQuery.data) {
    setLoaded(true);
    setDraft(toDraft(settingsQuery.data));
  }

  const saved = settingsQuery.data ? toDraft(settingsQuery.data) : null;
  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('nothing to save');
      // A partial update: the domain lists and the raw rules live on Routes now
      // and must not be touched from here, so they are simply absent.
      return updateSettings({
        subscriptionProfileTitle: draft.profileTitle.trim() || null,
        subscriptionUpdateIntervalHours:
          typeof draft.intervalHours === 'number' ? draft.intervalHours : 24,
        subscriptionSupportUrl: draft.supportUrl.trim() || null,
        subscriptionAnnounceTemplate: draft.announce.trim() || null,
        subscriptionRoutingPreset: draft.preset,
        subscriptionTlsFragment: draft.tlsFragment,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] });
      // Re-seed from what the server normalised, so the form never shows a
      // stale local value and the dirty marker settles.
      setLoaded(false);
      notifications.show({ color: 'green', message: t('metadata.saved') });
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) }),
  });

  if (!draft) {
    return (
      <Box style={{ padding: 40, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: MIST, textAlign: 'center' }}>
          {t('common.loading')}
        </Text>
      </Box>
    );
  }

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  // Bound once, because the narrowing above does not reach into the callbacks.
  const announce = draft.announce;

  /** Drop a placeholder where the caret is, rather than making the operator
   *  type the braces exactly right. */
  function insertPlaceholder(token: string) {
    const el = announceRef.current;
    if (!el) {
      patch({ announce: `${announce}${token}` });
      return;
    }
    const start = el.selectionStart ?? announce.length;
    const end = el.selectionEnd ?? start;
    const next = announce.slice(0, start) + token + announce.slice(end);
    patch({ announce: next });
    // Put the caret after what was just inserted, on the next frame so React
    // has written the new value first.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const canSave = dirty && !saveMutation.isPending;

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
            <BroadcastIcon size={18} color={CYAN} />
          </Box>
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {t('metadata.title')}
          </Text>
        </Box>

        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box className="page-bar-facts">
          <Text
            className="page-bar-fact-soft"
            style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}
          >
            {t('metadata.subtitle')}
          </Text>
          <Box style={{ flex: 1, minWidth: 0 }} />
          {/* Nothing here reaches a client until it asks again, which is the one
              thing an operator wants to know before pressing Save. */}
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 22,
              paddingInline: 9,
              borderRadius: 6,
              backgroundColor: WELL,
              border: `1px solid ${EDGE}`,
              flexShrink: 0,
            }}
          >
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
              {t('metadata.appliesOnFetch')}
            </Text>
          </Box>
        </Box>

        <Box className="page-bar-actions">
          <BarButton disabled={!dirty} onClick={() => saved && setDraft(saved)}>
            {t('metadata.reset')}
          </BarButton>
          <BarButton primary icon="tick" disabled={!canSave} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? t('metadata.saving') : t('common.save')}
          </BarButton>
        </Box>
      </Box>

      <Box className="page-columns">
        <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0, width: '100%' }}>
          {/* Headers */}
          <Stack
            gap={16}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BroadcastIcon size={15} color={CYAN} />
              <CardCaption>{t('metadata.headersTitle')}</CardCaption>
            </Box>

            <Stack gap={6}>
              <FieldLabel>{t('metadata.profileTitle')}</FieldLabel>
              <TextInput
                placeholder={settingsQuery.data?.brandName ?? 'Iceslab'}
                value={draft.profileTitle}
                onChange={(e) => patch({ profileTitle: e.currentTarget.value })}
              />
              <Hint>{t('metadata.profileTitleHint')}</Hint>
            </Stack>

            <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
              <Stack gap={6} style={{ width: 220, flexShrink: 0 }}>
                <FieldLabel>{t('metadata.interval')}</FieldLabel>
                <NumberInput
                  min={1}
                  max={168}
                  allowDecimal={false}
                  allowNegative={false}
                  value={draft.intervalHours}
                  onChange={(v) => patch({ intervalHours: typeof v === 'number' ? v : '' })}
                />
                <Hint>{t('metadata.intervalHint')}</Hint>
              </Stack>
              <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                <FieldLabel>{t('metadata.supportUrl')}</FieldLabel>
                <TextInput
                  placeholder="https://t.me/your_support"
                  value={draft.supportUrl}
                  onChange={(e) => patch({ supportUrl: e.currentTarget.value })}
                />
                <Hint>{t('metadata.supportUrlHint')}</Hint>
              </Stack>
            </Box>

            <Stack gap={6}>
              <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <FieldLabel>{t('metadata.announce')}</FieldLabel>
                <Box style={{ flex: 1, minWidth: 0 }} />
                {/* Clickable, because getting the braces wrong silently ships a
                    literal {{DAYS_LEFT}} to every client. */}
                {PLACEHOLDERS.map((p) => (
                  <UnstyledButton
                    key={p}
                    type="button"
                    onClick={() => insertPlaceholder(p)}
                    title={t('metadata.insertPlaceholder')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      height: 19,
                      paddingInline: 7,
                      borderRadius: 5,
                      flexShrink: 0,
                      backgroundColor: `${CYAN}14`,
                      border: `1px solid ${CYAN}2E`,
                    }}
                  >
                    <Text style={{ fontFamily: MONO, fontSize: 9, lineHeight: '11px', color: CYAN }}>{p}</Text>
                  </UnstyledButton>
                ))}
              </Box>
              <Textarea
                ref={announceRef}
                autosize
                minRows={2}
                maxRows={5}
                placeholder="Traffic left: {{TRAFFIC_LEFT}} · {{DAYS_LEFT}} days remaining · support {{SUPPORT_URL}}"
                value={draft.announce}
                onChange={(e) => patch({ announce: e.currentTarget.value })}
              />
              <Hint>{t('metadata.announceHint')}</Hint>
            </Stack>
          </Stack>
        </Box>

        <Box className="page-rail">
          {/* Preview */}
          <Stack
            gap={12}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <EyeIcon size={15} color={CYAN} />
              <CardCaption>{t('metadata.previewTitle')}</CardCaption>
            </Box>
            <Preview draft={draft} brandName={settingsQuery.data?.brandName ?? ''} />
            <Hint>{t('metadata.previewHint')}</Hint>
          </Stack>

          {/* Default preset. The choice is made here; what each preset
              actually contains belongs to Routes. */}
          <Stack
            gap={12}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <RouteIcon size={15} color={MOSS} />
              <CardCaption>{t('metadata.presetTitle')}</CardCaption>
            </Box>
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}>
              {t('metadata.presetHint')}
            </Text>
            {PRESETS.map((p) => (
              <PresetTile
                key={p.id}
                selected={draft.preset === p.id}
                title={t(p.title)}
                hint={t(p.hint)}
                onClick={() => patch({ preset: p.id })}
              />
            ))}
            <UnstyledButton
              type="button"
              onClick={() => navigate('/subscription/routes')}
              style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}
            >
              <ExternalIcon size={12} color={CYAN} />
              <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: CYAN }}>
                {t('metadata.presetEditLink')}
              </Text>
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
                {t('metadata.presetEditWhere')}
              </Text>
            </UnstyledButton>
          </Stack>

          {/* TLS fragment */}
          <Stack
            gap={12}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
              <ScissorsIcon size={15} color={CYAN2} />
              <CardCaption>{t('metadata.fragmentTitle')}</CardCaption>
              <Box style={{ flex: 1, minWidth: 0 }} />
              <Switch
                checked={draft.tlsFragment}
                onChange={(e) => patch({ tlsFragment: e.currentTarget.checked })}
              />
            </Box>
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}>
              {t('metadata.fragmentHint')}
            </Text>
          </Stack>
        </Box>
      </Box>
    </Stack>
  );
}

/* ───── Draft ───────────────────────────────────────────────────────────── */

function toDraft(s: AdminSettings): Draft {
  return {
    profileTitle: s.subscriptionProfileTitle ?? '',
    intervalHours: s.subscriptionUpdateIntervalHours ?? 24,
    supportUrl: s.subscriptionSupportUrl ?? '',
    announce: s.subscriptionAnnounceTemplate ?? '',
    preset: s.subscriptionRoutingPreset ?? 'proxy-all',
    tlsFragment: s.subscriptionTlsFragment ?? false,
  };
}

/* ───── Preview ─────────────────────────────────────────────────────────── */

/**
 * The response headers as `/sub/:token` would set them for the sample user.
 * Mirrors applySubscriptionHeaders + renderAnnounce: empty values omit their
 * header entirely, and the title falls back to the brand name.
 */
function Preview({ draft, brandName }: { draft: Draft; brandName: string }) {
  const { t } = useTranslation();
  const expire = useMemo(
    () => Math.floor(Date.now() / 1000) + SAMPLE.daysLeft * 86400,
    [],
  );
  const title = draft.profileTitle.trim() || brandName;
  const support = draft.supportUrl.trim();
  const announce = draft.announce
    .trim()
    .replaceAll('{{TRAFFIC_LEFT}}', formatBytes(SAMPLE.totalBytes - SAMPLE.usedBytes))
    .replaceAll('{{DAYS_LEFT}}', String(SAMPLE.daysLeft))
    .replaceAll('{{SUPPORT_URL}}', support);

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: '13px 14px',
        width: '100%',
        borderRadius: 10,
        backgroundColor: GROUND,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      {title ? (
        <HeaderLine name="Profile-Title" value={title} />
      ) : (
        <HeaderLine name="Profile-Title" value={t('metadata.omitted')} muted />
      )}
      <HeaderLine
        name="Profile-Update-Interval"
        value={String(typeof draft.intervalHours === 'number' ? draft.intervalHours : 24)}
      />
      {support ? (
        <HeaderLine name="Support-URL" value={support} />
      ) : (
        <HeaderLine name="Support-URL" value={t('metadata.omitted')} muted />
      )}
      {announce ? (
        <HeaderLine name="Announce" value={announce} />
      ) : (
        <HeaderLine name="Announce" value={t('metadata.omitted')} muted />
      )}
      {/* Not configurable here: it is derived from the user row. */}
      <HeaderLine
        name="Subscription-Userinfo"
        value={`upload=0; download=${SAMPLE.usedBytes}; total=${SAMPLE.totalBytes}; expire=${expire}`}
        muted
      />
    </Box>
  );
}

function HeaderLine({ name, value, muted }: { name: string; value: string; muted?: boolean }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'baseline', gap: 7, width: '100%' }}>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 11,
          lineHeight: '17px',
          color: muted ? FAINT : CYAN,
          flexShrink: 0,
        }}
      >
        {name}:
      </Text>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 11,
          lineHeight: '17px',
          color: muted ? FAINT : SNOW,
          flex: 1,
          minWidth: 0,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </Text>
    </Box>
  );
}

/** Same units the backend's formatBytes produces, so the announce preview reads
 *  exactly like the header will. */
function formatBytes(n: number): string {
  if (n < 0) return '0';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/* ───── Pieces ──────────────────────────────────────────────────────────── */


function PresetTile({
  selected,
  title,
  hint,
  onClick,
}: {
  selected: boolean;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: 13,
        width: '100%',
        borderRadius: 10,
        textAlign: 'left',
        backgroundColor: selected ? `${CYAN}0D` : WELL,
        border: `1px solid ${selected ? CYAN : HAIRLINE}`,
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
          marginTop: 2,
        }}
      >
        {selected && <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: CYAN }} />}
      </Box>
      <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: '17px',
            color: selected ? SNOW : MIST,
          }}
        >
          {title}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: selected ? MIST : FAINT }}>
          {hint}
        </Text>
      </Stack>
    </UnstyledButton>
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

function FieldLabel({ children }: { children: ReactNode }) {
  return (
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
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{children}</Text>
  );
}

/** Live verdict pill for the rules field. */
function BarButton({
  children,
  primary,
  icon,
  disabled,
  onClick,
}: {
  children: ReactNode;
  primary?: boolean;
  icon?: 'tick';
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
      {icon === 'tick' && (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path
            d="M5 12l5 5L20 7"
            fill="none"
            stroke={CYAN}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
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

/* ───── Icons ───────────────────────────────────────────────────────────── */

function BroadcastIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M5 6a1 1 0 0 1 1 -1c8.3 0 15 6.7 15 15a1 1 0 0 1 -1 1"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M5 12a1 1 0 0 1 1 -1a8 8 0 0 1 8 8a1 1 0 0 1 -1 1"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="6" cy="18" r="1.6" fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}


function EyeIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" fill="none" stroke={color} strokeWidth="1.8" />
      <path
        d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RouteIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="5.5" cy="18.5" r="2.5" fill="none" stroke={color} strokeWidth="1.9" />
      <circle cx="18.5" cy="5.5" r="2.5" fill="none" stroke={color} strokeWidth="1.9" />
      <path
        d="M5.5 16v-1.5a3.5 3.5 0 0 1 3.5 -3.5h6a3.5 3.5 0 0 0 3.5 -3.5v-1.5"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Arrow leaving a box: this opens another page. */
function ExternalIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ flexShrink: 0 }}>
      <path d="M4.5 1.5H10.5V7.5" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M10.5 1.5L5.5 6.5" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M9 8.5V10.5H1.5V3H3.5" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ScissorsIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="7" r="2.5" fill="none" stroke={color} strokeWidth="1.8" />
      <circle cx="6" cy="17" r="2.5" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M8.5 8.5L20 18" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.5 15.5L20 6" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
