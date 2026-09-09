import type { ProtocolName } from '@/lib/domain/protocols';

export type Mode = 'create' | 'edit';

export interface FormValues {
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

export function csvList(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
}

export function numOr(v: number | '' | undefined, fallback: number): number {
  return v === '' || v === undefined ? fallback : Number(v);
}

export function renameAwg(p: { jc: number; jmin: number; jmax: number; s1: number; s2: number; s3: number; s4: number }) {
  return {
    awgJc: p.jc, awgJmin: p.jmin, awgJmax: p.jmax,
    awgS1: p.s1, awgS2: p.s2, awgS3: p.s3, awgS4: p.s4,
  };
}
