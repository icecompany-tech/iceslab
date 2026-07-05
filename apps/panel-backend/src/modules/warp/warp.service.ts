import { generateWireguardKeyPair } from '../../lib/credentials.js';

/**
 * Cloudflare WARP device registration (panel-side), replicating `wgcf register`.
 *
 * The panel is Iceslab's credential authority: it generates the WireGuard
 * keypair, registers a free WARP device with Cloudflare, and stores the returned
 * creds. The node only ever receives the rendered `warp` block via push (see
 * the node's xray wireguard outbound). A WARP account is not IP-bound, so the
 * egress tunnel works regardless of where registration happened - registering
 * centrally in the panel keeps the node zero-dependency and the creds in one DB.
 *
 * API shape verified against ViRb3/wgcf (the de-facto reference):
 *   POST https://api.cloudflareclient.com/v0a884/reg
 * See docs/studies/STUDY-warp-native.md.
 *
 * NOTE: this is a registration SPIKE - the parsing/derivation is unit-tested,
 * but the live Cloudflare call must be smoke-tested once against the real API
 * (the version path `v0a884` and field shapes can drift).
 */

const WARP_API_BASE = 'https://api.cloudflareclient.com/v0a884';
const WARP_REG_HEADERS: Record<string, string> = {
  'User-Agent': 'okhttp/3.12.1',
  'Content-Type': 'application/json; charset=UTF-8',
};

export interface WarpCredentials {
  /** WireGuard private key (base64) - the secret we keep. */
  secretKey: string;
  /** Cloudflare peer public key. */
  publicKey: string;
  /** Assigned interface addresses, e.g. ["172.16.0.2/32", "<v6>/128"]. */
  address: string[];
  /** Peer endpoint "host:port" (e.g. "engage.cloudflareclient.com:2408"). */
  endpoint: string;
  /** client_id decoded to its first 3 bytes (xray/sing-box `reserved`). */
  reserved: number[];
  /** Raw base64 client_id (kept for re-derivation / debugging). */
  clientId: string;
  /** Cloudflare device id. */
  deviceId: string;
  /** API token (needed later to bind a WARP+ license). */
  token: string;
  /** Account license key (free or WARP+). */
  license: string;
}

export interface RegisterWarpOptions {
  /** Injectable fetch for tests. Defaults to the global fetch (Node 18+). */
  fetchImpl?: typeof fetch;
  /** Injectable clock for the `tos` timestamp (tests). Defaults to now. */
  now?: Date;
}

/** Register a fresh free WARP device and return its credentials. */
export async function registerWarpDevice(
  opts: RegisterWarpOptions = {},
): Promise<WarpCredentials> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const tos = (opts.now ?? new Date()).toISOString();
  const { privateKey, publicKey } = generateWireguardKeyPair();

  const res = await fetchFn(`${WARP_API_BASE}/reg`, {
    method: 'POST',
    headers: { ...WARP_REG_HEADERS },
    body: JSON.stringify({
      install_id: '',
      tos,
      key: publicKey,
      fcm_token: '',
      type: 'Android',
      model: 'PC',
      locale: 'en_US',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`WARP registration failed: HTTP ${res.status} ${text}`.trim());
  }
  return parseWarpRegistration(await res.json(), privateKey);
}

/**
 * Parse a WARP /reg response into WarpCredentials. Split out from the HTTP call
 * so it is unit-testable against a captured response fixture. `secretKey` is the
 * locally-generated private key (the API never returns it).
 */
export function parseWarpRegistration(json: unknown, secretKey: string): WarpCredentials {
  const root = (json ?? {}) as Record<string, unknown>;
  const config = root.config as Record<string, unknown> | undefined;
  if (!config) {
    throw new Error('WARP registration: response has no `config`');
  }
  const iface = config.interface as { addresses?: { v4?: string; v6?: string } } | undefined;
  const addresses = iface?.addresses;
  const peers = config.peers as Array<{ public_key?: string; endpoint?: { host?: string } }> | undefined;
  const peer = peers?.[0];
  if (!addresses?.v4 || !peer?.public_key || !peer.endpoint?.host) {
    throw new Error('WARP registration: incomplete config (addresses/peer/endpoint)');
  }

  const address = [`${addresses.v4}/32`];
  if (addresses.v6) {
    address.push(`${addresses.v6}/128`);
  }
  const clientId = String(config.client_id ?? '');
  const account = root.account as { license?: string } | undefined;

  return {
    secretKey,
    publicKey: peer.public_key,
    address,
    endpoint: peer.endpoint.host,
    reserved: clientIdToReserved(clientId),
    clientId,
    deviceId: String(root.id ?? ''),
    token: String(root.token ?? ''),
    license: String(account?.license ?? ''),
  };
}

/**
 * Cloudflare's `client_id` is a base64 string; xray/sing-box need its first 3
 * bytes as the wireguard `reserved` array (required in some regions). Returns []
 * when client_id is absent or shorter than 3 bytes so the node omits the field.
 */
export function clientIdToReserved(clientId: string): number[] {
  if (!clientId) return [];
  const buf = Buffer.from(clientId, 'base64');
  if (buf.length < 3) return [];
  return [buf[0], buf[1], buf[2]];
}
