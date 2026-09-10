import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Group, Stack, Text } from '@mantine/core';
import { IconBolt, IconEye } from '@tabler/icons-react';
import type { PreviewKindKey } from '@/contours/profiles/lib/profileKinds';
import { SectionCard } from '@/contours/profiles/components/ProfileForm/SectionCard';

/**
 * The three Telegram views the panel can draw but not yet create.
 *
 * They are drawn, not wired, and the card says so in the first line rather
 * than letting the operator find out at save time. Every control here is a
 * static box on purpose: a disabled input reads as "broken", a plain box reads
 * as "not built yet", and the difference is the whole point of the card.
 *
 * Nothing on this card is stored, sent or validated. When the backend learns
 * the protocol, the fields become real inputs in a section of their own and
 * this file loses that view.
 */

const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";
const DISPLAY =
  "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const WELL = '#08101A';
const SUNK = '#0B1420';
const HAIRLINE = '#1C2A3D';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const DIM = '#4E5F76';
const AMBER = '#F5B14C';
const CLAY = '#E07A5F';
const CYAN = '#67E8F9';

/** Card accents follow the artboard, which paints WEB amber rather than
 *  Telegram blue: the top edge here carries the risk, not the brand. */
const CARD_ACCENT: Record<PreviewKindKey, string> = {
  socks5: CYAN,
  http: AMBER,
  telegramweb: AMBER,
};

/** The key is `telegramweb` in the picker, where it sits next to protocol
 *  names; the copy calls it `web`, the way the Telegram client does. */
const COPY_KEY: Record<PreviewKindKey, string> = {
  socks5: 'socks5',
  http: 'http',
  telegramweb: 'web',
};

export function TelegramPreviewCard({ kind }: { kind: PreviewKindKey }) {
  const { t } = useTranslation();
  const accent = CARD_ACCENT[kind];

  return (
    <SectionCard
      title={t(`profiles.telegramPreview.${COPY_KEY[kind]}.title`)}
      accent={accent}
      icon={<IconBolt size={15} color={accent} stroke={1.8} />}
    >
      <NotBuiltBanner />
      {kind === 'socks5' && <Socks5Fields />}
      {kind === 'http' && <HttpFields />}
      {kind === 'telegramweb' && <WebFields />}
    </SectionCard>
  );
}

/** Says the thing once, at the top, where a decision is still cheap. */
function NotBuiltBanner() {
  const { t } = useTranslation();
  return (
    <Group
      gap={10}
      align="flex-start"
      wrap="nowrap"
      style={{
        padding: '12px 14px',
        borderRadius: 8,
        backgroundColor: `${AMBER}0F`,
        border: `1px solid ${AMBER}33`,
      }}
    >
      <IconEye size={15} color={AMBER} stroke={1.8} style={{ flexShrink: 0, marginTop: 1 }} />
      <Stack gap={4} style={{ minWidth: 0 }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 500, lineHeight: '17px', color: AMBER }}>
          {t('profiles.telegramPreview.banner')}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: MIST }}>
          {t('profiles.telegramPreview.bannerHint')}
        </Text>
      </Stack>
    </Group>
  );
}

function Socks5Fields() {
  const { t } = useTranslation();
  const p = (k: string) => t(`profiles.telegramPreview.socks5.${k}`);
  return (
    <Row>
      <Field width={320} label={p('authLabel')} note={p('authNote')}>
        <Group gap={6} wrap="nowrap">
          <Pill accent={CYAN} active>
            {p('authPassword')}
          </Pill>
          <Pill>{p('authNone')}</Pill>
        </Group>
      </Field>

      <Field width={280} label={p('udpLabel')} note={p('udpNote')}>
        <Group gap={10} wrap="nowrap" style={{ height: 36 }}>
          <Switch accent={CYAN} />
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: SNOW }}>
            {p('udpOn')}
          </Text>
        </Group>
      </Field>

      <WarnBox tone={CLAY}>{p('warn')}</WarnBox>
    </Row>
  );
}

function HttpFields() {
  const { t } = useTranslation();
  const p = (k: string) => t(`profiles.telegramPreview.http.${k}`);
  return (
    <Row>
      <Field width={320} label={p('authLabel')} note={p('authNote')}>
        <Group gap={6} wrap="nowrap">
          <Pill accent={AMBER} active>
            {p('authBasic')}
          </Pill>
          <Pill>{p('authNone')}</Pill>
        </Group>
      </Field>

      <Field width={280} label={p('tunnelLabel')} note={p('tunnelNote')}>
        <ReadOnlyBox>
          <Text style={{ fontFamily: MONO, fontSize: 12, lineHeight: '16px', color: SNOW }}>
            {p('tunnelValue')}
          </Text>
        </ReadOnlyBox>
      </Field>

      <WarnBox tone={CLAY}>{p('warn')}</WarnBox>
    </Row>
  );
}

