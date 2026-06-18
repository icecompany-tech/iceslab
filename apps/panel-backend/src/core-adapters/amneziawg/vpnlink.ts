import { deflateSync } from 'node:zlib';
import {
  buildAmneziawgClientConfig,
  type AmneziawgClientConfigOpts,
} from './wgconf.js';

/**
 * AmneziaVPN "vpn://" connection-key builder for an AmneziaWG tunnel.
 *
 * The AmneziaVPN app (the flagship, NOT the standalone AmneziaWG app) scans a
 * QR that encodes its own connection key starting with `vpn://`, never a raw
 * wg-quick .conf. Generating one lets that QR import directly.
 *
 * Format (verified against amnezia-client exportController.cpp + two working
 * third-party encoders):
 *
 *   JSON object (minified utf8)
 *     -> Qt qCompress: 4-byte BIG-ENDIAN uncompressed length, then zlib level 8
 *     -> base64url, NO padding
 *     -> prefix "vpn://"
 *
 * The 4-byte length prefix is the #1 gotcha: Qt's qUncompress rejects a bare
 * zlib stream, and a missing/empty container envelope both surface as the app's
 * "error 900" (ImportInvalidConfigError). Node's zlib emits a correct zlib
 * stream (right adler32), so the browser-CompressionStream adler32 patch others
 * need does NOT apply here.
 *
 * Sources:
 *   amnezia-client exportController.cpp (qCompress(json, 8) + Base64UrlEncoding
 *   | OmitTrailingEquals), configKeys.h (the literal JSON keys), and the
 *   andr13/amnezia-config-decoder + auswuchs/awg-converter reference encoders.
 */

// Container-type literal. `amnezia-awg` is the canonical string in Amnezia's
// own configKeys.h and what the app's export/import round-trips. The app tags a
// plain `amnezia-awg` config "AmneziaWG Legacy" UNLESS isThirdPartyConfig is set
// (both display checks - containersModel.cpp + serverDescription.cpp - are gated
// on `&& !isThirdPartyConfig`); we set that flag below. It is accurate (this is
// an externally generated config) and removes the deprecation nag while keeping
// the v1 wire protocol our amneziawg-go / kernel nodes actually speak (a real
// AWG handshake completes - verified in the app log). `amnezia-awg2` is genuine
// AmneziaWG 2.0 (ranged H1-H4 + active S3/S4) and would need a node-side core
// upgrade + regenerated peers, so do NOT switch to it for our v1 nodes.
const AWG_CONTAINER = 'amnezia-awg';

export interface AmneziaVpnLinkOpts extends AmneziawgClientConfigOpts {
  /** Optional preshared key. Empty when the inbound uses none (our default). */
  pskKey?: string;
  /** Client MTU written into the structured block. Default 1280. */
  mtu?: number;
  /** Display name shown in the AmneziaVPN app. */
  description?: string;
}

/**
 * Encode any config object into a `vpn://` key. Minified JSON -> 4-byte BE
 * uncompressed-length header + zlib(level 8) (Qt qCompress) -> base64url
 * (no padding) -> "vpn://".
 */
export function encodeAmneziaVpnKey(config: unknown): string {
  const json = Buffer.from(JSON.stringify(config), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(json.length, 0); // uncompressed length, big-endian
  const compressed = deflateSync(json, { level: 8 });
  return 'vpn://' + Buffer.concat([header, compressed]).toString('base64url');
}

export function buildAmneziaVpnLink(opts: AmneziaVpnLinkOpts): string {
  // The full wg-quick text drives the tunnel; the structured fields mirror it
  // so the app can populate its UI and reconnect.
  const conf = buildAmneziawgClientConfig(opts);
  const allowed = opts.clientAllowedIps?.length ? opts.clientAllowedIps : ['0.0.0.0/0', '::/0'];

  // Obfuscation params as strings (the app serializes them as JSON strings),
  // present both at the awg-server level and inside last_config.
  const obf: Record<string, string> = {
    Jc: String(opts.jc),
    Jmin: String(opts.jmin),
    Jmax: String(opts.jmax),
    S1: String(opts.s1),
    S2: String(opts.s2),
    S3: String(opts.s3),
    S4: String(opts.s4),
    H1: String(opts.h1),
    H2: String(opts.h2),
    H3: String(opts.h3),
    H4: String(opts.h4),
    I1: opts.i1 ?? '',
    I2: opts.i2 ?? '',
    I3: opts.i3 ?? '',
    I4: opts.i4 ?? '',
    I5: opts.i5 ?? '',
  };

  // Inner client config. `config` (the .conf text) is required; an empty one is
  // the schema half of "error 900". last_config is DOUBLE-encoded (a stringified
  // JSON), per the app's AwgProtocolConfig::toJson.
  const lastConfig = {
    ...obf,
    allowed_ips: allowed,
    clientId: '',
    client_ip: opts.allowedIp,
    client_priv_key: opts.privateKey,
    client_pub_key: '',
    config: conf,
    hostName: opts.host,
    isThirdPartyConfig: true,
    mtu: String(opts.mtu ?? 1280),
    persistent_keep_alive: String(opts.persistentKeepalive ?? 25),
    port: opts.port,
    psk_key: opts.pskKey ?? '',
    server_pub_key: opts.serverPublicKey,
  };

  const awg = {
    ...obf,
    // Suppresses the "AmneziaWG Legacy" label/nag (see AWG_CONTAINER note). Set
    // at both the awg-container level (where serverDescription reads it) and
    // inside last_config, since the app parses isThirdPartyConfig from both.
    isThirdPartyConfig: true,
    last_config: JSON.stringify(lastConfig),
    port: String(opts.port),
    transport_proto: 'udp',
  };

  // Outer envelope. containers[] + defaultContainer are the required structure;
  // without them the app reports "config does not contain containers" (error 900).
  const envelope: Record<string, unknown> = {
    containers: [{ awg, container: AWG_CONTAINER }],
    defaultContainer: AWG_CONTAINER,
    description: opts.description ?? `AmneziaWG ${opts.host}`,
    hostName: opts.host,
  };
  if (opts.dns?.[0]) envelope.dns1 = opts.dns[0];
  if (opts.dns?.[1]) envelope.dns2 = opts.dns[1];

  return encodeAmneziaVpnKey(envelope);
}
