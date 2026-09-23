import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconBolt, IconEye, IconRefresh } from '@tabler/icons-react';
import type { PreviewKindKey } from '@/contours/profiles/lib/profileKinds';
import {
  EMPTY_TELEGRAM_DRAFT,
  WEB_CARRIERS,
  generateWebSecret,
  webLinkFacts,
  type TelegramDraft,
  type WebCarrier,
} from '@/contours/profiles/lib/telegramDraft';
import { SectionCard } from '@/contours/profiles/components/ProfileForm/SectionCard';

/**
 * The three Telegram views the backend does not know yet: SOCKS5, HTTP, WEB.
 *
 * The fields are real inputs (owner's call, 2026-09-23): an operator can fill
 * them in and see the form the way it will be. The values stay in this card's
 * own state and go nowhere, the server never sees or checks them, and the save
 * button on the page is off while one of these views is open. The banner says
 * so first, before anyone types.
 *
 * The draft lives here, not in the profile form: a preview view has no name
 * the API would accept, so it must not be able to reach a request body. One
 * draft for all three views, so switching between them keeps what was typed.
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
  const [draft, setDraft] = useState<TelegramDraft>(EMPTY_TELEGRAM_DRAFT);

  return (
    <SectionCard
      title={t(`profiles.telegramPreview.${COPY_KEY[kind]}.title`)}
      accent={accent}
      icon={<IconBolt size={15} color={accent} stroke={1.8} />}
    >
      <NotBuiltBanner />
      {kind === 'socks5' && (
        <Socks5Fields
          value={draft.socks5}
          onChange={(patch) => setDraft((d) => ({ ...d, socks5: { ...d.socks5, ...patch } }))}
        />
      )}
      {kind === 'http' && (
        <HttpFields
          value={draft.http}
          onChange={(patch) => setDraft((d) => ({ ...d, http: { ...d.http, ...patch } }))}
        />
      )}
      {kind === 'telegramweb' && (
        <WebFields
          value={draft.web}
          onChange={(patch) => setDraft((d) => ({ ...d, web: { ...d.web, ...patch } }))}
        />
      )}
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

function Socks5Fields({
  value,
  onChange,
}: {
  value: TelegramDraft['socks5'];
  onChange: (patch: Partial<TelegramDraft['socks5']>) => void;
}) {
  const { t } = useTranslation();
  const p = (k: string) => t(`profiles.telegramPreview.socks5.${k}`);
  return (
    <Row>
      <Field width={320} label={p('authLabel')} note={p('authNote')}>
        <Group gap={6} wrap="nowrap">
          <Choice accent={CYAN} active={value.auth === 'password'} onClick={() => onChange({ auth: 'password' })}>
            {p('authPassword')}
          </Choice>
          <Choice accent={CYAN} active={value.auth === 'none'} onClick={() => onChange({ auth: 'none' })}>
            {p('authNone')}
          </Choice>
        </Group>
      </Field>

      <Field width={200} label={t('profiles.telegramPreview.portLabel')} note={p('portNote')}>
        <PortInput label={t('profiles.telegramPreview.portLabel')} placeholder="1080" value={value.port} onChange={(port) => onChange({ port })} />
      </Field>

      <Field width={280} label={p('udpLabel')} note={p('udpNote')}>
        <Group style={{ height: 36 }} wrap="nowrap">
          <Switch
            checked={value.udp}
            onChange={(e) => onChange({ udp: e.currentTarget.checked })}
            label={value.udp ? p('udpOn') : p('udpOff')}
          />
        </Group>
      </Field>

      <WarnBox tone={CLAY}>{p('warn')}</WarnBox>
    </Row>
  );
}

function HttpFields({
  value,
  onChange,
}: {
  value: TelegramDraft['http'];
  onChange: (patch: Partial<TelegramDraft['http']>) => void;
}) {
  const { t } = useTranslation();
  const p = (k: string) => t(`profiles.telegramPreview.http.${k}`);
  return (
    <Stack gap={16}>
      <Row>
        <Field width={320} label={p('authLabel')} note={p('authNote')}>
          <Group gap={6} wrap="nowrap">
            <Choice accent={AMBER} active={value.auth === 'basic'} onClick={() => onChange({ auth: 'basic' })}>
              {p('authBasic')}
            </Choice>
            <Choice accent={AMBER} active={value.auth === 'none'} onClick={() => onChange({ auth: 'none' })}>
              {p('authNone')}
            </Choice>
          </Group>
        </Field>

        <Field width={280} label={t('profiles.telegramPreview.portLabel')} note={p('portNote')}>
          <PortInput label={t('profiles.telegramPreview.portLabel')} placeholder="8080" value={value.port} onChange={(port) => onChange({ port })} />
        </Field>

        <WarnBox tone={CLAY}>{p('warn')}</WarnBox>
      </Row>

      <WarnBox tone={AMBER}>{p('clients')}</WarnBox>
    </Stack>
  );
}

function WebFields({
  value,
  onChange,
}: {
  value: TelegramDraft['web'];
  onChange: (patch: Partial<TelegramDraft['web']>) => void;
}) {
  const { t } = useTranslation();
  const p = (k: string) => t(`profiles.telegramPreview.web.${k}`);
  const facts = webLinkFacts(value);
  const bad = facts.kind === 'bad' ? facts.field : null;

  return (
    <Stack gap={16}>
      <Row>
        <Field width={400} label={p('hostLabel')} note={p('hostNote')}>
          <TextInput
            aria-label={p('hostLabel')}
            placeholder={p('hostPlaceholder')}
            value={value.host}
            onChange={(e) => onChange({ host: e.currentTarget.value })}
            error={bad === 'host' ? p('hostBad') : undefined}
            styles={{ input: { fontFamily: MONO } }}
          />
        </Field>

        <Field width={430} label={p('keyLabel')} note={p('keyNote')}>
          <Group gap={8} wrap="nowrap" align="flex-start">
            <TextInput
              style={{ flex: 1, minWidth: 0 }}
              aria-label={p('keyLabel')}
              placeholder={p('keyPlaceholder')}
              value={value.secret}
              onChange={(e) => onChange({ secret: e.currentTarget.value })}
              error={bad === 'secret' ? p('keyBad') : undefined}
              styles={{ input: { fontFamily: MONO } }}
            />
            <UnstyledButton
              type="button"
              onClick={() => onChange({ secret: generateWebSecret() })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 36,
                paddingInline: 12,
                borderRadius: 8,
                backgroundColor: SUNK,
                border: `1px solid ${HAIRLINE}`,
                flexShrink: 0,
              }}
            >
              <IconRefresh size={13} color={MIST} stroke={1.8} />
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: SNOW }}>
                {p('keyGenerate')}
              </Text>
            </UnstyledButton>
          </Group>
        </Field>
      </Row>

      <Row>
        <Field width={300} label={p('pathLabel')} note={p('pathNote')}>
          <TextInput
            aria-label={p('pathLabel')}
            placeholder={p('pathPlaceholder')}
            value={value.path}
            onChange={(e) => onChange({ path: e.currentTarget.value })}
            error={bad === 'path' ? p('pathBad') : undefined}
            styles={{ input: { fontFamily: MONO } }}
          />
        </Field>

        <Field width={470} label={p('carrierLabel')} note={p(`carriers.${value.carrier}`)}>
          <SegmentedControl
            aria-label={p('carrierLabel')}
            value={value.carrier}
            onChange={(v) => onChange({ carrier: v as WebCarrier })}
            data={WEB_CARRIERS.map((c) => ({ value: c, label: c }))}
            styles={{ label: { fontFamily: MONO, fontSize: 11 } }}
          />
        </Field>
      </Row>

      <Field width={900} label={p('linkLabel')} note={p('linkNote')}>
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            minHeight: 38,
            paddingInline: 12,
            paddingBlock: 8,
            borderRadius: 8,
            backgroundColor: WELL,
            border: `1px solid ${HAIRLINE}`,
          }}
        >
          <Text
            style={{
              fontFamily: facts.kind === 'link' ? MONO : DISPLAY,
              fontSize: 12,
              lineHeight: '16px',
              color: facts.kind === 'link' ? SNOW : DIM,
              wordBreak: 'break-all',
            }}
          >
            {facts.kind === 'link' ? facts.link : facts.kind === 'wait' ? p('linkWait') : p('linkBad')}
          </Text>
        </Box>
      </Field>

      <WarnBox tone={AMBER}>{p('warn')}</WarnBox>

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

/** A port as the operator types it. Empty is a legal state here: nothing is
 *  sent, so there is no default to invent for them. */
function PortInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: number | '';
  onChange: (port: number | '') => void;
}) {
  return (
    <NumberInput
      aria-label={label}
      placeholder={placeholder}
      min={1}
      max={65535}
      clampBehavior="strict"
      allowDecimal={false}
      allowNegative={false}
      hideControls
      value={value}
      onChange={(v) => onChange(typeof v === 'number' ? v : '')}
      styles={{ input: { fontFamily: MONO } }}
    />
  );
}

/** One of two answers, pressed or not. A button, so the keyboard reaches it
 *  and the form does not submit on it. */
function Choice({
  children,
  accent,
  active,
  onClick,
}: {
  children: ReactNode;
  accent: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        height: 36,
        paddingInline: 14,
        borderRadius: 8,
        backgroundColor: active ? `${accent}14` : 'transparent',
        border: `1px solid ${active ? accent : HAIRLINE}`,
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
    </UnstyledButton>
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