function WebFields() {
  const { t } = useTranslation();
  const p = (k: string) => t(`profiles.telegramPreview.web.${k}`);
  return (
    <Stack gap={16}>
      <Row>
        <Field width={400} label={p('hostLabel')} note={p('hostNote')}>
          <ReadOnlyBox height={38}>
            <Text style={{ fontFamily: MONO, fontSize: 12, lineHeight: '16px', color: '#5A6B82' }}>
              {p('hostPlaceholder')}
            </Text>
          </ReadOnlyBox>
        </Field>

        <Field width={430} label={p('keyLabel')} note={p('keyNote')}>
          <ReadOnlyBox height={38}>
            <Group gap={10} wrap="nowrap" justify="space-between" style={{ width: '100%' }}>
              <Text style={{ fontFamily: MONO, fontSize: 12, lineHeight: '16px', color: '#5A6B82' }}>
                {p('keyPlaceholder')}
              </Text>
              <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '14px', color: DIM }}>
                {p('keyHint')}
              </Text>
            </Group>
          </ReadOnlyBox>
        </Field>

        <WarnBox tone={AMBER}>{p('warn')}</WarnBox>
      </Row>

      {/* What the node would actually run. Three layers instead of one daemon
          is the whole reason this view is not simply another protocol. */}
      <Stack
        gap={14}
        style={{
          padding: 16,
          borderRadius: 10,
          backgroundColor: SUNK,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Group gap={10} wrap="nowrap">
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
            {p('stackTitle')}
          </Text>
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: DIM, minWidth: 0 }}>
            {p('stackHint')}
          </Text>
        </Group>

        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', flexWrap: 'wrap' }}>
          <Layer name="Caddy" where={p('caddyPort')} />
          <Arrow />
          <Layer name="tproxy-server" where={p('relayPort')} />
          <Arrow />
          <Layer name="MTProxy" where={p('mtproxyPort')} />
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              flexBasis: 0,
              flexGrow: 2,
              minWidth: 220,
              padding: 12,
              borderRadius: 8,
              backgroundColor: `${CLAY}0F`,
              border: `1px solid ${CLAY}33`,
            }}
          >
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: CLAY }}>
              {p('portWarn')}
            </Text>
          </Box>
        </Box>
      </Stack>
    </Stack>
  );
}

/** The artboard lays the fields in one elastic row that wraps on narrow pages
 *  rather than clipping: the profile page gives up 380px to the recipe rail. */
function Row({ children }: { children: ReactNode }) {
  return (
    <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 26, width: '100%' }}>{children}</Box>
  );
}

function Field({
  width,
  label,
  note,
  children,
}: {
  width: number;
  label: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <Stack gap={7} style={{ width, flexShrink: 0, maxWidth: '100%' }}>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: MIST,
        }}
      >
        {label}
      </Text>
      {children}
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: DIM }}>
        {note}
      </Text>
    </Stack>
  );
}

function Pill({
  children,
  accent,
  active,
}: {
  children: ReactNode;
  accent?: string;
  active?: boolean;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        height: 36,
        paddingInline: 14,
        borderRadius: 8,
        backgroundColor: active && accent ? `${accent}14` : 'transparent',
        border: `1px solid ${active && accent ? accent : HAIRLINE}`,
      }}
    >
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 12,
          fontWeight: active ? 500 : 400,
          lineHeight: '16px',
          color: active ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
    </Box>
  );
}

function Switch({ accent }: { accent: string }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        width: 36,
        height: 20,
        padding: 2,
        borderRadius: 999,
        backgroundColor: accent,
        flexShrink: 0,
      }}
    >
      <Box style={{ width: 16, height: 16, borderRadius: 999, backgroundColor: WELL }} />
    </Box>
  );
}

function ReadOnlyBox({ children, height = 36 }: { children: ReactNode; height?: number }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        height,
        paddingInline: 12,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      {children}
    </Box>
  );
}

function WarnBox({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <Group
      gap={10}
      align="flex-start"
      wrap="nowrap"
      style={{
        flexBasis: 0,
        flexGrow: 1,
        minWidth: 260,
        padding: 12,
        borderRadius: 8,
        backgroundColor: `${tone}0F`,
        border: `1px solid ${tone}33`,
      }}
    >
      <Box
        style={{
          width: 5,
          height: 5,
          marginTop: 6,
          borderRadius: 999,
          backgroundColor: tone,
          flexShrink: 0,
        }}
      />
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: SNOW, minWidth: 0 }}>
        {children}
      </Text>
    </Group>
  );
}

function Layer({ name, where }: { name: string; where: string }) {
  return (
    <Stack
      gap={5}
      align="center"
      style={{
        flexBasis: 0,
        flexGrow: 1,
        minWidth: 130,
        padding: 12,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 12, lineHeight: '16px', color: SNOW }}>{name}</Text>
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '13px', color: DIM }}>{where}</Text>
    </Stack>
  );
}

function Arrow() {
  return (
    <Text style={{ fontFamily: DISPLAY, fontSize: 14, lineHeight: '18px', color: DIM, flexShrink: 0 }}>
      →
    </Text>
  );
}
