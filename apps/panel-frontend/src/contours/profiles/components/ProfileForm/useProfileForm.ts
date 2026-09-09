import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import { generateInboundKeypair } from '@/lib/domain/inbounds';
import type {
  CreateProfileInput,
  Profile,
  UpdateProfileInput,
} from '@/lib/domain/profiles';
import {
  csvList,
  numOr,
  renameAwg,
  type FormValues,
  type Mode,
} from '@/contours/profiles/lib/profileFormValues';
import { defaults } from '@/contours/profiles/lib/profileDefaults';
import { MOBILE_PRESET, randomAwgHeaders, TSPU_PRESET } from '@/contours/profiles/lib/awgPresets';
import { FLOW_COMPATIBLE_TRANSPORTS } from '@/contours/profiles/lib/xrayTransports';
import { ENGINE_CHOICE_PROTOCOLS } from '@/contours/profiles/lib/profileKinds';

/**
 * Everything the profile form owns that is not markup: the Mantine form, the
 * effects that keep dependent fields honest, the keypair mutation and the
 * submit that shapes the API payload. The modal keeps only layout.
 */
export function useProfileForm({
  profile,
  opened,
  mode,
  onSubmit,
  onClose,
}: {
  profile: Profile | null;
  opened: boolean;
  mode: Mode;
  onSubmit: (input: CreateProfileInput | UpdateProfileInput, mode: Mode) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = profile !== null;

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


  return {
    form,
    // The recipe apply handler in the modal drives the mutation directly, so it
    // gets the mutation itself; sections only need the pending flag.
    keypairMutation,
    keypairPending: keypairMutation.isPending,
    generateXrayKeys,
    generateAwgKeys,
    applyAwgPreset,
    handleSubmit,
  };
}
