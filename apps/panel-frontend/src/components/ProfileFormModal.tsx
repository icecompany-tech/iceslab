import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  Alert,
  Button,
  Card,
  Chip,
  Divider,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconBolt, IconKey } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import {
  generateInboundKeypair,
  type CreateProfileInput,
  type Profile,
  type ProtocolName,
  type UpdateProfileInput,
} from '../lib/api';
import { RecipePicker } from './RecipePicker';
import { validateXrayConfig } from '../lib/recipes';
import { PROTOCOL_OPTIONS, protocolLabel } from '../lib/protocols';

// Xray stream transports. The whole stack already handles all six (Zod schema,
// node config.go renderer, client URI builder) - this is just the operator-
// facing picker that previously surfaced only raw/xhttp/grpc.
const XRAY_TRANSPORTS: { value: string; label: string; hint: string }[] = [
  { value: 'raw', label: 'raw', hint: 'Plain TCP. Canonical REALITY + Vision, best latency, no CDN.' },
  { value: 'ws', label: 'ws', hint: 'WebSocket. CDN-frontable (Cloudflare etc). Set path + host.' },
  { value: 'grpc', label: 'gRPC', hint: 'HTTP/2 multiplexed. CDN-frontable. Set a serviceName.' },
  { value: 'xhttp', label: 'xhttp', hint: 'Chunked HTTP (ex-SplitHTTP). CDN-frontable, Vision-compatible.' },
  { value: 'httpupgrade', label: 'httpupgrade', hint: 'HTTP Upgrade. WebSocket-like without the WS handshake overhead.' },
  { value: 'kcp', label: 'mKCP', hint: 'UDP-based, resilient on lossy links. Do not share a UDP port with Hysteria/AWG.' },
];

// Vision flow is only valid on raw/xhttp; other transports reject it.
const FLOW_COMPATIBLE_TRANSPORTS = ['raw', 'xhttp'];
// path + host header apply to these transports (same URI param names).
const PATH_HOST_TRANSPORTS = ['ws', 'xhttp', 'httpupgrade'];

// Profile protocol dropdown = the real protocols + a disabled sing-box teaser
// inserted right after xray (roadmap signal: sing-box engine is coming, not
// selectable yet). Kept LOCAL to this form on purpose: the shared
// PROTOCOL_OPTIONS drives squad per-protocol groupings, dividers, and
// protocolLabel, where a fake protocol would create an empty "sing-box" group.
// The sentinel value is non-selectable, so it never reaches form state.
const PROFILE_PROTOCOL_SELECT_DATA = [
  PROTOCOL_OPTIONS[0], // xray
  { value: '__singbox_soon', label: 'sing-box (soon)', disabled: true },
  ...PROTOCOL_OPTIONS.slice(1),
];

type Mode = 'create' | 'edit';

interface FormValues {
  protocol: ProtocolName;
  name: string;
  description: string;
  enabled: boolean;

  // Hysteria
  hyObfsPassword: string;
  hyMasqueradeUrl: string;
  hyBrutalUp: number | '';
  hyBrutalDown: number | '';
  hyPortHopStart: number | '';
  hyPortHopEnd: number | '';

  // Xray
  xrayDest: string;
  xrayServerNames: string;
  xrayShortIds: string;
  xrayPrivateKey: string;
  xrayPublicKey: string;
  xrayRealityMode: 'steal-others' | 'self-steal';
  xrayFlow: string;
  xrayFingerprint: string;
  xrayNetwork: 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp';
  xrayPath: string;
  xrayHostHeader: string;
  xrayServiceName: string;
  xraySubprotocol: 'vless' | 'trojan' | 'vmess';
  xraySecurity: 'reality' | 'none' | 'tls';
  xrayTlsServerName: string;
  xrayTlsCert: string;
  xrayTlsKey: string;

  // AmneziaWG
  awgSubnet: string;
  awgServerPriv: string;
  awgServerPub: string;
  awgPreset: 'tspu' | 'mobile' | 'custom';
  awgJc: number | '';
  awgJmin: number | '';
  awgJmax: number | '';
  awgS1: number | '';
  awgS2: number | '';
  awgS3: number | '';
  awgS4: number | '';
  awgH1: number | '';
  awgH2: number | '';
  awgH3: number | '';
  awgH4: number | '';
  awgI1: string;
  awgI2: string;
  awgI3: string;
  awgI4: string;
  awgI5: string;

  // Naive
  naiveHostname: string;
  naiveTlsEmail: string;
  naiveMasquerade: string;

  // Shadowsocks
  ssMethod:
    | '2022-blake3-aes-128-gcm'
    | '2022-blake3-aes-256-gcm'
    | '2022-blake3-chacha20-poly1305'
    | 'chacha20-ietf-poly1305'
    | 'aes-256-gcm'
    | 'aes-128-gcm';

  // MTProto
  mtgDomain: string;

  // Mieru
  mieruMtu: number | '';
}

// Values bounded by upstream AmneziaWG v2.0 spec (docs.amnezia.org):
//   - Jc 0..10, Jmin/Jmax 64..1024, S1-S3 0..64, S4 0..32
//
// S3 and S4 forced to ZERO due to upstream bug
// https://github.com/amnezia-vpn/amnezia-client/issues/2582 -
// AmneziaVPN client 4.8.15.x (Android + iOS, awg-go v0.2.16 under
// the hood) DROPS all transport traffic when server has non-zero
// S3/S4. Connection reaches "CONNECTED" state but handshake retries
// forever and zero bytes flow. Bug open since Feb 2026, claimed
// fixed in 4.8.12.9 but persisted into 4.8.15.5. Reproduced live
// on iOS 26.4 client cycle #6 2026-05-13 with our awg-VPS - same
// "Connected, but no traffic, handshake retries every 5s" symptom.
// Workaround: server must set S3=0 S4=0. Lift these defaults to
// non-zero again when upstream fixes the client.
//
// S1 and S2 stay non-zero - they were in AmneziaWG since v1.5, the
// bug only affects the v2.0-added S3+S4 fields. Junk-packet (Jc)
// obfuscation also remains active.
const TSPU_PRESET = { jc: 4, jmin: 64, jmax: 128, s1: 32, s2: 56, s3: 0, s4: 0 };
const MOBILE_PRESET = { jc: 3, jmin: 64, jmax: 100, s1: 32, s2: 56, s3: 0, s4: 0 };

