import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  Alert,
  Box,
  Button,
  Card,
  Collapse,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Textarea,
  UnstyledButton,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconDownload,
  IconInfoCircle,
  IconKey,
  IconPlus,
  IconShield,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import {
  generateInboundKeypair,
  listNodes,
  type CreateProfileInput,
  type Profile,
  type ProtocolName,
  type UpdateProfileInput,
} from '@/lib/net/api';
import { RecipePicker } from '@/contours/profiles/components/RecipePicker';
import { RecipeExportModal } from '@/contours/profiles/components/RecipeExportModal';
import { resolveRecipeApply, validateXrayConfig, RECIPE_COMMON_FIELDS } from '@/contours/profiles/lib/recipes';
import { protocolLabel } from '@/lib/domain/protocols';

// Xray stream transports. The whole stack already handles all six (Zod schema,
// node config.go renderer, client URI builder) - this is just the operator-
// facing picker that previously surfaced only raw/xhttp/grpc.
const XRAY_TRANSPORTS: {
  value: FormValues['xrayNetwork'];
  label: string;
  hint: string;
}[] = [
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

// Profile protocol dropdown. The sing-box engine is folded INTO this list
// instead of a separate control: a protocol that runs on either core (xray /
// hysteria / shadowsocks) appears once as a native entry and once in the
// "sing-box" group, and the sing-box-only protocols (TUIC / AnyTLS / ShadowTLS)
// live in that group too. Picking an item sets both the protocol and the engine.

// Protocols that can run on the sing-box engine besides their native core.
// Mirrors the backend's ENGINE_OPTIONS; also gates the engine field in buildConfig.
const ENGINE_CHOICE_PROTOCOLS = ['xray', 'hysteria', 'shadowsocks'];

interface ProfileKind {
  key: string;
  protocol: ProtocolName;
  engine: 'native' | 'singbox';
  label: string;
}

// One kind per selectable (protocol, engine). A shared protocol has two (native
// + sing-box); native-only and sing-box-only protocols have one. The sing-box
// variant of a shared protocol is keyed `<protocol>#singbox` to stay distinct.
const PROFILE_KINDS: ProfileKind[] = [
  { key: 'xray', protocol: 'xray', engine: 'native', label: 'Xray (native)' },
  { key: 'hysteria', protocol: 'hysteria', engine: 'native', label: 'Hysteria 2 (native)' },
  { key: 'shadowsocks', protocol: 'shadowsocks', engine: 'native', label: 'Shadowsocks 2022 (native)' },
  { key: 'amneziawg', protocol: 'amneziawg', engine: 'native', label: 'AmneziaWG' },
  { key: 'naive', protocol: 'naive', engine: 'native', label: 'NaiveProxy' },
  { key: 'mtproto', protocol: 'mtproto', engine: 'native', label: 'MTProto (Telegram-only, mtg)' },
  { key: 'mieru', protocol: 'mieru', engine: 'native', label: 'Mieru (stealth proxy)' },
  { key: 'xray#singbox', protocol: 'xray', engine: 'singbox', label: 'Xray (VLESS/VMess/Trojan)' },
  { key: 'hysteria#singbox', protocol: 'hysteria', engine: 'singbox', label: 'Hysteria 2' },
  { key: 'shadowsocks#singbox', protocol: 'shadowsocks', engine: 'singbox', label: 'Shadowsocks 2022' },
  { key: 'tuic', protocol: 'tuic', engine: 'singbox', label: 'TUIC' },
  { key: 'anytls', protocol: 'anytls', engine: 'singbox', label: 'AnyTLS' },
  { key: 'shadowtls', protocol: 'shadowtls', engine: 'singbox', label: 'ShadowTLS' },
];

const PROFILE_KIND_BY_KEY = new Map(PROFILE_KINDS.map((k) => [k.key, k] as const));

// The Select key for a (protocol, engine) pair. Only a shared protocol on
// sing-box gets the suffix; sing-box-only protocols key by their own name.
function profileKindKey(protocol: string, engine: 'native' | 'singbox'): string {
  return engine === 'singbox' && ENGINE_CHOICE_PROTOCOLS.includes(protocol)
    ? `${protocol}#singbox`
    : protocol;
}

// Grouped Select data (create mode): native cores first, then a sing-box group.
const PROFILE_PROTOCOL_GROUPED = [
  ...PROFILE_KINDS.filter((k) => k.engine === 'native').map((k) => ({ value: k.key, label: k.label })),
  {
    group: 'sing-box',
    items: PROFILE_KINDS.filter((k) => k.engine === 'singbox').map((k) => ({
      value: k.key,
      label: k.label,
    })),
  },
];

type Mode = 'create' | 'edit';

interface FormValues {
  protocol: ProtocolName;
  name: string;
  description: string;
  enabled: boolean;
  // Engine-choice: 'native' = the protocol's native core, 'singbox' = sing-box.
  engine: 'native' | 'singbox';

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
  xrayRealityFallbackUpstream: string;
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
  // B3 advanced xray options (surfaced in the "Advanced (xray)" Tabs block).
  // Names + defaults mirror the backend Zod schema exactly so the payload
  // validates without a round-trip.
  xrayRealityXver: 0 | 1 | 2;
  xrayRealityMaxTimeDiff: number | '';
  // G probe resistance: rate-limit (bytes/sec) for unverified REALITY fallback
  // connections. 0 = off. Emitted only when security=reality.
  xrayRealityLimitFallbackUpload: number | '';
  xrayRealityLimitFallbackDownload: number | '';
  xrayTlsRejectUnknownSni: boolean;
  xrayXhttpMode: 'auto' | 'packet-up' | 'stream-up' | 'stream-one';
  xrayXhttpPaddingBytes: string;
  xrayGrpcMultiMode: boolean;

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

  // TUIC (sing-box)
  tuicServerName: string;
  tuicCongestion: 'bbr' | 'cubic' | 'new_reno';

  // AnyTLS (sing-box)
  anytlsServerName: string;

  // ShadowTLS (sing-box)
  shadowtlsHandshake: string;
  shadowtlsSsMethod:
    | '2022-blake3-aes-128-gcm'
    | '2022-blake3-aes-256-gcm'
    | '2022-blake3-chacha20-poly1305'
    | 'chacha20-ietf-poly1305'
    | 'aes-256-gcm'
    | 'aes-128-gcm';
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
    // New profiles default to xray (REALITY): it's the lead protocol and the
    // first entry in the dropdown. Editing keeps the profile's real protocol.
    protocol: profile?.protocol ?? 'xray',
    name: profile?.name ?? '',
    description: profile?.description ?? '',
    enabled: profile?.enabled ?? true,
    engine: profile?.engine === 'singbox' ? 'singbox' : 'native',

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
    xrayRealityFallbackUpstream: '',
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
    xrayRealityXver: 0,
    xrayRealityMaxTimeDiff: 0,
    xrayRealityLimitFallbackUpload: 0,
    xrayRealityLimitFallbackDownload: 0,
    xrayTlsRejectUnknownSni: false,
    xrayXhttpMode: 'auto',
    xrayXhttpPaddingBytes: '',
    xrayGrpcMultiMode: false,

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

    tuicServerName: 'www.bing.com',
    tuicCongestion: 'bbr',

    anytlsServerName: 'www.bing.com',

    shadowtlsHandshake: 'www.microsoft.com',
    shadowtlsSsMethod: '2022-blake3-aes-128-gcm',
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
        xrayRealityFallbackUpstream: (cfg.realityFallbackUpstream as string) ?? '',
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
        xrayRealityXver: ((cfg.realityXver as 0 | 1 | 2) ?? base.xrayRealityXver),
        xrayRealityMaxTimeDiff: (cfg.realityMaxTimeDiff as number) ?? base.xrayRealityMaxTimeDiff,
        xrayRealityLimitFallbackUpload:
          (cfg.realityLimitFallbackUploadBytesPerSec as number) ?? base.xrayRealityLimitFallbackUpload,
        xrayRealityLimitFallbackDownload:
          (cfg.realityLimitFallbackDownloadBytesPerSec as number) ?? base.xrayRealityLimitFallbackDownload,
        xrayTlsRejectUnknownSni: (cfg.tlsRejectUnknownSni as boolean) ?? base.xrayTlsRejectUnknownSni,
        xrayXhttpMode: ((cfg.xhttpMode as FormValues['xrayXhttpMode']) ?? base.xrayXhttpMode),
        xrayXhttpPaddingBytes: (cfg.xhttpPaddingBytes as string) ?? base.xrayXhttpPaddingBytes,
        xrayGrpcMultiMode: (cfg.grpcMultiMode as boolean) ?? base.xrayGrpcMultiMode,
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
    case 'tuic':
      return {
        ...base,
        tuicServerName: (cfg.serverName as string) ?? base.tuicServerName,
        tuicCongestion: ((cfg.congestionControl as FormValues['tuicCongestion']) ?? base.tuicCongestion),
      };
    case 'anytls':
      return {
        ...base,
        anytlsServerName: (cfg.serverName as string) ?? base.anytlsServerName,
      };
    case 'shadowtls':
      return {
        ...base,
        shadowtlsHandshake: (cfg.handshake as string) ?? base.shadowtlsHandshake,
        shadowtlsSsMethod: ((cfg.ssMethod as FormValues['shadowtlsSsMethod']) ?? base.shadowtlsSsMethod),
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
  /**
   * Render the form inline instead of inside a modal. The profile form is the
   * largest editor in the panel (protocol, transport, security, REALITY keys,
   * recipes), and a dialog is the wrong container for it: on a laptop it
   * scrolls inside a box while the page behind it sits empty. The page routes
   * use this; the modal path stays for the places not migrated yet.
   */
  inline?: boolean;
}

export function ProfileFormModal({ opened, onClose, profile, onSubmit, loading, inline }: Props) {
  const { t } = useTranslation();
  const isEdit = profile !== null;
  const mode: Mode = isEdit ? 'edit' : 'create';
  const [exportOpen, exportCtl] = useDisclosure(false);
  const [advOpen, advCtl] = useDisclosure(false);

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
          // G1: realistic-fallback upstream is only meaningful for self-steal;
          // send '' otherwise so a stale value never trips the URL validation.
          realityFallbackUpstream:
            values.xrayRealityMode === 'self-steal' ? values.xrayRealityFallbackUpstream.trim() : '',
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
          // B3 advanced options - only emit the ones relevant to the chosen
          // security/network, mirroring how each tab gates its controls.
          ...(values.xraySecurity === 'reality'
            ? {
                realityXver: Number(values.xrayRealityXver),
                realityMaxTimeDiff: numOr(values.xrayRealityMaxTimeDiff, 0),
                // G: probe-resistance fallback rate-limit (bytes/sec, 0 = off).
                realityLimitFallbackUploadBytesPerSec: numOr(values.xrayRealityLimitFallbackUpload, 0),
                realityLimitFallbackDownloadBytesPerSec: numOr(values.xrayRealityLimitFallbackDownload, 0),
              }
            : {}),
          ...(values.xraySecurity === 'tls'
            ? { tlsRejectUnknownSni: values.xrayTlsRejectUnknownSni }
            : {}),
          ...(values.xrayNetwork === 'xhttp'
            ? {
                xhttpMode: values.xrayXhttpMode,
                xhttpPaddingBytes: values.xrayXhttpPaddingBytes.trim(),
              }
            : {}),
          ...(values.xrayNetwork === 'grpc'
            ? { grpcMultiMode: values.xrayGrpcMultiMode }
            : {}),
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
      case 'tuic':
        config = {
          serverName: values.tuicServerName,
          congestionControl: values.tuicCongestion,
        };
        break;
      case 'anytls':
        config = { serverName: values.anytlsServerName };
        break;
      case 'shadowtls':
        config = {
          handshake: values.shadowtlsHandshake,
          ssMethod: values.shadowtlsSsMethod,
        };
        break;
    }

    // Engine-choice: only the shared protocols carry a non-native engine;
    // everything else stays null (native). A 'native' selection -> null.
    const engine: 'singbox' | null =
      ENGINE_CHOICE_PROTOCOLS.includes(values.protocol) && values.engine === 'singbox'
        ? 'singbox'
        : null;

    if (isEdit) {
      const update: UpdateProfileInput = {
        name: values.name,
        description: values.description.trim() || null,
        enabled: values.enabled,
        engine,
        config: config as never,
      };
      await onSubmit(update, mode);
    } else {
      const create: CreateProfileInput = {
        protocol: values.protocol,
        name: values.name,
        description: values.description.trim() || null,
        enabled: values.enabled,
        engine,
        config: config as never,
      };
      await onSubmit(create, mode);
    }
    onClose();
    form.reset();
  }

  return (
    <FormShell
      inline={inline}
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
            <Text style={{ fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontWeight: 500, fontSize: 18, color: '#C8D4E3' }}>
              {isEdit ? profile.name : t('modal.profileNewTitle')}
            </Text>
            <Text
              style={{
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
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
      <form id="profile-form" onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          {/* Which binary runs this profile, then which protocol that binary
              speaks. Two questions in the order they are actually answered,
              instead of one select holding thirteen mixed options. */}
          {inline && !isEdit && (
            <EnginePicker
              engine={form.values.engine}
              protocol={form.values.protocol}
              onPick={(kind) => {
                form.setFieldValue('engine', kind.engine);
                form.setFieldValue('protocol', kind.protocol);
              }}
            />
          )}

          <SectionCard
            title={t('profiles.form.cfg.basicsTitle')}
            icon={<IconShield size={15} color="#7DD3FC" stroke={1.8} />}
          >
          {/* Name, description and the switch share one row: three short
              answers, not three stacked sections. */}
          <Group align="flex-start" gap={16} wrap="nowrap" style={{ width: '100%' }}>
            <TextInput
              style={{ flex: 1, minWidth: 0 }}
              label={t('profiles.form.name')}
              placeholder="vless-reality"
              required
              {...form.getInputProps('name')}
            />
            <Textarea
              style={{ flex: 2, minWidth: 0 }}
              label={t('profiles.form.description')}
              placeholder={t('profiles.form.descriptionPlaceholder')}
              autosize
              minRows={1}
              maxRows={3}
              {...form.getInputProps('description')}
            />
            <Select
              label={t('profiles.form.protocol')}
              description={isEdit ? t('profiles.form.protocolEdit') : undefined}
              // On the page, the protocol is picked from the engine tabs below;
              // the select stays for the modal path and for edit, where the
              // protocol is fixed anyway.
              style={inline && !isEdit ? { display: 'none' } : undefined}
              data={
                isEdit
                  ? PROFILE_KINDS.filter((k) => k.protocol === form.values.protocol).map((k) => ({
                      value: k.key,
                      label: k.label,
                    }))
                  : PROFILE_PROTOCOL_GROUPED
              }
              // Protocol is immutable on edit; only its engine variants stay
              // selectable, so a single-engine protocol shows one locked option.
              disabled={
                isEdit &&
                PROFILE_KINDS.filter((k) => k.protocol === form.values.protocol).length <= 1
              }
              allowDeselect={false}
              value={profileKindKey(form.values.protocol, form.values.engine)}
              onChange={(val) => {
                const kind = val ? PROFILE_KIND_BY_KEY.get(val) : undefined;
                if (!kind) return;
                form.setFieldValue('engine', kind.engine);
                if (!isEdit) form.setFieldValue('protocol', kind.protocol);
              }}
            />
            <Switch
              style={{ flexShrink: 0, marginTop: 26 }}
              label={t('common.enabled')}
              {...form.getInputProps('enabled', { type: 'checkbox' })}
            />
          </Group>
          </SectionCard>

          <RecipeExportModal
            opened={exportOpen}
            onClose={exportCtl.close}
            protocol={form.values.protocol}
            values={form.values as unknown as Record<string, unknown>}
          />

          {/* Recipes ride the right rail on the page (see index.css): they are
              a shortcut into the fields, not a step before them, so they sit
              alongside the form instead of pushing it down. */}
          <Box className="recipes-slot">
          <RecipePicker
            key={form.values.protocol}
            protocol={form.values.protocol}
            onPick={async (recipe) => {
              // Resolve the recipe's field map. Built-ins may carry a thunk
              // (fresh randomness per click: Salamander password, AWG H1-H4,
              // REALITY+xhttp path); registry recipes carry a plain object plus
              // a declarative randomize list. resolveRecipeApply collapses both.
              // We then merge only keys that are real form fields, so an
              // imported recipe can never inject an unknown key into the form.
              const fields = resolveRecipeApply(recipe);
              form.setValues((current) => {
                const safe: Record<string, string | number | boolean> = {};
                for (const [k, v] of Object.entries(fields)) {
                  // Only protocol-specific fields: never let a recipe touch a
                  // common field (protocol/engine/name/description/enabled),
                  // even though they exist on the flat FormValues.
                  if (k in current && !RECIPE_COMMON_FIELDS.has(k)) safe[k] = v;
                }
                return { ...current, ...safe };
              });

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
          </Box>

          <SectionCard
            title={t('profiles.form.cfg.configTitle', {
              protocol: protocolLabel(form.values.protocol),
            })}
            accent={PROTOCOL_ACCENT[form.values.protocol] ?? '#A78BFA'}
            icon={
              <IconBolt
                size={15}
                color={PROTOCOL_ACCENT[form.values.protocol] ?? '#A78BFA'}
                stroke={1.8}
              />
            }
            action={
              <UnstyledButton
                type="button"
                onClick={exportCtl.open}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 26,
                  padding: '0 10px',
                  borderRadius: 6,
                  backgroundColor: '#0B1420',
                  border: '1px solid #1C2A3D',
                }}
              >
                <IconDownload size={12} color="#7A8BA3" />
                <Text style={{ fontSize: 11, lineHeight: '14px', color: '#7A8BA3' }}>
                  {t('recipes.export.button')}
                </Text>
              </UnstyledButton>
            }
          >
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
              {/* The three decisions in one row, the way the artboard frames
                  them: what it speaks, how it travels, how it hides. Transport
                  gets the widest lane because it holds six pills; their shared
                  hint sits under the row so the columns stay aligned. */}
              <Group align="flex-start" gap={24} wrap="nowrap" style={{ width: '100%' }}>
                <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
                  <StepLabel>{t('profiles.form.cfg.stepProtocol')}</StepLabel>
                  <Group gap={8}>
                    {(['vless', 'vmess', 'trojan'] as const).map((v) => (
                      <PillChip
                        key={v}
                        label={v === 'vless' ? 'VLESS' : v === 'vmess' ? 'VMess' : 'Trojan'}
                        active={form.values.xraySubprotocol === v}
                        onClick={() => form.setFieldValue('xraySubprotocol', v)}
                      />
                    ))}
                  </Group>
                </Stack>

                <Stack gap={8} style={{ flex: 2, minWidth: 0 }}>
                  <StepLabel>{t('profiles.form.cfg.stepTransport')}</StepLabel>
                  <Group gap={8}>
                    {/* What each transport actually is stays on hover: the
                        artboard keeps this row to pills alone. */}
                    {XRAY_TRANSPORTS.map((tr) => (
                      <PillChip
                        key={tr.value}
                        label={tr.label}
                        title={tr.hint}
                        active={form.values.xrayNetwork === tr.value}
                        onClick={() => form.setFieldValue('xrayNetwork', tr.value)}
                      />
                    ))}
                  </Group>
                </Stack>

                <Stack gap={8} style={{ flex: 1.2, minWidth: 0 }}>
                  <StepLabel>{t('profiles.form.cfg.stepSecurity')}</StepLabel>
                  <Group gap={8}>
                    <PillChip
                      label="REALITY"
                      title="TLS-replacement, no domain or certificate needed."
                      active={form.values.xraySecurity === 'reality'}
                      disabled={form.values.xraySubprotocol === 'vmess'}
                      onClick={() => form.setFieldValue('xraySecurity', 'reality')}
                    />
                    <PillChip
                      label="none"
                      title="Plain transport, for a CDN that terminates TLS in front."
                      active={form.values.xraySecurity === 'none'}
                      onClick={() => form.setFieldValue('xraySecurity', 'none')}
                    />
                    <PillChip
                      label="TLS"
                      title="The node terminates TLS with your own certificate."
                      active={form.values.xraySecurity === 'tls'}
                      onClick={() => form.setFieldValue('xraySecurity', 'tls')}
                    />
                  </Group>
                </Stack>
              </Group>

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

              {/* The four settings an operator actually touches per profile,
                  in one row. Dest, fingerprint, flow and the public key live
                  under Advanced: they are either derived or set once. */}
              {form.values.xraySecurity === 'reality' && (
                <Group align="flex-start" gap={16} wrap="nowrap" style={{ width: '100%' }}>
                  <Select
                    style={{ flex: 1.4, minWidth: 0 }}
                    label={t('profiles.form.cfg.realityModeLabel')}
                    data={[
                      { value: 'steal-others', label: t('profiles.form.cfg.realityModeStealOthers') },
                      { value: 'self-steal', label: t('profiles.form.cfg.realityModeSelfSteal') },
                    ]}
                    {...form.getInputProps('xrayRealityMode')}
                  />
                  <TextInput
                    style={{ flex: 1.2, minWidth: 0 }}
                    label={
                      form.values.xrayRealityMode === 'self-steal'
                        ? t('profiles.form.cfg.realitySelfStealDomainLabel')
                        : t('profiles.form.cfg.serverNamesLabel')
                    }
                    placeholder={
                      form.values.xrayRealityMode === 'self-steal'
                        ? 'des-01.example.com'
                        : 'node1.example.com'
                    }
                    required
                    {...form.getInputProps('xrayServerNames')}
                  />
                  <TextInput
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('profiles.form.cfg.shortIdsLabel')}
                    placeholder="6ba85179e30d4fc2"
                    required
                    {...form.getInputProps('xrayShortIds')}
                  />
                  <Stack gap={6} style={{ flex: 1.2, minWidth: 0 }}>
                    <StepLabel>{t('profiles.form.cfg.keypairLabel')}</StepLabel>
                    <Group gap={8} wrap="nowrap" style={{ width: '100%' }}>
                      <PasswordInput
                        style={{ flex: 1, minWidth: 0 }}
                        placeholder={t('profiles.form.cfg.keypairPlaceholder')}
                        required
                        {...form.getInputProps('xrayPrivateKey')}
                      />
                      <UnstyledButton
                        type="button"
                        onClick={generateXrayKeys}
                        disabled={keypairMutation.isPending}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          height: 36,
                          padding: '0 14px',
                          borderRadius: 8,
                          backgroundColor: '#0B1420',
                          border: '1px solid #1C2A3D',
                          flexShrink: 0,
                        }}
                      >
                        <IconKey size={14} color="#7DD3FC" stroke={1.8} />
                        <Text
                          style={{
                            fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                            fontSize: 12,
                            fontWeight: 500,
                            lineHeight: '16px',
                            color: '#C8D4E3',
                          }}
                        >
                          {t('profiles.form.cfg.generate')}
                        </Text>
                      </UnstyledButton>
                    </Group>
                  </Stack>
                </Group>
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

              {/* B3: advanced xray knobs, grouped into tabs so the common
                  path stays clean. Each control is gated on the same
                  security/network the field actually applies to (REALITY tab
                  when security=reality, TLS tab when security=tls, the xhttp
                  controls when network=xhttp, grpc control when network=grpc).
                  Tabs whose underlying transport/security isn't selected just
                  render an inactive hint, so the operator sees why. */}
              {/* Collapsed by default: the row above is the whole decision for
                  a normal profile, and these knobs are the exception. */}
              <UnstyledButton
                type="button"
                onClick={advCtl.toggle}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '13px 16px',
                  borderRadius: 10,
                  backgroundColor: '#0B1420',
                  border: '1px solid #1C2A3D',
                }}
              >
                <Text
                  style={{
                    fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                    fontSize: 13,
                    lineHeight: '16px',
                    color: '#C8D4E3',
                  }}
                >
                  {t('profiles.form.cfg.advTitle')}
                </Text>
                <Group gap={10} wrap="nowrap">
                  <Text style={{ fontSize: 11, lineHeight: '14px', color: '#5A6B82' }}>
                    {t('profiles.form.cfg.advHint')}
                  </Text>
                  <IconChevronDown
                    size={14}
                    stroke={2}
                    color="#7A8BA3"
                    style={{
                      transform: advOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 120ms',
                    }}
                  />
                </Group>
              </UnstyledButton>
              <Collapse in={advOpen}>
              <Tabs defaultValue="reality" variant="outline">
                <Tabs.List>
                  <Tabs.Tab value="reality">{t('profiles.form.cfg.advRealityTab')}</Tabs.Tab>
                  <Tabs.Tab value="tls">{t('profiles.form.cfg.advTlsTab')}</Tabs.Tab>
                  <Tabs.Tab value="transport">{t('profiles.form.cfg.advTransportTab')}</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="reality" pt="sm">
                  {form.values.xraySecurity === 'reality' ? (
                    <Stack gap="sm">
                      {/* Moved down from the main row: set once per profile,
                          derived, or only meaningful in one REALITY mode. */}
                      <Group grow align="flex-end">
                        <TextInput
                          label="REALITY dest (target site)"
                          description={t('profiles.form.cfg.realityDestDesc')}
                          placeholder="www.cloudflare.com:443"
                          required={form.values.xrayRealityMode !== 'self-steal'}
                          disabled={form.values.xrayRealityMode === 'self-steal'}
                          {...form.getInputProps('xrayDest')}
                        />
                        <Select
                          label="Fingerprint"
                          description={t('profiles.form.cfg.realityFingerprintDesc')}
                          data={['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random']}
                          {...form.getInputProps('xrayFingerprint')}
                        />
                      </Group>
                      <Group grow align="flex-end">
                        <TextInput
                          label="REALITY public key"
                          description={t('profiles.form.cfg.realityPublicKeyDesc')}
                          required
                          {...form.getInputProps('xrayPublicKey')}
                        />
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
                      </Group>
                      {form.values.xrayRealityMode === 'self-steal' && (
                        <TextInput
                          label={t('profiles.form.cfg.realityFallbackUpstreamLabel')}
                          description={t('profiles.form.cfg.realityFallbackUpstreamDesc')}
                          placeholder="https://example.com"
                          {...form.getInputProps('xrayRealityFallbackUpstream')}
                        />
                      )}
                      <Group grow align="flex-end">
                        <Select
                          label={t('profiles.form.cfg.realityXverLabel')}
                          description={t('profiles.form.cfg.realityXverDesc')}
                          data={[
                            { value: '0', label: '0' },
                            { value: '1', label: '1' },
                            { value: '2', label: '2' },
                          ]}
                          allowDeselect={false}
                          value={String(form.values.xrayRealityXver)}
                          onChange={(v) =>
                            form.setFieldValue(
                              'xrayRealityXver',
                              (Number(v) as FormValues['xrayRealityXver']) || 0,
                            )
                          }
                        />
                        <NumberInput
                          label={t('profiles.form.cfg.realityMaxTimeDiffLabel')}
                          description={t('profiles.form.cfg.realityMaxTimeDiffDesc')}
                          placeholder="0"
                          min={0}
                          {...form.getInputProps('xrayRealityMaxTimeDiff')}
                        />
                      </Group>
                      {/* G: throttle the unverified fallback path so a prober
                          that fails REALITY auth sees a slow site, not a proxy. */}
                      <Text size="xs" fw={500}>
                        {t('profiles.form.cfg.realityFallbackRateGroup')}
                      </Text>
                      <Group grow align="flex-end">
                        <NumberInput
                          label={t('profiles.form.cfg.realityLimitFallbackUploadLabel')}
                          description={t('profiles.form.cfg.realityLimitFallbackUploadDesc')}
                          placeholder="0"
                          min={0}
                          {...form.getInputProps('xrayRealityLimitFallbackUpload')}
                        />
                        <NumberInput
                          label={t('profiles.form.cfg.realityLimitFallbackDownloadLabel')}
                          description={t('profiles.form.cfg.realityLimitFallbackDownloadDesc')}
                          placeholder="0"
                          min={0}
                          {...form.getInputProps('xrayRealityLimitFallbackDownload')}
                        />
                      </Group>
                    </Stack>
                  ) : (
                    <Text size="xs" c="dimmed">
                      {t('profiles.form.cfg.advRealityInactive')}
                    </Text>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="tls" pt="sm">
                  {form.values.xraySecurity === 'tls' ? (
                    <Switch
                      label={t('profiles.form.cfg.tlsRejectUnknownSniLabel')}
                      description={t('profiles.form.cfg.tlsRejectUnknownSniDesc')}
                      {...form.getInputProps('xrayTlsRejectUnknownSni', { type: 'checkbox' })}
                    />
                  ) : (
                    <Text size="xs" c="dimmed">
                      {t('profiles.form.cfg.advTlsInactive')}
                    </Text>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="transport" pt="sm">
                  {form.values.xrayNetwork === 'xhttp' ? (
                    <Stack gap="sm">
                      <Select
                        label={t('profiles.form.cfg.xhttpModeLabel')}
                        description={t('profiles.form.cfg.xhttpModeDesc')}
                        data={[
                          { value: 'auto', label: 'auto' },
                          { value: 'packet-up', label: 'packet-up' },
                          { value: 'stream-up', label: 'stream-up' },
                          { value: 'stream-one', label: 'stream-one' },
                        ]}
                        allowDeselect={false}
                        {...form.getInputProps('xrayXhttpMode')}
                      />
                      <TextInput
                        label={t('profiles.form.cfg.xhttpPaddingBytesLabel')}
                        description={t('profiles.form.cfg.xhttpPaddingBytesDesc')}
                        placeholder="100-1000"
                        {...form.getInputProps('xrayXhttpPaddingBytes')}
                      />
                    </Stack>
                  ) : form.values.xrayNetwork === 'grpc' ? (
                    <Switch
                      label={t('profiles.form.cfg.grpcMultiModeLabel')}
                      description={t('profiles.form.cfg.grpcMultiModeDesc')}
                      {...form.getInputProps('xrayGrpcMultiMode', { type: 'checkbox' })}
                    />
                  ) : (
                    <Text size="xs" c="dimmed">
                      {t('profiles.form.cfg.advTransportInactive')}
                    </Text>
                  )}
                </Tabs.Panel>
              </Tabs>
              </Collapse>
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
              {/* Subnet and both keys read as one decision, so they sit on one
                  line. The subnet note differs by mode: before the first save it
                  is advice, afterwards it is a consequence. */}
              <Group align="flex-start" wrap="nowrap" gap="md">
                <TextInput
                  w={220}
                  label={t('profiles.form.cfg.awgSubnetLabel')}
                  placeholder="10.66.66.0/24"
                  description={
                    isEdit
                      ? t('profiles.form.cfg.awgSubnetLockedHint')
                      : t('profiles.form.cfg.awgSubnetHint')
                  }
                  // The note explains the field, so it reads after it. Without
                  // this the row's inputs stop sharing a baseline.
                  inputWrapperOrder={['label', 'input', 'description', 'error']}
                  required
                  {...form.getInputProps('awgSubnet')}
                />
                <Group flex={1} align="end" wrap="nowrap" gap="xs">
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
                  flex={1}
                  label={t('profiles.form.cfg.awgServerPubLabel')}
                  placeholder={t('profiles.form.cfg.awgServerPubPlaceholder')}
                  required
                  {...form.getInputProps('awgServerPub')}
                />
              </Group>
              <Group justify="space-between" align="center" wrap="nowrap" gap="md">
                <Text size="sm" fw={500}>
                  {t('profiles.form.cfg.awgPresetLabel')}
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
              </Group>
              <Group grow>
                <NumberInput label="Jc" min={0} {...form.getInputProps('awgJc')} />
                <NumberInput label="Jmin" min={0} {...form.getInputProps('awgJmin')} />
                <NumberInput label="Jmax" min={0} {...form.getInputProps('awgJmax')} />
              </Group>
              <Group grow>
                <NumberInput label="S1" min={0} {...form.getInputProps('awgS1')} />
                <NumberInput label="S2" min={0} {...form.getInputProps('awgS2')} />
                {/* S3/S4 stay 0 until AmneziaVPN ships the fix for #2582: a
                    non-zero value there drops traffic on 4.8.15.x clients. */}
                <NumberInput
                  label="S3"
                  description={t('profiles.form.cfg.awgKeepZero')}
                  inputWrapperOrder={['label', 'input', 'description', 'error']}
                  min={0}
                  {...form.getInputProps('awgS3')}
                />
                <NumberInput
                  label="S4"
                  description={t('profiles.form.cfg.awgKeepZero')}
                  inputWrapperOrder={['label', 'input', 'description', 'error']}
                  min={0}
                  {...form.getInputProps('awgS4')}
                />
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
                      {t('profiles.form.cfg.awgMimicryTitle')}
                    </Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap={6}>
                      <Text size="xs" c="dimmed">
                        {t('profiles.form.cfg.awgMimicryDesc')}
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

          {form.values.protocol === 'tuic' && (
            <Stack>
              <TextInput
                label="TLS serverName (SNI)"
                placeholder="www.bing.com"
                description="SNI the node's self-signed cert is issued for. Clients connect with this name (allow-insecure for the alpha)."
                {...form.getInputProps('tuicServerName')}
              />
              <Select
                label="Congestion control"
                data={['bbr', 'cubic', 'new_reno']}
                allowDeselect={false}
                {...form.getInputProps('tuicCongestion')}
              />
            </Stack>
          )}

          {form.values.protocol === 'anytls' && (
            <Stack>
              <TextInput
                label="TLS serverName (SNI)"
                placeholder="www.bing.com"
                description="SNI the node's self-signed cert is issued for. AnyTLS is password-only (per-user password is auto-derived)."
                {...form.getInputProps('anytlsServerName')}
              />
            </Stack>
          )}

          {form.values.protocol === 'shadowtls' && (
            <Stack>
              <TextInput
                label="Handshake domain (camouflage SNI)"
                placeholder="www.microsoft.com"
                description="A whitelisted site the ShadowTLS layer fronts with a real TLS handshake. The inner Shadowsocks key is auto-generated; the per-user password is auto-derived."
                {...form.getInputProps('shadowtlsHandshake')}
              />
              <Select
                label="Inner Shadowsocks cipher"
                data={[
                  { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm (recommended)' },
                  { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm' },
                  { value: '2022-blake3-chacha20-poly1305', label: '2022-blake3-chacha20-poly1305' },
                ]}
                allowDeselect={false}
                {...form.getInputProps('shadowtlsSsMethod')}
              />
              <Alert color="blue" variant="light">
                <Text size="sm">
                  ShadowTLS has no share link. It is emitted only in the sing-box and Clash (mihomo) subscription formats.
                </Text>
              </Alert>
            </Stack>
          )}
          </SectionCard>

          {/* Inline mode has Cancel and Save in the page bar already; a second
              pair at the end of a long form is just noise. */}
          {!inline && (
          <Group justify="space-between" gap="sm">
            <Text
              style={{
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
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
                style={{ backgroundColor: '#2A93D1', color: '#08101A', fontWeight: 500 }}
              >
                {isEdit ? t('profiles.form.submitEdit') : t('profiles.form.submitCreate')}
              </Button>
            </Group>
          </Group>
          )}
        </Stack>
      </form>
    </FormShell>
  );
}

/**
 * Engine tabs plus protocol tiles, the way the artboard frames the choice: the
 * tab decides which binary runs on the node, the tile decides what it speaks.
 * A protocol served by two engines (xray, hysteria, shadowsocks) appears under
 * both, which is exactly the fact the old single select hid.
 */
function EnginePicker({
  engine,
  protocol,
  onPick,
}: {
  engine: 'native' | 'singbox';
  protocol: string;
  onPick: (kind: ProfileKind) => void;
}) {
  const { t } = useTranslation();
  const nodesQuery = useQuery({ queryKey: ['nodes'], queryFn: () => listNodes() });

  const tabs: { value: EngineTab; label: string }[] = [
    { value: 'native', label: t('profiles.engine.native') },
    { value: 'xray', label: t('profiles.engine.xray') },
    { value: 'singbox', label: t('profiles.engine.singbox') },
  ];
  const activeTab = engineTabOf(protocol, engine);
  const kinds = PROFILE_KINDS.filter((k) => engineTabOf(k.protocol, k.engine) === activeTab);

  // Core version is a property of the node, not of the profile: one xray
  // process serves every xray-core profile on that box. Show what the fleet
  // actually runs, and name the nodes that lag behind.
  const coreVersions = (nodesQuery.data?.nodes ?? [])
    .map((n) => n.coreVersion)
    .filter((v): v is string => !!v);
  const newest = [...coreVersions].sort().at(-1) ?? null;
  const behind = coreVersions.filter((v) => v !== newest);

  // Tiles come in fours on the artboard, and a short row is padded with dashed
  // placeholders rather than left ragged.
  const emptySlots = (4 - (kinds.length % 4)) % 4;

  return (
    <SectionCard title={t('profiles.form.protocol')} icon={<IconBolt size={15} color="#7DD3FC" />}>
      {/* A tab strip sitting on a hairline, not a row of buttons: the active
          tab masks the line under itself, which is what makes it read as the
          sheet you are currently looking at. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          width: '100%',
          borderBottom: '1px solid #1C2A3D',
        }}
      >
        {tabs.map((e) => {
          const active = activeTab === e.value;
          const count = PROFILE_KINDS.filter(
            (k) => engineTabOf(k.protocol, k.engine) === e.value,
          ).length;
          return (
            <UnstyledButton
              key={e.value}
              type="button"
              onClick={() => {
                const first = PROFILE_KINDS.find(
                  (k) => engineTabOf(k.protocol, k.engine) === e.value,
                );
                if (first) onPick(first);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 36,
                padding: '0 16px',
                backgroundColor: active ? '#0F1A28' : 'transparent',
                borderTop: `1px solid ${active ? '#1C2A3D' : 'transparent'}`,
                borderLeft: `1px solid ${active ? '#1C2A3D' : 'transparent'}`,
                borderRight: `1px solid ${active ? '#1C2A3D' : 'transparent'}`,
                borderBottom: `1px solid ${active ? '#0F1A28' : 'transparent'}`,
                borderTopLeftRadius: 8,
                borderTopRightRadius: 8,
                marginBottom: -1,
              }}
            >
              <Text
                style={{
                  fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: active ? '#C8D4E3' : '#7A8BA3',
                }}
              >
                {e.label}
              </Text>
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 18,
                  minWidth: 18,
                  padding: '0 5px',
                  borderRadius: 999,
                  backgroundColor: active ? '#7DD3FC24' : '#152233',
                }}
              >
                <Text
                  style={{
                    fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                    fontSize: 10,
                    color: active ? '#7DD3FC' : '#7A8BA3',
                  }}
                >
                  {count}
                </Text>
              </Box>
            </UnstyledButton>
          );
        })}
        <Box style={{ flex: 1, minWidth: 0 }} />
        <Group gap={8} wrap="nowrap" style={{ height: 36, paddingLeft: 16, paddingRight: 4 }}>
          <IconInfoCircle size={13} color="#5A6B82" stroke={1.8} />
          <Text style={{ fontSize: 11, lineHeight: '14px', color: '#5A6B82' }}>
            {t(`profiles.engine.tabHint.${activeTab}`)}
          </Text>
        </Group>
      </Box>

      {/* The binary's version belongs to the fleet, not to this template. Say
          so, and name how many boxes still run something older. Only the xray
          core reports its version to the panel, so the other two tabs stay
          quiet rather than showing a number that belongs to a different
          binary. */}
      {activeTab === 'xray' && newest && (
        <Group
          gap={14}
          wrap="nowrap"
          align="center"
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            backgroundColor: '#0B1420',
            border: '1px solid #1C2A3D',
          }}
        >
          <Group gap={10} wrap="nowrap" style={{ flexShrink: 0 }}>
            <Text
              style={{
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#7A8BA3',
              }}
            >
              {t('profiles.engine.coreVersion')}
            </Text>
            <Group
              gap={10}
              wrap="nowrap"
              style={{
                height: 32,
                padding: '0 12px',
                borderRadius: 8,
                backgroundColor: '#08101A',
                border: '1px solid #1C2A3D',
              }}
            >
              <Text style={{ fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace", fontSize: 12, color: '#C8D4E3' }}>
                xray {newest}
              </Text>
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 18,
                  padding: '0 7px',
                  borderRadius: 6,
                  backgroundColor: '#A7D8B91F',
                }}
              >
                <Text
                  style={{
                    fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                    fontSize: 9,
                    letterSpacing: '0.08em',
                    color: '#A7D8B9',
                  }}
                >
                  {t('profiles.engine.latest')}
                </Text>
              </Box>
            </Group>
          </Group>
          <Box style={{ width: 1, height: 22, backgroundColor: '#1C2A3D', flexShrink: 0 }} />
          <Text style={{ fontSize: 11, lineHeight: '16px', color: '#7A8BA3', flex: 1, minWidth: 0 }}>
            {t('profiles.engine.coreVersionHint')}
          </Text>
          {behind.length > 0 ? (
            <Group
              gap={8}
              wrap="nowrap"
              style={{
                height: 28,
                padding: '0 12px',
                borderRadius: 8,
                backgroundColor: '#F5B14C1A',
                border: '1px solid #F5B14C40',
                flexShrink: 0,
              }}
            >
              <IconAlertTriangle size={13} color="#F5B14C" stroke={1.9} />
              <Text style={{ fontSize: 11, lineHeight: '14px', color: '#F5B14C' }}>
                {t('profiles.engine.behind', {
                  count: behind.length,
                  total: coreVersions.length,
                  version: behind[0],
                })}
              </Text>
            </Group>
          ) : (
            <Group
              gap={8}
              wrap="nowrap"
              style={{
                height: 28,
                padding: '0 12px',
                borderRadius: 8,
                backgroundColor: '#A7D8B91A',
                border: '1px solid #A7D8B940',
                flexShrink: 0,
              }}
            >
              <IconCheck size={13} color="#A7D8B9" stroke={2.2} />
              <Text style={{ fontSize: 11, lineHeight: '14px', color: '#A7D8B9' }}>
                {t('profiles.engine.allCurrent', {
                  count: coreVersions.length,
                  version: newest,
                })}
              </Text>
            </Group>
          )}
        </Group>
      )}

      {/* Tiles, not a list: each one says what the protocol actually speaks,
          which is the thing an operator is choosing between. Every protocol
          keeps its own accent so the fleet reads the same colour everywhere. */}
      <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 10, width: '100%' }}>
        {kinds.map((k) => {
          const active = k.protocol === protocol && k.engine === engine;
          const accent = PROTOCOL_ACCENT[k.protocol] ?? '#7A8BA3';
          return (
            <UnstyledButton
              key={k.key}
              type="button"
              onClick={() => onPick(k)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                flexBasis: '21%',
                flexGrow: 1,
                minWidth: 0,
                padding: '13px 14px',
                borderRadius: 10,
                backgroundColor: active ? `${accent}14` : '#0B1420',
                border: `1px solid ${active ? accent : '#1C2A3D'}`,
              }}
            >
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Box
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: accent,
                      flexShrink: 0,
                    }}
                  />
                  <Text
                    style={{
                      fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                      fontSize: 13,
                      fontWeight: 600,
                      lineHeight: '16px',
                      color: '#C8D4E3',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {PROTOCOL_TILE_LABEL[k.key] ?? k.label}
                  </Text>
                </Group>
                {active && <IconCheck size={14} stroke={2.4} color={accent} />}
              </Box>
              <Text
                style={{
                  fontSize: 11,
                  lineHeight: '14px',
                  color: '#7A8BA3',
                  textAlign: 'left',
                }}
              >
                {PROTOCOL_TILE_HINT[k.key] ?? PROTOCOL_TILE_HINT[k.protocol] ?? ''}
              </Text>
              {/* The caveat line only earns its place where a protocol shows
                  up under more than one binary: on the xray tab the tab name
                  has already said everything it would say. */}
              {activeTab !== 'xray' && (
                <Text
                  style={{
                    fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                    fontSize: 10,
                    lineHeight: '12px',
                    color: active ? accent : '#5A6B82',
                    textAlign: 'left',
                  }}
                >
                  {PROTOCOL_TILE_NOTE[k.key] ?? ''}
                </Text>
              )}
            </UnstyledButton>
          );
        })}
        {Array.from({ length: emptySlots }, (_, i) => (
          <Box
            key={`slot-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexBasis: '21%',
              flexGrow: 1,
              minWidth: 0,
              padding: '13px 14px',
              borderRadius: 10,
              border: '1px dashed #1C2A3D',
            }}
          >
            <IconPlus size={14} stroke={2} color="#2C3A4E" />
          </Box>
        ))}
      </Box>
    </SectionCard>
  );
}

/**
 * Which binary serves a profile. Shadowsocks 2022 rides the xray process, so
 * it belongs on the xray tab even though its engine field says "native": the
 * tab answers "what runs on the node", not "what does the column say".
 */
type EngineTab = 'native' | 'xray' | 'singbox';

function engineTabOf(protocol: string, engine: 'native' | 'singbox'): EngineTab {
  if (engine === 'singbox') return 'singbox';
  return protocol === 'xray' || protocol === 'shadowsocks' ? 'xray' : 'native';
}

/** One line per protocol: what it speaks, in the operator's terms. */
const PROTOCOL_TILE_HINT: Record<string, string> = {
  xray: 'VLESS, VMess, Trojan, REALITY',
  hysteria: 'QUIC, Brutal CC, port hopping',
  shadowsocks: 'blake3 ciphers, minimal overhead',
  amneziawg: 'WireGuard with obfuscation',
  naive: 'Chromium TLS, Caddy fork',
  mtproto: 'Telegram only, no per-user stats',
  mieru: 'Stealth proxy, no handshake',
  'xray#singbox': 'VLESS, VMess, Trojan',
  'hysteria#singbox': 'Same protocol, one less process',
  'shadowsocks#singbox': '2022 ciphers, sing-box core',
  tuic: 'QUIC-based, UDP relay',
  anytls: 'TLS-in-TLS, padding scheme',
  shadowtls: 'Handshake proxied to a real site',
};

/** Tile titles drop the engine suffix: the active tab already said it. */
const PROTOCOL_TILE_LABEL: Record<string, string> = {
  xray: 'Xray',
  hysteria: 'Hysteria 2',
  shadowsocks: 'Shadowsocks 2022',
  amneziawg: 'AmneziaWG',
  naive: 'NaiveProxy',
  mtproto: 'MTProto',
  mieru: 'Mieru',
  'xray#singbox': 'Xray protocols',
  'hysteria#singbox': 'Hysteria 2',
  'shadowsocks#singbox': 'Shadowsocks 2022',
  tuic: 'TUIC',
  anytls: 'AnyTLS',
  shadowtls: 'ShadowTLS',
};

/**
 * A titled block of the form. The caption stays muted and the icon carries the
 * colour; the protocol config card additionally wears its accent as a top edge,
 * which is what separates "what this is called" from "how the wire behaves".
 */
function SectionCard({
  title,
  icon,
  accent,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Stack
      gap={16}
      style={{
        padding: 20,
        borderRadius: 10,
        backgroundColor: '#0F1A28',
        border: '1px solid #1C2A3D',
        borderTop: accent ? `3px solid ${accent}` : '1px solid #1C2A3D',
      }}
    >
      <Group justify="space-between" wrap="nowrap" style={{ width: '100%' }}>
        <Group gap={8} wrap="nowrap">
          {icon}
          <Text
            style={{
              fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: '#7A8BA3',
            }}
          >
            {title}
          </Text>
        </Group>
        {action}
      </Group>
      {children}
    </Stack>
  );
}

/** Each protocol keeps one accent across every screen it appears on. */
const PROTOCOL_ACCENT: Record<string, string> = {
  xray: '#A78BFA',
  shadowsocks: '#F5A3B8',
  hysteria: '#7DD3FC',
  amneziawg: '#A7D8B9',
  naive: '#F5B14C',
  mtproto: '#67E8F9',
  mieru: '#C78BFA',
  tuic: '#7DD3FC',
  anytls: '#7A8BA3',
  shadowtls: '#7A8BA3',
};

/** Third line of a protocol tile: the caveat, not the pitch. */
const PROTOCOL_TILE_NOTE: Record<string, string> = {
  xray: 'REALITY probe-resist tuning',
  hysteria: 'own process, own port',
  shadowsocks: 'multi-user, per-user keys',
  amneziawg: 'kernel module, no userspace proc',
  naive: 'Caddy fork, no per-user stats',
  mtproto: 'Telegram only, no per-user stats',
  mieru: 'no handshake to fingerprint',
  'xray#singbox': 'no REALITY probe-resist tuning',
  'hysteria#singbox': 'stats via sing-box API',
  'shadowsocks#singbox': 'multi-user, per-user keys',
  tuic: 'sing-box only',
  anytls: 'sing-box only',
  shadowtls: 'sing-box only',
};

/**
 * One choice in a step row. A pill, not a Mantine Chip: the artboard carries
 * selection with fill and weight alone, and the check glyph a Chip insists on
 * would make every row jump a few pixels as the choice moves.
 */
function PillChip({
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string;
  active: boolean;
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
        padding: '6px 14px',
        borderRadius: 999,
        backgroundColor: active ? '#7DD3FC29' : '#0B1420',
        border: `1px solid ${active ? '#7DD3FC' : '#1C2A3D'}`,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <Text
        style={{
          fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 12,
          fontWeight: active ? 600 : 400,
          lineHeight: '16px',
          color: active ? '#C8D4E3' : '#7A8BA3',
        }}
      >
        {label}
      </Text>
    </UnstyledButton>
  );
}

/**
 * Step caption above a chip row in the xray config card: a numbered marker in
 * cyan, then the step name. Numbers come from the label text itself, so the
 * three columns read as one sequence left to right.
 */
function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: '#7A8BA3',
      }}
    >
      {children}
    </Text>
  );
}

/**
 * Either a modal or a plain section, with the same title block. Keeping one
 * shell means the form body below never has to know which one it is in.
 */
function FormShell({
  inline,
  opened,
  onClose,
  title,
  size,
  children,
}: {
  inline?: boolean;
  opened: boolean;
  onClose: () => void;
  title: React.ReactNode;
  size?: string;
  children: React.ReactNode;
}) {
  if (!inline) {
    return (
      <Modal opened={opened} onClose={onClose} title={title} size={size}>
        {children}
      </Modal>
    );
  }
  if (!opened) return null;
  // Inline mode drops the title block: the page it sits on already names the
  // profile in its own bar, and two identical headings read as a bug. The
  // class turns the form into a two-column grid, recipes on the right rail.
  return (
    <Box
      className="profile-form-inline"
      style={{
        padding: 20,
        borderRadius: 10,
        backgroundColor: '#0F1A28',
        border: '1px solid #1C2A3D',
      }}
    >
      {children}
    </Box>
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
