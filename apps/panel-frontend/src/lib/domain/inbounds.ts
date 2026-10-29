import { api } from '@/lib/net/client';
import type { XraySubprotocol } from '@iceslab/shared';

export type ShadowsocksMethod =
  | '2022-blake3-aes-128-gcm'
  | '2022-blake3-aes-256-gcm'
  | '2022-blake3-chacha20-poly1305'
  | 'chacha20-ietf-poly1305'
  | 'aes-256-gcm'
  | 'aes-128-gcm';

export interface ShadowsocksInboundConfig {
  method: ShadowsocksMethod;
}

export interface MtprotoInboundConfig {
  domain: string;
}

export interface MieruInboundConfig {
  mtu: number;
}

export interface HysteriaInboundConfig {
  obfsPassword?: string;
  masqueradeUrl?: string;
  brutalUpMbps?: number;
  brutalDownMbps?: number;
}

export type XrayNetwork = 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp';

export interface XrayInboundConfig {
  realityDest: string;
  realityServerNames: string[];
  realityShortIds: string[];
  realityPrivateKey: string;
  realityPublicKey: string;
  flow?: string;
  fingerprint?: string;
  network?: XrayNetwork;
  path?: string;
  host?: string;
  serviceName?: string;
  /** What the xray inbound speaks; the list is the contract's, never a copy.
   *  Empty/undefined → server falls back to vless. */
  subprotocol?: XraySubprotocol;
  /** B3 advanced knobs. All optional, Zod-defaulted server-side. REALITY
   *  pair applies when security=reality, tlsRejectUnknownSni when
   *  security=tls, xhttp* when network=xhttp, grpcMultiMode when network=grpc. */
  realityXver?: 0 | 1 | 2;
  realityMaxTimeDiff?: number;
  /** G: throttle unverified REALITY fallback (probe) connections, bytes/sec; 0 = off. */
  realityLimitFallbackUploadBytesPerSec?: number;
  realityLimitFallbackDownloadBytesPerSec?: number;
  tlsRejectUnknownSni?: boolean;
  xhttpMode?: 'auto' | 'packet-up' | 'stream-up' | 'stream-one';
  xhttpPaddingBytes?: string;
  grpcMultiMode?: boolean;
  /** G1 - realistic fallback: real site URL the self-steal local TLS fallback
   *  reverse-proxies probe requests to. Empty = static landing page. */
  realityFallbackUpstream?: string;
}

export interface AmneziawgObfuscation {
  jc: number;
  jmin: number;
  jmax: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  /** v2.0 mimicry packets (hex). Optional, Zod defaults empty. */
  i1?: string;
  i2?: string;
  i3?: string;
  i4?: string;
  i5?: string;
}

export interface AmneziawgInboundConfig {
  subnet: string;
  serverPrivateKey: string;
  serverPublicKey: string;
  obfuscation: AmneziawgObfuscation;
}

export interface NaiveInboundConfig {
  hostname: string;
  tlsEmail: string;
  masqueradeRoot: string;
}

export type InboundConfig =
  | HysteriaInboundConfig
  | XrayInboundConfig
  | AmneziawgInboundConfig
  | NaiveInboundConfig
  | ShadowsocksInboundConfig
  | MtprotoInboundConfig
  | MieruInboundConfig;

export interface KeypairResponse {
  privateKey: string;
  publicKey: string;
}

/** Generate a fresh x25519 keypair for REALITY / AmneziaWG inbound.
 *  Same crypto, different alphabet: `xray` returns base64url (REALITY
 *  validator rejects standard base64), `amneziawg` returns standard base64. */
export async function generateInboundKeypair(
  protocol: 'xray' | 'amneziawg' = 'amneziawg',
): Promise<KeypairResponse> {
  const { data } = await api.post<KeypairResponse>(
    `/api/profiles/generate-keypair?protocol=${protocol}`,
  );
  return data;
}