/**
 * AmneziaWG H1-H4 magic-header bytes. Spec says they must be:
 *   - strictly > 4 (1-4 are reserved for actual WireGuard message types)
 *   - pairwise distinct (otherwise DPI sees repeated patterns)
 *   - random in int32 range so they don't fingerprint Iceslab deployments
 *
 * Replaces the previous "run `shuf -i 5-2147483647 -n 4` yourself" admin
 * hint - admin shouldn't need a shell to set up obfuscation.
 */
function randomAwgHeaders(): { h1: number; h2: number; h3: number; h4: number } {
  const seen = new Set<number>();
  const vals: number[] = [];
  while (vals.length < 4) {
    // Math.random() floors to int32 max ≈ 2.14e9. Skip 1-4 as required.
    const n = 5 + Math.floor(Math.random() * (2_147_483_643 - 5));
    if (!seen.has(n)) {
      seen.add(n);
      vals.push(n);
    }
  }
  return { h1: vals[0]!, h2: vals[1]!, h3: vals[2]!, h4: vals[3]! };
}

function defaults(profile: Profile | null): FormValues {
  const base: FormValues = {
    protocol: profile?.protocol ?? 'hysteria',
    name: profile?.name ?? '',
    description: profile?.description ?? '',
    enabled: profile?.enabled ?? true,

    hyObfsPassword: '',
    hyMasqueradeUrl: '',
    hyBrutalUp: '',
    hyBrutalDown: '',
    hyPortHopStart: '',
    hyPortHopEnd: '',

    xrayDest: 'www.cloudflare.com:443',
    xrayServerNames: 'www.cloudflare.com',
    xrayShortIds: '',
    xrayPrivateKey: '',
    xrayPublicKey: '',
    xrayRealityMode: 'steal-others',
    xrayFlow: 'xtls-rprx-vision',
    xrayFingerprint: 'chrome',
    xrayNetwork: 'raw',
    xrayPath: '',
    xrayHostHeader: '',
    xrayServiceName: '',
    xraySubprotocol: 'vless',
    xraySecurity: 'reality',
    xrayTlsServerName: '',
    xrayTlsCert: '',
    xrayTlsKey: '',

    awgSubnet: '10.66.66.0/24',
    awgServerPriv: '',
    awgServerPub: '',
    awgPreset: 'tspu',
    awgJc: TSPU_PRESET.jc,
    awgJmin: TSPU_PRESET.jmin,
    awgJmax: TSPU_PRESET.jmax,
    awgS1: TSPU_PRESET.s1,
    awgS2: TSPU_PRESET.s2,
    awgS3: TSPU_PRESET.s3,
    awgS4: TSPU_PRESET.s4,
    awgH1: '',
    awgH2: '',
    awgH3: '',
    awgH4: '',
    awgI1: '',
    awgI2: '',
    awgI3: '',
    awgI4: '',
    awgI5: '',

    naiveHostname: '',
    naiveTlsEmail: '',
    naiveMasquerade: '/var/www/html',

    ssMethod: '2022-blake3-aes-256-gcm',

    mtgDomain: 'www.cloudflare.com',
    mieruMtu: 1400,
  };

  if (!profile) return base;
  const cfg = profile.config as Record<string, unknown>;
  switch (profile.protocol) {
    case 'hysteria':
      return {
        ...base,
        hyObfsPassword: (cfg.obfsPassword as string) ?? '',
        hyMasqueradeUrl: (cfg.masqueradeUrl as string) ?? '',
        hyBrutalUp: (cfg.brutalUpMbps as number) ?? '',
        hyBrutalDown: (cfg.brutalDownMbps as number) ?? '',
        hyPortHopStart: (cfg.portHoppingStart as number) ?? '',
        hyPortHopEnd: (cfg.portHoppingEnd as number) ?? '',
      };
    case 'xray':
      return {
        ...base,
        xrayDest: (cfg.realityDest as string) ?? base.xrayDest,
        xrayServerNames: ((cfg.realityServerNames as string[]) ?? []).join(', '),
        xrayShortIds: ((cfg.realityShortIds as string[]) ?? []).join(', '),
        xrayPrivateKey: (cfg.realityPrivateKey as string) ?? '',
        xrayPublicKey: (cfg.realityPublicKey as string) ?? '',
        xrayRealityMode: ((cfg.realityMode as 'steal-others' | 'self-steal') ?? 'steal-others'),
        xrayFlow: (cfg.flow as string) ?? base.xrayFlow,
        xrayFingerprint: (cfg.fingerprint as string) ?? base.xrayFingerprint,
        xrayNetwork: ((cfg.network as 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp') ?? 'raw'),
        xrayPath: (cfg.path as string) ?? '',
        xrayHostHeader: (cfg.host as string) ?? '',
        xrayServiceName: (cfg.serviceName as string) ?? '',
        xraySubprotocol: ((cfg.subprotocol as 'vless' | 'trojan' | 'vmess') ?? 'vless'),
        xraySecurity: ((cfg.security as 'reality' | 'none' | 'tls') ?? 'reality'),
        xrayTlsServerName: (cfg.tlsServerName as string) ?? base.xrayTlsServerName,
        xrayTlsCert: (cfg.tlsCert as string) ?? base.xrayTlsCert,
        xrayTlsKey: (cfg.tlsKey as string) ?? base.xrayTlsKey,
      };
    case 'amneziawg': {
      const obf = (cfg.obfuscation as Record<string, number | string> | undefined) ?? {};
      return {
        ...base,
        awgSubnet: (cfg.subnet as string) ?? base.awgSubnet,
        awgServerPriv: (cfg.serverPrivateKey as string) ?? '',
        awgServerPub: (cfg.serverPublicKey as string) ?? '',
        awgPreset: 'custom',
        awgJc: (obf.jc as number) ?? '',
        awgJmin: (obf.jmin as number) ?? '',
        awgJmax: (obf.jmax as number) ?? '',
        awgS1: (obf.s1 as number) ?? '',
        awgS2: (obf.s2 as number) ?? '',
        awgS3: (obf.s3 as number) ?? '',
        awgS4: (obf.s4 as number) ?? '',
        awgH1: (obf.h1 as number) ?? '',
        awgH2: (obf.h2 as number) ?? '',
        awgH3: (obf.h3 as number) ?? '',
        awgH4: (obf.h4 as number) ?? '',
        awgI1: ((obf.i1 as string) ?? '') as string,
        awgI2: ((obf.i2 as string) ?? '') as string,
        awgI3: ((obf.i3 as string) ?? '') as string,
        awgI4: ((obf.i4 as string) ?? '') as string,
        awgI5: ((obf.i5 as string) ?? '') as string,
      };
    }
    case 'naive':
      return {
        ...base,
        naiveHostname: (cfg.hostname as string) ?? '',
        naiveTlsEmail: (cfg.tlsEmail as string) ?? '',
        naiveMasquerade: (cfg.masqueradeRoot as string) ?? base.naiveMasquerade,
      };
    case 'shadowsocks':
      return {
        ...base,
        ssMethod: ((cfg.method as FormValues['ssMethod']) ?? base.ssMethod),
      };
    case 'mtproto':
      return {
        ...base,
        mtgDomain: (cfg.domain as string) ?? base.mtgDomain,
      };
    case 'mieru':
      return {
        ...base,
        mieruMtu: ((cfg.mtu as number) ?? base.mieruMtu),
      };
    default:
      return base;
  }
}

interface Props {
  opened: boolean;
  onClose: () => void;
  profile: Profile | null;
  onSubmit: (input: CreateProfileInput | UpdateProfileInput, mode: Mode) => Promise<void>;
  loading?: boolean;
}

export function ProfileFormModal({ opened, onClose, profile, onSubmit, loading }: Props) {
  const { t } = useTranslation();
  const isEdit = profile !== null;
  const mode: Mode = isEdit ? 'edit' : 'create';

  const form = useForm<FormValues>({
    initialValues: defaults(profile),
    validate: {
      name: (v) => {
        if (v.length < 1) return 'Required';
        // Mirror backend Zod regex - Letters, digits, dot, underscore, hyphen
        // (no spaces, no Cyrillic). Catch the violation client-side so the
        // admin doesn't ride a 400 round-trip to find out.
        if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
          return t('profileForm.nameLatinOnly');
        }
        return null;
      },
    },
  });

  useEffect(() => {
    if (opened) form.setValues(defaults(profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, profile?.id]);

  // Auto-fill the gRPC serviceName placeholder when the admin switches
  // transport=grpc - the field is `required`, so without a default the
  // form refuses to save with a misleading "fill this field" prompt
  // even though we've shown a placeholder hinting at the canonical
  // value. `GunService` is the xtls/xray default; admins who want a
  // less-fingerprintable name can edit it.
  useEffect(() => {
    if (form.values.xrayNetwork === 'grpc' && !form.values.xrayServiceName) {
      form.setFieldValue('xrayServiceName', 'GunService');
    }
    // Vision flow is only valid on raw/xhttp; clear it on other transports so
    // the server account and the client URI don't disagree (xray rejects
    // "client flow is empty" when the server carries Vision but the transport
    // can't use it).
    if (!FLOW_COMPATIBLE_TRANSPORTS.includes(form.values.xrayNetwork) && form.values.xrayFlow) {
      form.setFieldValue('xrayFlow', '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.values.xrayNetwork]);

  useEffect(() => {
    // VMess share links can't carry REALITY; force a non-reality security.
    if (
      form.values.xraySubprotocol === 'vmess' &&
      form.values.xraySecurity === 'reality'
    ) {
      form.setFieldValue('xraySecurity', 'none');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.values.xraySubprotocol]);

  const keypairMutation = useMutation({
    mutationFn: (protocol: 'xray' | 'amneziawg') => generateInboundKeypair(protocol),
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Generate failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  async function generateXrayKeys() {
    const kp = await keypairMutation.mutateAsync('xray');
    form.setValues({ ...form.values, xrayPrivateKey: kp.privateKey, xrayPublicKey: kp.publicKey });
    notifications.show({ color: 'green', message: 'REALITY keypair generated' });
  }

  async function generateAwgKeys() {
    const kp = await keypairMutation.mutateAsync('amneziawg');
    form.setValues({ ...form.values, awgServerPriv: kp.privateKey, awgServerPub: kp.publicKey });
    notifications.show({ color: 'green', message: 'AmneziaWG server keypair generated' });
  }

  function applyAwgPreset(preset: 'tspu' | 'mobile' | 'custom') {
    form.setFieldValue('awgPreset', preset);
    // Always re-roll H1-H4 on preset apply - each profile should have unique
    // headers so it's not fingerprinted as "another Iceslab TSPU node".
    const headers = randomAwgHeaders();
    if (preset === 'tspu') {
      form.setValues({
        ...form.values,
        awgPreset: preset,
        ...renameAwg(TSPU_PRESET),
        awgH1: headers.h1,
        awgH2: headers.h2,
        awgH3: headers.h3,
        awgH4: headers.h4,
      });
    } else if (preset === 'mobile') {
      form.setValues({
        ...form.values,
        awgPreset: preset,
        ...renameAwg(MOBILE_PRESET),
        awgH1: headers.h1,
        awgH2: headers.h2,
        awgH3: headers.h3,
        awgH4: headers.h4,
      });
    } else {
      // custom - only re-roll headers if all 4 are blank, so admin's manual
      // tweaks aren't clobbered by accident.
      const allEmpty =
        form.values.awgH1 === '' &&
        form.values.awgH2 === '' &&
        form.values.awgH3 === '' &&
        form.values.awgH4 === '';
      if (allEmpty) {
        form.setValues({
          ...form.values,
          awgPreset: preset,
          awgH1: headers.h1,
          awgH2: headers.h2,
          awgH3: headers.h3,
          awgH4: headers.h4,
        });
      }
    }
  }

  async function handleSubmit(values: FormValues) {
    let config: Record<string, unknown>;
    switch (values.protocol) {
      case 'hysteria':
        config = {
          ...(values.hyObfsPassword ? { obfsPassword: values.hyObfsPassword } : {}),
          ...(values.hyMasqueradeUrl ? { masqueradeUrl: values.hyMasqueradeUrl } : {}),
          ...(values.hyBrutalUp ? { brutalUpMbps: Number(values.hyBrutalUp) } : {}),
          ...(values.hyBrutalDown ? { brutalDownMbps: Number(values.hyBrutalDown) } : {}),
          ...(values.hyPortHopStart && values.hyPortHopEnd
            ? {
                portHoppingStart: Number(values.hyPortHopStart),
                portHoppingEnd: Number(values.hyPortHopEnd),
              }
            : {}),
        };
        break;
      case 'xray':
        config = {
          realityDest: values.xrayDest,
          realityServerNames: csvList(values.xrayServerNames),
          realityShortIds: csvList(values.xrayShortIds),
          realityPrivateKey: values.xrayPrivateKey,
          realityPublicKey: values.xrayPublicKey,
          realityMode: values.xrayRealityMode,
          flow: values.xrayFlow,
          fingerprint: values.xrayFingerprint,
          network: values.xrayNetwork,
          subprotocol: values.xraySubprotocol,
          security: values.xraySecurity,
          tlsServerName: values.xrayTlsServerName,
          tlsCert: values.xrayTlsCert,
          tlsKey: values.xrayTlsKey,
          ...(values.xrayPath ? { path: values.xrayPath } : {}),
          ...(values.xrayHostHeader ? { host: values.xrayHostHeader } : {}),
          ...(values.xrayServiceName ? { serviceName: values.xrayServiceName } : {}),
        };
        break;
      case 'amneziawg':
        config = {
          subnet: values.awgSubnet,
          serverPrivateKey: values.awgServerPriv,
          serverPublicKey: values.awgServerPub,
          obfuscation: {
            jc: numOr(values.awgJc, 4),
            jmin: numOr(values.awgJmin, 64),
            jmax: numOr(values.awgJmax, 128),
            s1: numOr(values.awgS1, 32),
            s2: numOr(values.awgS2, 56),
            s3: numOr(values.awgS3, 32),
            s4: numOr(values.awgS4, 16),
            h1: numOr(values.awgH1, 0),
            h2: numOr(values.awgH2, 0),
            h3: numOr(values.awgH3, 0),
            h4: numOr(values.awgH4, 0),
            // I1-I5: optional v2.0 mimicry signature packets (hex).
            // Empty disables that slot. Trimmed defensively to avoid
            // accidental whitespace breaking awg-quick parser.
            i1: (values.awgI1 ?? '').trim(),
            i2: (values.awgI2 ?? '').trim(),
            i3: (values.awgI3 ?? '').trim(),
            i4: (values.awgI4 ?? '').trim(),
            i5: (values.awgI5 ?? '').trim(),
          },
        };
        break;
      case 'naive':
        config = {
          hostname: values.naiveHostname,
          tlsEmail: values.naiveTlsEmail,
          masqueradeRoot: values.naiveMasquerade,
        };
        break;
      case 'shadowsocks':
        config = { method: values.ssMethod };
        break;
      case 'mtproto':
        config = { domain: values.mtgDomain };
        break;
      case 'mieru':
        config = { mtu: values.mieruMtu === '' ? 1400 : Number(values.mieruMtu) };
        break;
    }

    if (isEdit) {
      const update: UpdateProfileInput = {
        name: values.name,
        description: values.description.trim() || null,
        enabled: values.enabled,
        config: config as never,
      };
      await onSubmit(update, mode);
    } else {
      const create: CreateProfileInput = {
        protocol: values.protocol,
        name: values.name,
        description: values.description.trim() || null,
        enabled: values.enabled,
        config: config as never,
      };
      await onSubmit(create, mode);
    }
    onClose();
    form.reset();
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        form.reset();
        onClose();
      }}
      title={
        <Group gap="sm" align="center">
          <Card
            p={8}
            radius="md"
            style={{
              backgroundColor: '#7DD3FC1A',
              border: '1px solid #7DD3FC33',
              color: '#7DD3FC',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconBolt size={18} />
          </Card>
          <Stack gap={2}>
            <Text style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontWeight: 500, fontSize: 18, color: '#C8D4E3' }}>
              {isEdit ? profile.name : t('modal.profileNewTitle')}
            </Text>
            <Text
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 9,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#7A8BA3',
              }}
            >
              {isEdit ? t('modal.profileEditSubtitle') : t('modal.profileNewSubtitle')}
            </Text>
          </Stack>
        </Group>
      }
      size="lg"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <Group grow align="flex-end">
            <TextInput
              label={t('profiles.form.name')}
              placeholder="vless-reality"
              required
              {...form.getInputProps('name')}
            />
            <Select
              label={t('profiles.form.protocol')}
              description={isEdit ? t('profiles.form.protocolEdit') : undefined}
              data={PROFILE_PROTOCOL_SELECT_DATA}
              disabled={isEdit}
              allowDeselect={false}
              {...form.getInputProps('protocol')}
            />
          </Group>

          <Textarea
            label={t('profiles.form.description')}
            placeholder=""
            autosize
            minRows={1}
            maxRows={3}
            {...form.getInputProps('description')}
          />

          <Switch label={t('common.enabled')} {...form.getInputProps('enabled', { type: 'checkbox' })} />

          <Divider label={protocolLabel(form.values.protocol)} labelPosition="center" />

          <RecipePicker
            protocol={form.values.protocol}
            onPick={async (recipe) => {
              // Apply recipe field overrides first. `apply` may be a plain
              // object (for static recipes) OR a thunk for recipes that
               // need fresh randomness per click (Salamander password, AWG
              // H1-H4, REALITY+xhttp path) - see Recipe.apply jsdoc. Resolve
              // the union here so every click yields a new random where
              // applicable, instead of the once-per-page-load value the
              // static-object form would freeze.
              const fields =
                typeof recipe.apply === 'function' ? recipe.apply() : recipe.apply;
              form.setValues((current) => ({ ...current, ...fields }));

              // Auto-fill missing crypto material so admin doesn't have to
              // chase 4 separate buttons (private key, public key, shortIds,
              // peer keys). Recipe = "I want this combo working" should mean
              // "form is ready to submit" after one click.
              if (recipe.protocol === 'xray') {
                const shortIdsEmpty = !form.values.xrayShortIds.trim();
                const keysEmpty = !form.values.xrayPrivateKey;
                const updates: Partial<FormValues> = {};

                if (shortIdsEmpty) {
                  // 6 random 16-hex-char shortIds - clients can pick any of
                  // them in their URI, REALITY accepts whichever matches.
                  // Multiple shortIds let admin rotate without breaking
                  // existing subscriptions.
                  updates.xrayShortIds = Array.from({ length: 6 }, () =>
                    Array.from({ length: 16 }, () =>
                      Math.floor(Math.random() * 16).toString(16),
                    ).join(''),
                  ).join(', ');
                }

                if (keysEmpty) {
                  try {
                    const kp = await keypairMutation.mutateAsync('xray');
                    updates.xrayPrivateKey = kp.privateKey;
                    updates.xrayPublicKey = kp.publicKey;
                  } catch {
                    // Soft-fail - admin can still hit "Сгенерировать" manually.
                  }
                }

                if (Object.keys(updates).length > 0) {
                  form.setValues((current) => ({ ...current, ...updates }));
                }
              }

              if (recipe.protocol === 'amneziawg' && !form.values.awgServerPriv) {
                try {
                  const kp = await keypairMutation.mutateAsync('amneziawg');
                  form.setValues((current) => ({
                    ...current,
                    awgServerPriv: kp.privateKey,
                    awgServerPub: kp.publicKey,
                  }));
                } catch {
                  /* soft-fail */
                }
              }
            }}
          />

          {form.values.protocol === 'xray' && (() => {
            const issues = validateXrayConfig({
              xrayNetwork: form.values.xrayNetwork,
              xrayFlow: form.values.xrayFlow,
              xraySubprotocol: form.values.xraySubprotocol,
            });
            if (issues.length === 0) return null;
            return (
              <Stack gap={4}>
                {issues.map((iss, i) => (
                  <Alert
                    key={i}
                    color={
                      iss.level === 'error'
                        ? 'red'
                        : iss.level === 'warning'
                          ? 'yellow'
                          : 'blue'
                    }
                    variant="light"
                    p="xs"
                  >
                    <Text size="xs">{t(iss.key, iss.args ?? {})}</Text>
                  </Alert>
                ))}
              </Stack>
            );
          })()}

          {form.values.protocol === 'hysteria' && (
            <Stack>
              <PasswordInput
                label={t('profiles.form.cfg.salamanderObfsLabel')}
                description={t('profiles.form.cfg.salamanderObfsDesc')}
                {...form.getInputProps('hyObfsPassword')}
              />
              <TextInput
                label={t('profiles.form.cfg.masqueradeUrlLabel')}
                placeholder="https://en.wikipedia.org"
                {...form.getInputProps('hyMasqueradeUrl')}
              />
              <Group grow>
                <NumberInput
                  label={t('profiles.form.cfg.brutalUpLabel')}
                  min={1}
                  {...form.getInputProps('hyBrutalUp')}
                />
                <NumberInput
                  label={t('profiles.form.cfg.brutalDownLabel')}
                  min={1}
                  {...form.getInputProps('hyBrutalDown')}
                />
              </Group>
              <Group grow align="flex-end">
                <NumberInput
                  label={t('profileForm.portRangeStart')}
                  description={t('profileForm.portRangeStartDesc')}
                  placeholder="20000"
                  min={1024}
                  max={65535}
                  {...form.getInputProps('hyPortHopStart')}
                />
                <NumberInput
                  label={t('profileForm.portRangeEnd')}
                  description={t('profileForm.portRangeEndDesc')}
                  placeholder="50000"
                  min={1024}
                  max={65535}
                  {...form.getInputProps('hyPortHopEnd')}
                />
              </Group>
            </Stack>
          )}

          {form.values.protocol === 'xray' && (
            <Stack>
              {/* 3x-ui progressive flow: pick Protocol, then Transport, then
                  Security. Each step is a labeled section. */}
              <Divider label="1 · Protocol" labelPosition="left" />
              <Stack gap={6}>
                <Chip.Group
                  multiple={false}
                  value={form.values.xraySubprotocol}
                  onChange={(v) => {
                    if (v) form.setFieldValue('xraySubprotocol', v as typeof form.values.xraySubprotocol);
                  }}
                >
                  <Group gap="xs">
                    <Chip value="vless" size="sm" variant="light">VLESS</Chip>
                    <Chip value="vmess" size="sm" variant="light">VMess</Chip>
                    <Chip value="trojan" size="sm" variant="light">Trojan</Chip>
                  </Group>
                </Chip.Group>
                <Text size="xs" c="dimmed">
                  {t('profiles.form.cfg.realitySubprotocolDesc')}
                </Text>
              </Stack>
              <Select
                label="Flow"
                description={t('profiles.form.cfg.realityFlowDesc')}
                data={[
                  { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
                  { value: 'xtls-rprx-vision-udp443', label: 'xtls-rprx-vision-udp443' },
                  { value: '', label: t('profiles.form.cfg.realityFlowNone') },
                ]}
                disabled={
                  form.values.xraySubprotocol !== 'vless' ||
                  !FLOW_COMPATIBLE_TRANSPORTS.includes(form.values.xrayNetwork)
                }
                {...form.getInputProps('xrayFlow')}
              />

              {/* Transport family picker. The full matrix is supported end to
                  end (Zod schema / node renderer / client URI); this surfaces
                  all six. Vision flow auto-clears for transports that reject it. */}
              <Divider label="2 · Transport" labelPosition="left" />
              <Stack gap={6}>
                <Chip.Group
                  multiple={false}
                  value={form.values.xrayNetwork}
                  onChange={(v) => {
                    if (v) form.setFieldValue('xrayNetwork', v as typeof form.values.xrayNetwork);
                  }}
                >
                  <Group gap="xs">
                    {XRAY_TRANSPORTS.map((tr) => (
                      <Chip key={tr.value} value={tr.value} size="sm" variant="light">
                        {tr.label}
                      </Chip>
                    ))}
                  </Group>
                </Chip.Group>
                <Text size="xs" c="dimmed">
                  {XRAY_TRANSPORTS.find((tr) => tr.value === form.values.xrayNetwork)?.hint}
                </Text>
              </Stack>
              {PATH_HOST_TRANSPORTS.includes(form.values.xrayNetwork) && (
                <Group grow align="flex-start">
                  <TextInput
                    label="Path"
                    description={t('profiles.form.cfg.xhttpPathDesc')}
                    placeholder="/api/v1/stream"
                    {...form.getInputProps('xrayPath')}
                  />
                  <TextInput
                    label="Host header"
                    description={t('profiles.form.cfg.hostHeaderDesc')}
                    placeholder="cdn.example.com"
                    {...form.getInputProps('xrayHostHeader')}
                  />
                </Group>
              )}
              {form.values.xrayNetwork === 'grpc' && (
                <TextInput
                  label="gRPC serviceName"
                  description={t('profiles.form.cfg.grpcServiceNameDesc')}
                  placeholder="GunService"
                  required
                  {...form.getInputProps('xrayServiceName')}
                />
              )}
              {form.values.xrayNetwork === 'kcp' && (
                <Alert color="blue" variant="light" p="xs">
                  <Text size="xs">
                    mKCP renders with safe defaults on the node (header type none).
                    It is UDP-based: do not place it on a UDP port already used by
                    Hysteria or AmneziaWG on this node.
                  </Text>
                </Alert>
              )}

              {/* Security: REALITY (default) or none (plain transport for
                  ws/httpupgrade behind a CDN that terminates TLS, or local
                  testing). Node-terminated TLS-with-cert is a later step. */}
              <Divider label="3 · Security" labelPosition="left" />
              <Stack gap={6}>
                <Chip.Group
                  multiple={false}
                  value={form.values.xraySecurity}
                  onChange={(v) => {
                    if (v) form.setFieldValue('xraySecurity', v as typeof form.values.xraySecurity);
                  }}
                >
                  <Group gap="xs">
                    <Chip
                      value="reality"
                      size="sm"
                      variant="light"
                      disabled={form.values.xraySubprotocol === 'vmess'}
                    >
                      REALITY
                    </Chip>
                    <Chip value="none" size="sm" variant="light">none (CDN / plain)</Chip>
                    <Chip value="tls" size="sm" variant="light">TLS (own cert)</Chip>
                  </Group>
                </Chip.Group>
                <Text size="xs" c="dimmed">
                  {form.values.xraySecurity === 'reality'
                    ? 'REALITY: TLS-replacement, no domain or certificate needed. Recommended.'
                    : form.values.xraySecurity === 'tls'
                      ? 'TLS: the node terminates TLS with your own certificate (no ACME). Needs a domain + cert. REALITY is stealthier for RU.'
                      : 'none: plain transport. Use behind a CDN that terminates TLS (ws / httpupgrade) or for local testing. No REALITY keypair required.'}
                </Text>
              </Stack>
              {form.values.xraySecurity === 'reality' && (
                <>
                  <Select
                    label={t('profiles.form.cfg.realityModeLabel')}
                    description={t('profiles.form.cfg.realityModeDesc')}
                    data={[
                      { value: 'steal-others', label: t('profiles.form.cfg.realityModeStealOthers') },
                      { value: 'self-steal', label: t('profiles.form.cfg.realityModeSelfSteal') },
                    ]}
                    {...form.getInputProps('xrayRealityMode')}
                  />
                  {form.values.xrayRealityMode === 'self-steal' && (
                    <Text size="xs" c="dimmed">
                      {t('profiles.form.cfg.realityModeSelfStealHint')}
                    </Text>
                  )}
                  <Group grow align="flex-start">
                    <TextInput
                      label="REALITY dest (target site)"
                      description={t('profiles.form.cfg.realityDestDesc')}
                      placeholder="www.cloudflare.com:443"
                      required={form.values.xrayRealityMode !== 'self-steal'}
                      disabled={form.values.xrayRealityMode === 'self-steal'}
                      {...form.getInputProps('xrayDest')}
                    />
                    <TextInput
                      label="REALITY serverNames"
                      description={t('profiles.form.cfg.realityServerNamesDesc')}
                      placeholder="www.cloudflare.com, cdn.cloudflare.com"
                      required
                      {...form.getInputProps('xrayServerNames')}
                    />
                  </Group>
                  <Group grow align="flex-start">
                    <TextInput
                      label="REALITY shortIds"
                      description={t('profiles.form.cfg.realityShortIdsDesc')}
                      placeholder="abc123, deadbeef"
                      required
                      {...form.getInputProps('xrayShortIds')}
                    />
                    <Select
                      label="Fingerprint"
                      description={t('profiles.form.cfg.realityFingerprintDesc')}
                      data={['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random']}
                      {...form.getInputProps('xrayFingerprint')}
                    />
                  </Group>
                  <Group align="end" wrap="nowrap" gap="xs">
                    <PasswordInput
                      flex={1}
                      label="REALITY private key"
                      description={t('profiles.form.cfg.realityPrivateKeyDesc')}
                      required
                      {...form.getInputProps('xrayPrivateKey')}
                    />
                    <Button
                      leftSection={<IconKey size={14} />}
                      variant="light"
                      loading={keypairMutation.isPending}
                      onClick={generateXrayKeys}
                      type="button"
                    >
                      {t('profiles.form.cfg.generate')}
                    </Button>
                  </Group>
                  <TextInput
                    label="REALITY public key"
                    description={t('profiles.form.cfg.realityPublicKeyDesc')}
                    required
                    {...form.getInputProps('xrayPublicKey')}
                  />
                </>
              )}
              {form.values.xraySecurity === 'tls' && (
                <>
                  <TextInput
                    label="TLS serverName (SNI)"
                    description="Domain on the certificate; the client sends it as SNI."
                    placeholder="vpn.example.com"
                    {...form.getInputProps('xrayTlsServerName')}
                  />
                  <Textarea
                    label="TLS certificate (PEM)"
                    description="Full chain. Embedded inline into the node config (no ACME)."
                    placeholder="-----BEGIN CERTIFICATE-----"
                    autosize
                    minRows={3}
                    maxRows={6}
                    {...form.getInputProps('xrayTlsCert')}
                  />
                  <Textarea
                    label="TLS private key (PEM)"
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    autosize
                    minRows={3}
                    maxRows={6}
                    {...form.getInputProps('xrayTlsKey')}
                  />
                </>
              )}
            </Stack>
          )}

          {form.values.protocol === 'amneziawg' && (
            <Stack>
              {/* AmneziaWG-specific gotchas in one place. Per upstream
                  amnezia.org docs: (a) pre-4.8.12.9 AmneziaVPN clients
                  silently don't recognize S3/S4 v2.0 fields - handshake
                  fails without error. (b) AmneziaWG 1.0 credentials are
                  not interchangeable with 2.0 - fresh keys required for
                  every peer when migrating. (c) port choice matters -
                  upstream recommends < 9999 because some ISPs block
                  high UDP ports; 51820 is the well-known WG default
                  and is specifically targeted by DPI. Port is set on
                  the binding (Nodes → Edit), not here. */}
              <Alert color="blue" variant="light" p="xs">
                <Text size="xs" component="div">
                  <strong>{t('profileForm.awgImportantTitle')}</strong>
                  <ul style={{ margin: '4px 0 0 16px', paddingLeft: 0 }}>
                    <li>{t('profileForm.awgImportant1')}</li>
                    <li>{t('profileForm.awgImportant2')}</li>
                    <li>{t('profileForm.awgImportant3')}</li>
                  </ul>
                </Text>
              </Alert>
              <TextInput
                label={t('profiles.form.cfg.awgSubnetLabel')}
                placeholder="10.66.66.0/24"
                required
                {...form.getInputProps('awgSubnet')}
              />
              <Group align="end" wrap="nowrap" gap="xs">
                <PasswordInput
                  flex={1}
                  label={t('profiles.form.cfg.awgServerPrivLabel')}
                  required
                  {...form.getInputProps('awgServerPriv')}
                />
                <Button
                  leftSection={<IconKey size={14} />}
                  variant="light"
                  loading={keypairMutation.isPending}
                  onClick={generateAwgKeys}
                  type="button"
                >
                  {t('profiles.form.cfg.generate')}
                </Button>
              </Group>
              <TextInput
                label={t('profiles.form.cfg.awgServerPubLabel')}
                required
                {...form.getInputProps('awgServerPub')}
              />
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  Obfuscation preset
                </Text>
                <SegmentedControl
                  value={form.values.awgPreset}
                  onChange={(v) => applyAwgPreset(v as 'tspu' | 'mobile' | 'custom')}
                  data={[
                    { label: 'TSPU (Russia DPI)', value: 'tspu' },
                    { label: 'Mobile', value: 'mobile' },
                    { label: 'Custom', value: 'custom' },
                  ]}
                />
              </Stack>
              <Group grow>
                <NumberInput label="Jc" min={0} {...form.getInputProps('awgJc')} />
                <NumberInput label="Jmin" min={0} {...form.getInputProps('awgJmin')} />
                <NumberInput label="Jmax" min={0} {...form.getInputProps('awgJmax')} />
              </Group>
              <Group grow>
                <NumberInput label="S1" min={0} {...form.getInputProps('awgS1')} />
                <NumberInput label="S2" min={0} {...form.getInputProps('awgS2')} />
                <NumberInput label="S3" min={0} {...form.getInputProps('awgS3')} />
                <NumberInput label="S4" min={0} {...form.getInputProps('awgS4')} />
              </Group>
              <Group align="flex-end" gap="xs" wrap="nowrap">
                <NumberInput
                  flex={1}
                  label="H1"
                  description="magic header byte"
                  min={5}
                  max={2147483647}
                  {...form.getInputProps('awgH1')}
                />
                <NumberInput
                  flex={1}
                  label="H2"
                  description={t('profiles.form.cfg.awgS1Desc')}
                  min={5}
                  max={2147483647}
                  {...form.getInputProps('awgH2')}
                />
                <NumberInput
                  flex={1}
                  label="H3"
                  description={t('profiles.form.cfg.awgJDesc')}
                  min={5}
                  max={2147483647}
                  {...form.getInputProps('awgH3')}
                />
                <NumberInput
                  flex={1}
                  label="H4"
                  description={t('profiles.form.cfg.awgHDesc')}
                  min={5}
                  max={2147483647}
                  {...form.getInputProps('awgH4')}
                />
                <Button
                  variant="light"
                  type="button"
                  leftSection={<IconKey size={14} />}
                  onClick={() => {
                    const h = randomAwgHeaders();
                    form.setValues({
                      ...form.values,
                      awgH1: h.h1,
                      awgH2: h.h2,
                      awgH3: h.h3,
                      awgH4: h.h4,
                    });
                  }}
                >
                  Re-roll
                </Button>
              </Group>
              {/* I1-I5 mimicry packets - power-user feature, 99% of
                  operators don't need them. Hidden behind a collapsible
                  section so the main form stays clean. Standard pattern
                  for "you probably don't want this, but it exists". */}
              <Accordion variant="separated" radius="sm">
                <Accordion.Item value="awg-mimicry">
                  <Accordion.Control>
                    <Text size="sm" fw={500}>
                      Advanced: I1–I5 mimicry packets (опционально)
                    </Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap={6}>
                      <Text size="xs" c="dimmed">
                        AmneziaWG v2.0 фича - маскирует handshake под другой протокол (QUIC / DNS / STUN). Нужно ТОЛЬКО если стандартный TSPU/Mobile preset не проходит DPI. Пустые поля = выключено, безопасно. Значения hex, до 256 символов каждое, ДОЛЖНЫ совпадать с клиентом.
                      </Text>
                      <Group grow>
                        <TextInput label="I1" placeholder="hex" {...form.getInputProps('awgI1')} />
                        <TextInput label="I2" placeholder="hex" {...form.getInputProps('awgI2')} />
                        <TextInput label="I3" placeholder="hex" {...form.getInputProps('awgI3')} />
                      </Group>
                      <Group grow>
                        <TextInput label="I4" placeholder="hex" {...form.getInputProps('awgI4')} />
                        <TextInput label="I5" placeholder="hex" {...form.getInputProps('awgI5')} />
                      </Group>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              {(() => {
                // Live H-uniqueness validator. Empty values pass - let the
                // `required` semantics fire on submit instead.
                const vals = [
                  form.values.awgH1,
                  form.values.awgH2,
                  form.values.awgH3,
                  form.values.awgH4,
                ].filter((v) => v !== '');
                const set = new Set(vals);
                if (vals.length === 4 && set.size < 4) {
                  return (
                    <Alert color="red" variant="light" p="xs">
                      <Text size="xs">
                        {t('profiles.form.cfg.awgHWarning')}
                      </Text>
                    </Alert>
                  );
                }
                return null;
              })()}
            </Stack>
          )}

          {form.values.protocol === 'naive' && (
            <Stack>
              <TextInput
                label={t('profiles.form.cfg.naiveHostnameLabel')}
                placeholder="n1.example.com"
                required
                {...form.getInputProps('naiveHostname')}
              />
              <TextInput
                label={t('profiles.form.cfg.naiveTlsEmailLabel')}
                placeholder="ops@example.com"
                required
                {...form.getInputProps('naiveTlsEmail')}
              />
              <TextInput
                label={t('profiles.form.cfg.naiveMasqueradeLabel')}
                placeholder="/var/www/html"
                {...form.getInputProps('naiveMasquerade')}
              />
            </Stack>
          )}

          {form.values.protocol === 'shadowsocks' && (
            <Stack>
              <Select
                label={t('profiles.form.cfg.ssCipherLabel')}
                data={[
                  { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm (recommended)' },
                  { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' },
                  { value: '2022-blake3-chacha20-poly1305', label: '2022-blake3-chacha20-poly1305' },
                  { value: 'chacha20-ietf-poly1305', label: 'chacha20-ietf-poly1305 (legacy AEAD)' },
                  { value: 'aes-256-gcm', label: 'aes-256-gcm (legacy AEAD)' },
                  { value: 'aes-128-gcm', label: 'aes-128-gcm (legacy AEAD)' },
                ]}
                allowDeselect={false}
                {...form.getInputProps('ssMethod')}
              />
              <Alert color="blue" variant="light">
                <Text size="sm">
                  {t('profiles.form.cfg.ssNote')}
                </Text>
              </Alert>
            </Stack>
          )}

          {form.values.protocol === 'mtproto' && (
            <Stack>
              <TextInput
                label={t('profiles.form.cfg.mtprotoDomain')}
                placeholder="www.cloudflare.com"
                required
                {...form.getInputProps('mtgDomain')}
              />
              <Alert color="yellow" variant="light">
                <Text size="sm">
                  {t('profiles.form.cfg.mtprotoDomainNote')}
                </Text>
              </Alert>
            </Stack>
          )}

          {form.values.protocol === 'mieru' && (
            <Stack>
              <NumberInput
                label="MTU"
                placeholder="1400"
                min={576}
                max={1500}
                {...form.getInputProps('mieruMtu')}
              />
            </Stack>
          )}

          <Divider />

          <Group justify="space-between" gap="sm">
            <Text
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: '#7A8BA3',
              }}
            >
              {isEdit ? t('modal.shortcutSave') : t('modal.shortcutCreate')}
            </Text>
            <Group gap="sm">
              <Button variant="default" onClick={onClose} disabled={loading}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                loading={loading}
                style={{ backgroundColor: '#7DD3FC', color: '#08101A', fontWeight: 500 }}
              >
                {isEdit ? t('profiles.form.submitEdit') : t('profiles.form.submitCreate')}
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function csvList(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
}

function numOr(v: number | '' | undefined, fallback: number): number {
  return v === '' || v === undefined ? fallback : Number(v);
}

function renameAwg(p: { jc: number; jmin: number; jmax: number; s1: number; s2: number; s3: number; s4: number }) {
  return {
    awgJc: p.jc, awgJmin: p.jmin, awgJmax: p.jmax,
    awgS1: p.s1, awgS2: p.s2, awgS3: p.s3, awgS4: p.s4,
  };
}
