import { api } from '@/lib/net/client';
import type { ProtocolName } from '@/lib/domain/protocols';

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
  /** Slice 24c part 3, `vless` (default) or `trojan` over the same REALITY
   *  stack. Empty/undefined → server falls back to vless. */
  subprotocol?: 'vless' | 'trojan';
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

export interface Inbound {
  id: string;
  nodeId: string;
  protocol: ProtocolName;
  name: string;
  port: number;
  /** Override of the public host emitted in client URIs. NULL → fall back
   *  to `node.address`. Slice 25, separates control-plane endpoint from
   *  client-facing FQDN. */
  publicHost: string | null;
  /** Override of the public port. NULL → use `port`. */
  publicPort: number | null;
  config: InboundConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInboundInput {
  nodeId: string;
  protocol: ProtocolName;
  name: string;
  port: number;
  enabled?: boolean;
  publicHost?: string;
  publicPort?: number;
  config: InboundConfig;
}

export interface UpdateInboundInput {
  name?: string;
  port?: number;
  enabled?: boolean;
  /** `null` clears the override, `undefined` keeps the current value. */
  publicHost?: string | null;
  publicPort?: number | null;
  config?: InboundConfig;
}

export async function listInbounds(): Promise<{ inbounds: Inbound[] }> {
  const { data } = await api.get<{ inbounds: Inbound[] }>('/api/inbounds');
  return data;
}

export async function createInbound(input: CreateInboundInput): Promise<Inbound> {
  const { data } = await api.post<Inbound>('/api/inbounds', input);
  return data;
}

export async function updateInbound(id: string, input: UpdateInboundInput): Promise<Inbound> {
  const { data } = await api.put<Inbound>(`/api/inbounds/${id}`, input);
  return data;
}

export async function deleteInbound(id: string): Promise<void> {
  await api.delete(`/api/inbounds/${id}`);
}

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
