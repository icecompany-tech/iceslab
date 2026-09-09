import type { Profile } from '@/lib/domain/profiles';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';
import { TSPU_PRESET } from '@/contours/profiles/lib/awgPresets';

export function defaults(profile: Profile | null): FormValues {
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
